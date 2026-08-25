import { execFile } from "node:child_process";
import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { env } from "../env.js";
import { fail } from "../errors.js";

const exec = promisify(execFile);

export async function ffmpegVersion(): Promise<string> {
  try {
    const { stdout } = await exec("ffmpeg", ["-version"], { encoding: "utf8" });
    const m = stdout.match(/ffmpeg version (\S+)/);
    return m?.[1] ?? "unknown";
  } catch {
    throw new Error("未找到 ffmpeg，请先 brew install ffmpeg");
  }
}

export async function toWav48k(src: string, dest: string): Promise<void> {
  await exec("ffmpeg", ["-y", "-i", src, "-ar", "48000", "-acodec", "pcm_s16le", dest]);
}

export async function probeDurationMs(file: string): Promise<number> {
  const { stdout } = await exec("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const sec = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(sec)) fail(400, "invalid_audio", "无法读取音频时长");
  return Math.round(sec * 1000);
}

export type ImageExt = "jpg" | "png" | "webp";

export function sniffImage(buf: Buffer): ImageExt | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export function requireImage(file: { size: number; buffer: Buffer }): ImageExt {
  if (file.size > env.imageMaxMb * 1024 * 1024) fail(400, "validation_failed", "图片过大");
  const kind = sniffImage(file.buffer);
  if (!kind) fail(400, "invalid_image", "不支持的图片格式");
  return kind === "jpg" ? "jpg" : kind;
}

export async function extractLastFrame(video: string, dest: string): Promise<void> {
  await exec("ffmpeg", [
    "-y",
    "-sseof",
    "-1",
    "-i",
    video,
    "-map",
    "0:v:0",
    "-an",
    "-fps_mode",
    "passthrough",
    "-update",
    "1",
    dest,
  ]);
}

export async function toGrayscale(src: string, dest: string): Promise<void> {
  await exec("ffmpeg", [
    "-y",
    "-i",
    src,
    "-map",
    "0:v:0",
    "-frames:v",
    "1",
    "-vf",
    "format=gray",
    dest,
  ]);
}

export async function toStructureSketch(src: string, dest: string): Promise<void> {
  await exec("ffmpeg", [
    "-y",
    "-i",
    src,
    "-map",
    "0:v:0",
    "-frames:v",
    "1",
    "-vf",
    "format=gray,edgedetect=low=0.08:high=0.25,negate,format=gray",
    dest,
  ]);
}

export async function probeVideo(file: string): Promise<{ duration: number; width: number; height: number; codec: string }> {
  const { stdout } = await exec("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,codec_name",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    file,
  ]);
  const json = JSON.parse(stdout) as {
    streams?: { width?: number; height?: number; codec_name?: string }[];
    format?: { duration?: string };
  };
  const s = json.streams?.[0];
  const duration = Number.parseFloat(json.format?.duration || "0");
  if (!s?.width || !duration) fail(400, "invalid_video", "无法探测视频");
  return { duration, width: s.width, height: s.height || 0, codec: s.codec_name || "" };
}

type Lab = [number, number, number];
type ColorRegion = "neutral" | "skin" | "wall" | "global";
export type VideoRegionStats = Record<ColorRegion, Lab>;

const ANALYSIS_WIDTH = 180;
const ANALYSIS_HEIGHT = 320;
const COLOR_REGIONS: ColorRegion[] = ["neutral", "skin", "wall", "global"];

function srgbToLinear(value: number): number {
  const n = value / 255;
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const n = Math.max(0, Math.min(1, value));
  return 255 * (n <= 0.0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - 0.055);
}

