import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function findRepoRoot(from = here): string {
  let dir = from;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();
export const RESOURCE_ROOT = process.env.VOICEOVER_RESOURCE_DIR
  ? resolve(process.env.VOICEOVER_RESOURCE_DIR)
  : REPO_ROOT;

function loadDotenv() {
  const path = join(REPO_ROOT, ".env");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotenv();

export function resolveDataDir(): string {
  const fromEnv = process.env.VOICEOVER_DATA_DIR || process.env.DATA_DIR;
  if (fromEnv) {
    return isAbsolute(fromEnv) ? fromEnv : resolve(REPO_ROOT, fromEnv);
  }
  if (process.env.ELECTRON_USER_DATA) {
    return join(process.env.ELECTRON_USER_DATA, "data");
  }
  return join(REPO_ROOT, "data");
}

export const env = {
  host: process.env.API_HOST || "127.0.0.1",
  port: Number(process.env.API_PORT || 18787),
  dataDir: resolveDataDir(),
  resourceRoot: RESOURCE_ROOT,
  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH || "ffprobe",
  voiceMaxSec: 15,
  imageMaxMb: 20,
  audioMaxMb: 15,
  leaseSec: Number(process.env.LEASE_SEC || 60),
  // 火山素材库（真人参考图审核）
  arkAssetAk: process.env.ARK_ASSET_AK || "",
  arkAssetSk: process.env.ARK_ASSET_SK || "",
  arkAssetRegion: process.env.ARK_ASSET_REGION || "cn-beijing",
  arkAssetService: process.env.ARK_ASSET_SERVICE || "ark",
  arkAssetBaseUrl: (process.env.ARK_ASSET_BASE_URL || "https://ark.cn-beijing.volcengineapi.com").replace(/\/+$/, ""),
  arkAssetApiVersion: process.env.ARK_ASSET_API_VERSION || "2024-01-01",
  arkAssetGroupId: process.env.ARK_ASSET_GROUP_ID || "",
  arkAssetProjectName: process.env.ARK_ASSET_PROJECT_NAME || "default",
  arkAssetGroupName: process.env.ARK_ASSET_GROUP_NAME || "voiceover-private-avatar",
  arkAssetPollTimeoutMs: Number(process.env.ARK_ASSET_POLL_TIMEOUT_MS || 30000),
  arkAssetPollIntervalMs: Number(process.env.ARK_ASSET_POLL_INTERVAL_MS || 5000),
  // 阿里云 OSS（真人参考图公网 URL 来源，火山素材库 CreateAsset 拉取用）
  ossAccessKeyId: process.env.OSS_ACCESS_KEY_ID || "",
  ossAccessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || "",
  ossRegion: (process.env.OSS_REGION || "").replace(/^oss:\/\//, ""),
  ossBucket: process.env.OSS_BUCKET || "",
  ossEndpoint: (process.env.OSS_ENDPOINT || "").replace(/\/+$/, ""),
  ossPublicBaseUrl: (process.env.OSS_PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
  ossPrefix: (process.env.OSS_PREFIX || "").replace(/^\/+|\/+$/g, ""),
};
