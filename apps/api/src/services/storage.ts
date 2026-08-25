import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync, existsSync, realpathSync, lstatSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { env } from "../env.js";
import { fail } from "../errors.js";
import { ULID_RE } from "../ids.js";

export type FileKind = "characters" | "scenes" | "voices" | "jobs";

const IMAGE_EXT = "(?:jpg|jpeg|png|webp)";
const BOARD_RE = /^board(\.prev)?\.(jpg|jpeg|png|webp)$/;
const ALLOW: Record<FileKind, RegExp[]> = {
  characters: [
    BOARD_RE,
    new RegExp(`^sources/[A-Za-z0-9._-]{1,80}\\.${IMAGE_EXT}$`, "i"),
  ],
  scenes: [
    BOARD_RE,
    new RegExp(`^sources/[A-Za-z0-9._-]{1,80}\\.${IMAGE_EXT}$`, "i"),
  ],
  voices: [/^sample(\.prev)?\.wav$/],
  jobs: [
    /^storyboard\.json$/,
    /^final(?:\.prev|-original)?\.mp4$/,
    /^color-match\.json$/,
    /^shots\/\d{2}\/(video|end|end-gray|end-structure|request|provider)(\.(attempt|stale)\d+)?\.(mp4|jpg|png|json)$/,
    /^shots\/\d{2}\/log\.txt$/,
  ],
};

export function absStored(relFromData: string): string {
  return join(env.dataDir, relFromData);
}

export function kindDir(kind: FileKind, id: string): string {
  return join(env.dataDir, kind, id);
}

export function rotateBoard(kind: "characters" | "scenes", id: string): void {
  const dir = kindDir(kind, id);
  for (const ext of ["png", "jpg", "webp"]) {
    const board = join(dir, `board.${ext}`);
    if (!existsSync(board)) continue;
    const prev = join(dir, `board.prev.${ext}`);
    if (existsSync(prev)) rmSync(prev);
    renameSync(board, prev);
    return;
  }
}

export function clearSources(kind: "characters" | "scenes", id: string): void {
  const dir = join(kindDir(kind, id), "sources");
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    rmSync(join(dir, name), { force: true });
  }
}

export function rotateVoiceSample(id: string): void {
  const dir = kindDir("voices", id);
  const sample = join(dir, "sample.wav");
  if (!existsSync(sample)) return;
  const prev = join(dir, "sample.prev.wav");
  if (existsSync(prev)) rmSync(prev);
  renameSync(sample, prev);
}

export function restoreVoiceSample(id: string): void {
  const dir = kindDir("voices", id);
  const sample = join(dir, "sample.wav");
  const prev = join(dir, "sample.prev.wav");
  if (!existsSync(prev)) return;
  if (existsSync(sample)) rmSync(sample);
  renameSync(prev, sample);
}

export function ensureDir(kind: FileKind, id: string): string {
  const dir = kindDir(kind, id);
  mkdirSync(join(dir, "sources"), { recursive: true });
  if (kind === "jobs") mkdirSync(join(dir, "shots"), { recursive: true });
  return dir;
}

export function removeDir(kind: FileKind, id: string): void {
  const dir = kindDir(kind, id);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

export function fileUrl(kind: FileKind, id: string, rel: string, version?: unknown): string {
  const base = `/files/${kind}/${id}/${rel}`;
  if (version == null || version === "") return base;
  return `${base}?v=${encodeURIComponent(String(version))}`;
}

export function resolveRel(kind: FileKind, id: string, rel: string): string {
  if (!ULID_RE.test(id)) fail(404, "not_found", "无效资源");
  const normalized = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.startsWith("/")) {
    fail(404, "not_found", "路径不允许");
  }
  if (!ALLOW[kind].some((re) => re.test(normalized))) {
    fail(404, "not_found", "文件不在白名单");
  }
  const root = resolve(env.dataDir, kind, id);
  const abs = resolve(root, normalized);
  if (!abs.startsWith(root + sep) && abs !== root) {
    fail(404, "not_found", "路径越界");
  }
  if (existsSync(abs)) {
    if (lstatSync(abs).isSymbolicLink()) {
      const real = realpathSync(abs);
      if (!real.startsWith(root + sep) && real !== root) fail(404, "not_found", "路径越界");
    }
  }
  return abs;
}

export function writeBytes(kind: FileKind, id: string, rel: string, buf: Buffer): string {
  const abs = resolveRel(kind, id, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, buf);
  return `${kind}/${id}/${rel}`;
}

export function moveInto(kind: FileKind, id: string, rel: string, fromPath: string): string {
  const abs = resolveRel(kind, id, rel);
  mkdirSync(dirname(abs), { recursive: true });
  renameSync(fromPath, abs);
  return `${kind}/${id}/${rel}`;
}