function rgbToLab(r: number, g: number, b: number): Lab {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / 1.08883;
  const f = (n: number) => (n > 0.008856 ? Math.cbrt(n) : 7.787 * n + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToRgb([l, a, b]: Lab): Lab {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (n: number) => (n ** 3 > 0.008856 ? n ** 3 : (n - 16 / 116) / 7.787);
  const x = 0.95047 * inv(fx);
  const y = inv(fy);
  const z = 1.08883 * inv(fz);
  return [
    linearToSrgb(3.2404542 * x - 1.5371385 * y - 0.4985314 * z),
    linearToSrgb(-0.969266 * x + 1.8760108 * y + 0.041556 * z),
    linearToSrgb(0.0556434 * x - 0.2040259 * y + 1.0572252 * z),
  ];
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
}

function summarizeRegion(values: Lab[]): Lab {
  if (values.length < 100) throw new Error(`色彩分析区域有效像素不足：${values.length}`);
  return [0, 1, 2].map((channel) => median(values.map((value) => value[channel]!))) as Lab;
}

async function sampleRgbFrame(file: string, second: number): Promise<Buffer> {
  const { stdout } = await exec(
    "ffmpeg",
    [
      "-v", "error", "-ss", second.toFixed(3), "-i", file, "-frames:v", "1",
      "-vf", `scale=${ANALYSIS_WIDTH}:${ANALYSIS_HEIGHT}:flags=area,format=rgb24`,
      "-f", "rawvideo", "pipe:1",
    ],
    { encoding: null, maxBuffer: ANALYSIS_WIDTH * ANALYSIS_HEIGHT * 4 },
  );
  return stdout;
}

async function analyzeVideoRegions(file: string, role: "reference" | "target"): Promise<VideoRegionStats> {
  const { duration } = await probeVideo(file);
  const positions = role === "reference" ? [0.35, 0.55, 0.7, 0.82, 0.92] : [0.06, 0.14, 0.28, 0.5, 0.75];
  const regions: Record<ColorRegion, Lab[]> = { neutral: [], skin: [], wall: [], global: [] };
  for (const position of positions) {
    const frame = await sampleRgbFrame(file, Math.max(0.5, Math.min(duration - 0.5, duration * position)));
    for (let y = 0; y < ANALYSIS_HEIGHT; y++) {
      for (let x = 0; x < ANALYSIS_WIDTH; x++) {
        const offset = (y * ANALYSIS_WIDTH + x) * 3;
        const r = frame[offset]!;
        const g = frame[offset + 1]!;
        const b = frame[offset + 2]!;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max ? (max - min) / max : 0;
        const lab = rgbToLab(r, g, b);
        const nx = x / ANALYSIS_WIDTH;
        const ny = y / ANALYSIS_HEIGHT;
        if (lab[0] > 12 && lab[0] < 96) regions.global.push(lab);
        if (nx > 0.18 && nx < 0.82 && ny > 0.43 && ny < 0.83 && lab[0] > 52 && saturation < 0.2) {
          regions.neutral.push(lab);
        }
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        if (
          nx > 0.27 && nx < 0.73 && ny > 0.17 && ny < 0.48 && lab[0] > 35 &&
          cb > 76 && cb < 128 && cr > 132 && cr < 178 && r > g && g > b
        ) {
          regions.skin.push(lab);
        }
        const inWall = ((nx > 0.02 && nx < 0.28) || (nx > 0.67 && nx < 0.93)) && ny > 0.05 && ny < 0.36;
        if (inWall && lab[0] > 25 && lab[0] < 82 && saturation < 0.38) regions.wall.push(lab);
      }
    }
  }
  return Object.fromEntries(COLOR_REGIONS.map((name) => [name, summarizeRegion(regions[name])])) as VideoRegionStats;
}

export function buildLabCorrections(reference: VideoRegionStats, target: VideoRegionStats): VideoRegionStats {
  const limits: Lab = [8, 6, 6];
  return Object.fromEntries(
    COLOR_REGIONS.map((name) => [
      name,
      reference[name].map((value, channel) =>
        Math.max(-limits[channel]!, Math.min(limits[channel]!, value - target[name][channel]!)),
      ) as Lab,
    ]),
  ) as VideoRegionStats;
}

function similarity(lab: Lab, center: Lab, scales: Lab): number {
  return Math.exp(-lab.reduce((sum, value, index) => sum + ((value - center[index]!) / scales[index]!) ** 2, 0));
}

function writeColorCube(path: string, target: VideoRegionStats, corrections: VideoRegionStats): void {
  const transform = (rgb: Lab): Lab => {
    const lab = rgbToLab(...rgb);
    const edgeFade = Math.min(1, Math.max(0, (lab[0] - 5) / 15), Math.max(0, (98 - lab[0]) / 12));
    const weights: Record<ColorRegion, number> = {
      global: 0.18,
      neutral: 1.2 * similarity(lab, target.neutral, [24, 10, 12]),
      skin: 1.6 * similarity(lab, target.skin, [22, 13, 15]),
      wall: 0.9 * similarity(lab, target.wall, [25, 14, 16]),
    };
    const total = COLOR_REGIONS.reduce((sum, name) => sum + weights[name], 0);
    const correction = [0, 1, 2].map((channel) =>
      COLOR_REGIONS.reduce((sum, name) => sum + corrections[name][channel]! * weights[name], 0) / total,
    );
    return labToRgb(lab.map((value, channel) => value + correction[channel]! * edgeFade) as Lab);
  };
  const size = 17;
  const lines = [
    'TITLE "voiceover regional Lab color match"',
    `LUT_3D_SIZE ${size}`,
    "DOMAIN_MIN 0.0 0.0 0.0",
    "DOMAIN_MAX 1.0 1.0 1.0",
  ];
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const mapped = transform([r * 255 / (size - 1), g * 255 / (size - 1), b * 255 / (size - 1)]);
        lines.push(mapped.map((value) => Math.max(0, Math.min(1, value / 255)).toFixed(7)).join(" "));
      }
    }
  }
  writeFileSync(path, `${lines.join("\n")}\n`);
}

