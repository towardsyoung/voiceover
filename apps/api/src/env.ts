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

function flag(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

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
  featureImageGen: flag("FEATURE_IMAGE_GEN", false),
  featureVideoGen: flag("FEATURE_VIDEO_GEN", false),
  defaultVideoModel: process.env.DEFAULT_VIDEO_MODEL || "seedance-2.0",
  voiceMaxSec: 15,
  imageMaxMb: 20,
  audioMaxMb: 15,
  imageApiKey: process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY || "",
  imageBaseUrl: (process.env.IMAGE_BASE_URL || process.env.OPENAI_BASE_URL || "").replace(/\/$/, ""),
  imageModel: process.env.IMAGE_MODEL || "",
  imageSize: process.env.IMAGE_SIZE || "1024x1024",
  imageQuality: process.env.IMAGE_QUALITY || "",
  llmBaseUrl: (process.env.LLM_BASE_URL || "").replace(/\/$/, ""),
  llmApiKey: process.env.LLM_API_KEY || "",
  llmModel: process.env.LLM_MODEL || "",
  llmJsonMode: process.env.LLM_JSON_MODE || "json_schema",
  leaseSec: Number(process.env.LEASE_SEC || 60),
  arkApiKey: process.env.ARK_API_KEY || "",
  arkBaseUrl: (process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, ""),
  arkModel20: process.env.ARK_MODEL_SEEDANCE_20 || "doubao-seedance-2-0-260128",
  arkModel20Fast: process.env.ARK_MODEL_SEEDANCE_20_FAST || "doubao-seedance-2-0-fast-260128",
  arkModel20Mini: process.env.ARK_MODEL_SEEDANCE_20_MINI || "doubao-seedance-2-0-mini-260615",
  arkModel25: process.env.ARK_MODEL_SEEDANCE_25 || "doubao-seedance-2-5-260628",
  // 真人模型（需配合火山素材库 AK/SK 使用）
  arkModel20Real: process.env.ARK_MODEL_SEEDANCE_20_REAL || "doubao-seedance-2-0-real",
  arkModel20FastReal: process.env.ARK_MODEL_SEEDANCE_20_FAST_REAL || "doubao-seedance-2-0-fast-260128",
  arkModel20MiniReal: process.env.ARK_MODEL_SEEDANCE_20_MINI_REAL || "doubao-seedance-2-0-mini-260615",
  arkModel25Real: process.env.ARK_MODEL_SEEDANCE_25_REAL || "doubao-seedance-2-5-real",
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
  minimaxApiKey: process.env.MINIMAX_API_KEY || "",
  minimaxBaseUrl: (process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com").replace(/\/$/, ""),
  minimaxModel: process.env.MINIMAX_MODEL || "MiniMax-H3",
  attachPrevVideo: flag("ATTACH_PREV_VIDEO", false),
};
