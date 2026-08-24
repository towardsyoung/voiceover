import { execFile } from "node:child_process";
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

export async function concatCopy(jobDir: string, rels: string[], destName = "final.mp4"): Promise<void> {
  const list = rels.map((r) => `file '${r.replace(/'/g, "'\\''")}'`).join("\n");
  const listPath = `${jobDir}/concat.txt`;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(listPath, list + "\n");
  try {
    await exec("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", `${jobDir}/${destName}`], {
      cwd: jobDir,
    });
  } catch {
    const norms: string[] = [];
    for (let i = 0; i < rels.length; i++) {
      const out = rels[i]!.replace(/\.mp4$/, ".norm.mp4");
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
    }
    writeFileSync(listPath, norms.map((r) => `file '${r}'`).join("\n") + "\n");
    await exec("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", `${jobDir}/${destName}`], {
      cwd: jobDir,
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