export async function concatColorMatched(
  jobDir: string,
  rels: string[],
  destName = "final.mp4",
): Promise<{ method: string; stats: VideoRegionStats[]; corrections: Array<VideoRegionStats | null> }> {
  if (!rels.length) throw new Error("没有可拼接的视频");
  const files = rels.map((rel) => `${jobDir}/${rel}`);
  const dest = `${jobDir}/${destName}`;
  const tempDest = `${jobDir}/${destName.replace(/\.mp4$/, "")}.tmp-${randomUUID()}.mp4`;
  const stats: VideoRegionStats[] = [await analyzeVideoRegions(files[0]!, "reference")];
  const corrections: Array<VideoRegionStats | null> = [null];
  const cubes: Array<string | null> = [null];
  for (let index = 1; index < files.length; index++) {
    const target = await analyzeVideoRegions(files[index]!, "target");
    const correction = buildLabCorrections(stats[0]!, target);
    const cube = `${jobDir}/color-match-${randomUUID()}.cube`;
    writeColorCube(cube, target, correction);
    stats.push(target);
    corrections.push(correction);
    cubes.push(cube);
  }
  const args = ["-y"];
  files.forEach((file) => args.push("-i", file));
  const graph: string[] = [];
  const concatInputs: string[] = [];
  files.forEach((_, index) => {
    const grade = cubes[index] ? `lut3d=file=${cubes[index]}:interp=tetrahedral,` : "";
    graph.push(`[${index}:v]${grade}setpts=PTS-STARTPTS,setsar=1,format=yuv420p[v${index}]`);
    graph.push(`[${index}:a]aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS[a${index}]`);
    concatInputs.push(`[v${index}][a${index}]`);
  });
  graph.push(`${concatInputs.join("")}concat=n=${files.length}:v=1:a=1[v][a]`);
  args.push(
    "-filter_complex",
    graph.join(";"),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "16",
    "-threads",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    tempDest,
  );
  try {
    await exec("ffmpeg", args, { maxBuffer: 8 * 1024 * 1024 });
    renameSync(tempDest, dest);
  } finally {
    if (existsSync(tempDest)) unlinkSync(tempDest);
    cubes.forEach((cube) => {
      if (cube && existsSync(cube)) unlinkSync(cube);
    });
  }
  return { method: "regional_lab_lut_v2", stats, corrections };
}

export async function concatCopy(jobDir: string, rels: string[], destName = "final.mp4"): Promise<void> {
  const list = rels.map((r) => `file '${r.replace(/'/g, "'\\''")}'`).join("\n");
  const token = randomUUID();
  const listPath = `${jobDir}/concat-${token}.txt`;
  const dest = `${jobDir}/${destName}`;
  const tempDest = `${jobDir}/${destName.replace(/\.mp4$/, "")}.tmp-${token}.mp4`;
  const temporaryFiles = [listPath, tempDest];
  writeFileSync(listPath, list + "\n");
  try {
    await exec("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", tempDest], {
      cwd: jobDir,
    });
  } catch {
    const norms: string[] = [];
    for (let i = 0; i < rels.length; i++) {
      const out = rels[i]!.replace(/\.mp4$/, `.norm-${token}.mp4`);
      await exec("ffmpeg", [
        "-y",
        "-i",
        `${jobDir}/${rels[i]}`,
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        `${jobDir}/${out}`,
      ]);
      norms.push(out);
      temporaryFiles.push(`${jobDir}/${out}`);
    }
    writeFileSync(listPath, norms.map((r) => `file '${r}'`).join("\n") + "\n");
    await exec("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", tempDest], {
      cwd: jobDir,
    });
  } finally {
    if (existsSync(tempDest)) renameSync(tempDest, dest);
    temporaryFiles.forEach((file) => {
      if (existsSync(file)) unlinkSync(file);
    });
  }
}

export function sniffAudio(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  if (buf.toString("ascii", 0, 4) === "RIFF") return true;
  if (buf.toString("ascii", 0, 3) === "ID3") return true;
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true;
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return true;
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") return true;
  return false;
}
