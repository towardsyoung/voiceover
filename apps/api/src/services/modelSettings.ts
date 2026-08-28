import { db } from "../db.js";
import { nowIso } from "../ids.js";

export const ARK_VIDEO_MODELS = [
  { id: "seedance-2.0", label: "Seedance 2.0", env: "ARK_MODEL_SEEDANCE_20", fallback: "doubao-seedance-2-0-260128", minSec: 4, maxSec: 15 },
  { id: "seedance-2.0-fast", label: "Seedance 2.0 Fast", env: "ARK_MODEL_SEEDANCE_20_FAST", fallback: "doubao-seedance-2-0-fast-260128", minSec: 4, maxSec: 15 },
  { id: "seedance-2.0-mini", label: "Seedance 2.0 Mini", env: "ARK_MODEL_SEEDANCE_20_MINI", fallback: "doubao-seedance-2-0-mini-260615", minSec: 4, maxSec: 15 },
  { id: "seedance-2.5", label: "Seedance 2.5", env: "ARK_MODEL_SEEDANCE_25", fallback: "doubao-seedance-2-5-260628", minSec: 4, maxSec: 30 },
  { id: "seedance-2.0-real", label: "Seedance 2.0（真人）", env: "ARK_MODEL_SEEDANCE_20_REAL", fallback: "doubao-seedance-2-0-real", minSec: 4, maxSec: 15 },
  { id: "seedance-2.0-fast-real", label: "Seedance 2.0 Fast（真人）", env: "ARK_MODEL_SEEDANCE_20_FAST_REAL", fallback: "doubao-seedance-2-0-fast-260128", minSec: 4, maxSec: 15 },
  { id: "seedance-2.0-mini-real", label: "Seedance 2.0 Mini（真人）", env: "ARK_MODEL_SEEDANCE_20_MINI_REAL", fallback: "doubao-seedance-2-0-mini-260615", minSec: 4, maxSec: 15 },
  { id: "seedance-2.5-real", label: "Seedance 2.5（真人）", env: "ARK_MODEL_SEEDANCE_25_REAL", fallback: "doubao-seedance-2-5-real", minSec: 4, maxSec: 30 },
] as const;

export const MINIMAX_VIDEO_MODEL = "MiniMax-H3";

export type ModelSettings = {
  llm: { baseUrl: string; apiKey: string; model: string; jsonMode: "json_schema" | "json_object" };
  image: { baseUrl: string; apiKey: string; model: string; size: string; quality: string };
  ark: { baseUrl: string; apiKey: string; models: Record<string, string> };
  minimax: { baseUrl: string; apiKey: string; model: string };
  defaultVideoModel: string;
  attachPrevVideo: boolean;
};

const cleanUrl = (value: unknown) => String(value || "").trim().replace(/\/+$/, "");
const clean = (value: unknown) => String(value || "").trim();
const legacyFlag = (name: string) => ["1", "true"].includes(String(process.env[name] || "").toLowerCase());

function legacySettings(): ModelSettings {
  return {
    llm: {
      baseUrl: cleanUrl(process.env.LLM_BASE_URL),
      apiKey: clean(process.env.LLM_API_KEY),
      model: clean(process.env.LLM_MODEL),
      jsonMode: process.env.LLM_JSON_MODE === "json_object" ? "json_object" : "json_schema",
    },
    image: {
      baseUrl: cleanUrl(process.env.IMAGE_BASE_URL || process.env.OPENAI_BASE_URL),
      apiKey: clean(process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY),
      model: clean(process.env.IMAGE_MODEL),
      size: clean(process.env.IMAGE_SIZE) || "1024x1024",
      quality: clean(process.env.IMAGE_QUALITY),
    },
    ark: {
      baseUrl: cleanUrl(process.env.ARK_BASE_URL) || "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: clean(process.env.ARK_API_KEY),
      models: Object.fromEntries(ARK_VIDEO_MODELS.map((m) => [m.id, clean(process.env[m.env]) || m.fallback])),
    },
    minimax: {
      baseUrl: cleanUrl(process.env.MINIMAX_BASE_URL) || "https://api.minimaxi.com",
      apiKey: clean(process.env.MINIMAX_API_KEY),
      model: clean(process.env.MINIMAX_MODEL) || MINIMAX_VIDEO_MODEL,
    },
    defaultVideoModel: clean(process.env.DEFAULT_VIDEO_MODEL),
    attachPrevVideo: legacyFlag("ATTACH_PREV_VIDEO"),
  };
}

let current = legacySettings();

export async function initModelSettings(): Promise<void> {
  const row = await db("app_settings").where({ key: "models" }).first();
  if (row) {
    current = normalizeModelSettings(JSON.parse(String(row.value_json)));
    return;
  }
  await saveModelSettings(current);
}

export function getModelSettings(): ModelSettings {
  return current;
}

export function normalizeModelSettings(input: Partial<ModelSettings>): ModelSettings {
  const models = Object.fromEntries(
    ARK_VIDEO_MODELS.map((m) => [m.id, clean(input.ark?.models?.[m.id])]),
  );
  return {
    llm: {
      baseUrl: cleanUrl(input.llm?.baseUrl),
      apiKey: clean(input.llm?.apiKey),
      model: clean(input.llm?.model),
      jsonMode: input.llm?.jsonMode === "json_object" ? "json_object" : "json_schema",
    },
    image: {
      baseUrl: cleanUrl(input.image?.baseUrl),
      apiKey: clean(input.image?.apiKey),
      model: clean(input.image?.model),
      size: clean(input.image?.size) || "1024x1024",
      quality: clean(input.image?.quality),
    },
    ark: { baseUrl: cleanUrl(input.ark?.baseUrl), apiKey: clean(input.ark?.apiKey), models },
    minimax: {
      baseUrl: cleanUrl(input.minimax?.baseUrl),
      apiKey: clean(input.minimax?.apiKey),
      model: clean(input.minimax?.model),
    },
    defaultVideoModel: clean(input.defaultVideoModel),
    attachPrevVideo: Boolean(input.attachPrevVideo),
  };
}

export function enabledVideoModelIds(settings = current): string[] {
  const ids: string[] = settings.ark.apiKey && settings.ark.baseUrl
    ? ARK_VIDEO_MODELS.filter((m) => settings.ark.models[m.id]).map((m) => m.id)
    : [];
  if (settings.minimax.apiKey && settings.minimax.baseUrl && settings.minimax.model) ids.push(MINIMAX_VIDEO_MODEL);
  return ids;
}

export function isLlmEnabled(settings = current): boolean {
  return Boolean(settings.llm.baseUrl && settings.llm.apiKey && settings.llm.model);
}

export function isImageEnabled(settings = current): boolean {
  return Boolean(settings.image.baseUrl && settings.image.apiKey && settings.image.model);
}

export async function saveModelSettings(input: Partial<ModelSettings>): Promise<ModelSettings> {
  const next = normalizeModelSettings(input);
  const enabled = enabledVideoModelIds(next);
  if (!enabled.includes(next.defaultVideoModel)) next.defaultVideoModel = enabled[0] || "";
  await db("app_settings").insert({
    key: "models",
    value_json: JSON.stringify(next),
    updated_at: nowIso(),
  }).onConflict("key").merge();
  current = next;
  return current;
}
