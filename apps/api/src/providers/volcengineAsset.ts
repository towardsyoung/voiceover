/**
 * 火山方舟素材库（私域虚拟人像）辅助模块
 *
 * Seedance 真人模型要求参考图先提交到火山素材库审核，
 * 审核通过后用 `asset://<assetId>` 作为 image_url，而非直接传 base64/URL。
 *
 * 官方文档: https://www.volcengine.com/docs/82379/2333565
 *
 * 公网 URL 来源优先级（素材库 CreateAsset 只接受公网 HTTP(S) URL）:
 * 1. 已是 http(s):// URL → 原样使用
 * 2. 已配置阿里云 OSS（对标 Toonflow）→ 上传 OSS 取公网 URL（推荐）
 *
 * 人物资产（characters 表）:
 * - submitCharacterAsset: 人物板 → OSS → CreateAsset → 轮询 → assetId/状态落库
 * - refreshCharacterAsset: GetAsset 刷新审核状态
 * - getApprovedCharacterAsset: 真人模型生成时直接取 approved assetId
 */

import { createHash, createHmac } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { db } from "../db.js";
import { env } from "../env.js";
import { hasOssConfig, uploadImageToOss } from "./oss.js";

// ============================================================
// 类型
// ============================================================

export type AssetStatus = "submitting" | "auditing" | "approved" | "rejected" | "failed" | "unknown";

export interface PreparedReference {
  url: string; // asset://<id> 或原始本地路径/公网 URL
  isAsset: boolean;
  reason?: string; // 未走 asset 的原因（真人模型下用于明确报错）
}

interface AssetConfig {
  ak: string;
  sk: string;
  region: string;
  service: string;
  baseUrl: string;
  version: string;
  groupId: string;
  projectName: string;
  groupName: string;
}

interface SubmitResult {
  assetId?: string;
  taskId?: string;
  groupId?: string;
  status: AssetStatus;
  reason?: string;
  raw?: unknown;
}

// 内存缓存: filePath → { assetId, status, ts }，避免同一张图重复提交
const assetCache = new Map<string, { assetId: string; status: AssetStatus; ts: number }>();

// ============================================================
// 日志
// ============================================================

function log(msg: string) {
  console.log(`[volcengine-asset] ${msg}`);
}

function redactAk(ak: string): string {
  if (!ak) return "";
  if (ak.length <= 8) return "******";
  return `${ak.slice(0, 4)}******${ak.slice(-4)}`;
}

// ============================================================
// 配置检查
// ============================================================

export function hasAssetConfig(): boolean {
  return Boolean(env.arkAssetAk && env.arkAssetSk);
}

/** 是否有公网 URL 来源（OSS） */
export function hasPublicBaseUrl(): boolean {
  return hasOssConfig() && Boolean(env.ossPublicBaseUrl);
}

/**
 * 把本地素材路径解析为公网可访问 URL（供火山素材库 CreateAsset 拉取）。优先级：
 * 1. 已是 http(s):// 或 asset:// → 原样返回
 * 2. OSS 已配置 → 上传到 OSS 返回公网 URL（内容 hash 去重，不重复上传）
 * 3. 未配置 OSS → null
 */
export async function resolveAssetSourceUrl(filePath: string): Promise<string | null> {
  if (/^(https?|asset):\/\//i.test(filePath)) return filePath;
  if (hasOssConfig() && env.ossPublicBaseUrl) {
    return uploadImageToOss(filePath);
  }
  return null;
}

function getAssetConfig(): AssetConfig {
  if (!env.arkAssetAk || !env.arkAssetSk) {
    throw new Error("火山素材库缺少 AK/SK，请配置 ARK_ASSET_AK / ARK_ASSET_SK");
  }
  return {
    ak: env.arkAssetAk,
    sk: env.arkAssetSk,
    region: env.arkAssetRegion,
    service: env.arkAssetService,
    baseUrl: env.arkAssetBaseUrl,
    version: env.arkAssetApiVersion,
    groupId: env.arkAssetGroupId,
    projectName: env.arkAssetProjectName,
    groupName: env.arkAssetGroupName,
  };
}

// ============================================================
// AK/SK HMAC-SHA256 签名（火山 V4 签名）
// ============================================================

function uriEscape(value: string): string {
  return encodeURIComponent(value)
    .replace(/[^A-Za-z0-9_.~%-]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQueryString(searchParams: URLSearchParams): string {
  const entries: [string, string][] = [];
  searchParams.forEach((value, key) => entries.push([key, value]));
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${uriEscape(k)}=${uriEscape(v)}`)
    .join("&");
}

function sha256hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: Buffer | string, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function buildSignedHeaders(params: {
  method: "GET" | "POST";
  url: string;
  body: string;
  config: AssetConfig;
}): Record<string, string> {
  const parsed = new URL(params.url);
  const now = new Date();
  const xDate = toAmzDate(now);
  const shortDate = xDate.slice(0, 8);
  const bodyHash = sha256hex(params.body);
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const canonicalHeaders = `content-type:application/json\nhost:${parsed.host}\nx-content-sha256:${bodyHash}\nx-date:${xDate}\n`;
  const canonicalRequest = [
    params.method,
    parsed.pathname || "/",
    canonicalQueryString(parsed.searchParams),
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join("\n");
  const credentialScope = `${shortDate}/${params.config.region}/${params.config.service}/request`;
  const stringToSign = ["HMAC-SHA256", xDate, credentialScope, sha256hex(canonicalRequest)].join("\n");
  const kDate = hmac(params.config.sk, shortDate);
  const kRegion = hmac(kDate, params.config.region);
  const kService = hmac(kRegion, params.config.service);
  const kSigning = hmac(kService, "request");
  const signature = hmacHex(kSigning, stringToSign);
  return {
    "Content-Type": "application/json",
    Host: parsed.host,
    "X-Content-Sha256": bodyHash,
    "X-Date": xDate,
    Authorization: `HMAC-SHA256 Credential=${params.config.ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function buildActionUrl(baseUrl: string, action: string, version: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("Action", action);
  url.searchParams.set("Version", version);
  return url.toString();
}

// ============================================================
// 状态映射
// ============================================================

function mapStatus(raw?: string): AssetStatus {
  const s = (raw || "").toLowerCase();
  if (["active", "approved", "completed", "succeeded", "success"].includes(s)) return "approved";
  if (["failed", "rejected", "error"].includes(s)) return "rejected";
  if (["processing", "running", "pending", "submitted", "auditing"].includes(s)) return "auditing";
  return s ? "unknown" : "auditing";
}

function pickResult(raw: any): any {
  return raw?.Result ?? raw?.result ?? raw?.data?.Result ?? raw?.data?.result ?? raw?.data ?? raw;
}

// ============================================================
// 签名请求（带日志，不记录图片内容/base64）
// ============================================================

async function signedRequest(
  method: "GET" | "POST",
  url: string,
  body: unknown | null,
  config: AssetConfig,
): Promise<any> {
  const action = new URL(url).searchParams.get("Action") || "";
  const bodyString = method === "GET" ? "" : JSON.stringify(body ?? {});
  const headers = buildSignedHeaders({ method, url, body: bodyString, config });
  log(`请求 ${action} ${method} url=${url.replace(/([?&]Version=)[^&]*/, "$1***")}`);
  const startedAt = Date.now();
  const res = await fetch(url, {
    method,
    headers,
    body: method === "GET" ? undefined : bodyString,
  });
  const text = await res.text();
  const cost = Date.now() - startedAt;
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    log(`请求 ${action} 失败: status=${res.status} cost=${cost}ms 非 JSON: ${text.slice(0, 300)}`);
    throw new Error(`火山素材库请求失败: ${res.status} ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    const meta = json?.ResponseMetadata?.Error || json?.Error || {};
    log(`请求 ${action} 失败: status=${res.status} cost=${cost}ms Code=${meta.Code || ""} Message=${meta.Message || text.slice(0, 200)}`);
    throw new Error(`火山素材库请求失败: ${res.status} Code=${meta.Code || ""} Message=${meta.Message || text.slice(0, 200)}`);
  }
  log(`请求 ${action} 成功: status=${res.status} cost=${cost}ms`);
  return json;
}

// ============================================================
// 创建素材组
// ============================================================

async function createAssetGroup(config: AssetConfig): Promise<string> {
  const url = buildActionUrl(config.baseUrl, "CreateAssetGroup", config.version);
  const body = {
    Name: config.groupName,
    Description: "Voiceover private avatar assets",
    GroupType: "AIGC",
    ProjectName: config.projectName,
  };
  const raw = await signedRequest("POST", url, body, config);
  const result = pickResult(raw);
  const groupId = result?.Id || result?.id || result?.GroupId || result?.group_id;
  if (!groupId) throw new Error(`创建素材组成功但未返回 Id: ${JSON.stringify(raw).slice(0, 400)}`);
  log(`素材组已创建: ${groupId} (${config.groupName})`);
  return groupId;
}

async function ensureGroupId(config: AssetConfig): Promise<string> {
  if (config.groupId) return config.groupId;
  return createAssetGroup(config);
}

// ============================================================
// 提交素材
// ============================================================

async function submitAsset(params: {
  imageUrl: string;
  name: string;
  groupId: string;
  config: AssetConfig;
}): Promise<SubmitResult> {
  const { imageUrl, name, groupId, config } = params;
  const url = buildActionUrl(config.baseUrl, "CreateAsset", config.version);
  const body = {
    Name: name,
    URL: imageUrl,
    AssetType: "Image",
    GroupId: groupId,
    ProjectName: config.projectName,
  };
  const raw = await signedRequest("POST", url, body, config);
  const result = pickResult(raw);
  const assetId = result?.Id || result?.id || result?.AssetId || result?.asset_id || result?.AssetID;
  const taskId = result?.TaskId || result?.task_id || result?.TaskID;
  const status = assetId ? mapStatus(result?.Status || result?.status || "Processing") : mapStatus(result?.Status || result?.status);
  log(`CreateAsset 结果: assetId=${assetId || "-"} status=${status} groupId=${result?.GroupId || result?.group_id || groupId}`);
  return { assetId, taskId, groupId: result?.GroupId || result?.group_id || groupId, status, raw };
}

// ============================================================
// 查询素材状态
// ============================================================

async function queryAsset(params: {
  assetId: string;
  config: AssetConfig;
}): Promise<SubmitResult> {
  const { assetId, config } = params;
  const url = buildActionUrl(config.baseUrl, "GetAsset", config.version);
  const body = { Id: assetId, ProjectName: config.projectName };
  const raw = await signedRequest("POST", url, body, config);
  const result = pickResult(raw);
  const status = mapStatus(result?.Status || result?.status);
  log(`GetAsset 结果: assetId=${result?.Id || result?.id || assetId} status=${status} reason=${result?.Error?.Message || result?.error?.message || "-"}`);
  return {
    assetId: result?.Id || result?.id || assetId,
    status,
    reason: result?.Error?.Message || result?.error?.message,
    raw,
  };
}

// ============================================================
// 提交 + 轮询等待
// ============================================================

const TERMINAL_STATUSES: AssetStatus[] = ["approved", "rejected", "failed"];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 完整流程: 本地文件 → 公网 URL → 素材库提交 → 轮询审核 → 返回 assetId
 *
 * @param filePath 本地图片路径
 * @param name 素材名称
 * @returns { assetId, status } 或 null（失败时）
 */
export async function submitImageAssetAndWait(
  filePath: string,
  name: string,
): Promise<{ assetId: string; status: AssetStatus; groupId?: string; reason?: string } | null> {
  // 1. 检查缓存
  const cached = assetCache.get(filePath);
  if (cached && cached.status === "approved" && cached.assetId) {
    log(`使用缓存素材: ${filePath} → asset://${cached.assetId}`);
    return { assetId: cached.assetId, status: "approved" };
  }

  const config = getAssetConfig();

  // 2. 解析公网 URL（本地文件走 OSS 上传）
  const imageUrl = await resolveAssetSourceUrl(filePath);
  if (!imageUrl) {
    log(`无法生成公网 URL（未配置 OSS），素材库流程中断: ${filePath}`);
    return null;
  }

  // 3. 确保有素材组
  let groupId: string;
  try {
    groupId = await ensureGroupId(config);
  } catch (e: any) {
    log(`获取/创建素材组失败: ${e?.message || e}`);
    return null;
  }

  // 4. 提交素材
  let result: SubmitResult;
  try {
    result = await submitAsset({ imageUrl, name, groupId, config });
  } catch (e: any) {
    log(`素材提交失败: ${e?.message || e}`);
    return null;
  }

  if (!result.assetId) {
    log(`素材提交未返回 assetId，回退普通图片`);
    return null;
  }

  // 5. 缓存
  assetCache.set(filePath, { assetId: result.assetId, status: result.status, ts: Date.now() });

  // 6. 如果已终态，直接返回
  if (TERMINAL_STATUSES.includes(result.status)) {
    if (result.status === "approved") {
      return { assetId: result.assetId, status: "approved", groupId: result.groupId };
    }
    log(`素材审核未通过: status=${result.status}, reason=${result.reason || "-"}`);
    return { assetId: result.assetId, status: result.status, groupId: result.groupId, reason: result.reason };
  }

  // 7. 轮询等待审核
  const deadline = Date.now() + env.arkAssetPollTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(env.arkAssetPollIntervalMs);
    try {
      result = await queryAsset({ assetId: result.assetId!, config });
      assetCache.set(filePath, { assetId: result.assetId!, status: result.status, ts: Date.now() });
      if (TERMINAL_STATUSES.includes(result.status)) {
        if (result.status === "approved") {
          return { assetId: result.assetId!, status: "approved", groupId: result.groupId };
        }
        log(`素材审核未通过: status=${result.status}, reason=${result.reason || "-"}`);
        return { assetId: result.assetId!, status: result.status, groupId: result.groupId, reason: result.reason };
      }
    } catch (e: any) {
      log(`素材查询失败: ${e?.message || e}`);
    }
  }

  log(`素材审核轮询超时（${env.arkAssetPollTimeoutMs}ms），回退普通图片`);
  return null;
}

/**
 * 批量准备真人参考图列表
 *
 * 对标 Toonflow official.ts 的 prepareSeedanceRealReferenceList:
 * - 非真人模型 → 直接返回原路径
 * - 真人模型 + 未配置素材库/公网地址 → 原样返回并附 reason
 * - 真人模型 + 已配置 → 逐张提交素材库，审核通过则替换为 asset:// URI
 */
export async function prepareRealReferenceList(
  imagePaths: string[],
  isReal: boolean,
): Promise<PreparedReference[]> {
  if (!isReal) {
    return imagePaths.map((p) => ({ url: p, isAsset: false }));
  }
  if (!hasAssetConfig()) {
    return imagePaths.map((p) => ({ url: p, isAsset: false, reason: "未配置 ARK_ASSET_AK / ARK_ASSET_SK" }));
  }
  if (!hasPublicBaseUrl()) {
    return imagePaths.map((p) => ({
      url: p,
      isAsset: false,
      reason: "未配置公网 URL 来源（请配置阿里云 OSS：OSS_ACCESS_KEY_ID/SECRET/REGION/BUCKET/PUBLIC_BASE_URL，bucket 需公读）",
    }));
  }

  const src = hasOssConfig() && env.ossPublicBaseUrl ? `OSS(bucket=${env.ossBucket})` : "未配置";
  log(`准备真人参考图: ${imagePaths.length} 张（ak=${redactAk(env.arkAssetAk)} ${src}）`);

  return Promise.all(
    imagePaths.map(async (filePath, i) => {
      try {
        const result = await submitImageAssetAndWait(filePath, `voiceover-real-${Date.now()}-${i}`);
        if (result?.status === "approved" && result.assetId) {
          return { url: `asset://${result.assetId}`, isAsset: true };
        }
        const reason =
          result?.reason ||
          (result ? `素材审核未通过(status=${result.status})` : "素材提交/审核失败（见上方日志）");
        log(`参考图 ${i} 未通过素材库: ${filePath} → ${reason}`);
        return { url: filePath, isAsset: false, reason };
      } catch (e: any) {
        const reason = `参考图处理异常: ${e?.message || e}`;
        log(`参考图 ${i} 素材处理失败: ${reason}`);
        return { url: filePath, isAsset: false, reason };
      }
    }),
  );
}

// ============================================================
// 人物资产（characters 表）：提交审核 / 刷新状态 / 取 approved assetId
// 对标 Toonflow o_image 的 volcengineAsset* 字段与 submitImageAsset/queryImageAssetStatus
// ============================================================

function absBoardPath(boardPath: string): string {
  return isAbsolute(boardPath) ? boardPath : join(env.dataDir, boardPath);
}

export interface CharacterAssetState {
  assetId: string | null;
  status: string;
  reason: string | null;
  groupId: string | null;
  submittedAt: string | null;
  checkedAt: string | null;
}

/** 人物板被替换后，旧审核结果作废 */
export function volcResetPatch(): Record<string, unknown> {
  return {
    volc_asset_id: null,
    volc_asset_status: "none",
    volc_asset_reason: null,
    volc_submitted_at: null,
    volc_checked_at: null,
  };
}

/** 真人模型生成时调用：人物板已 approved 则直接返回 assetId（避免重复提交审核） */
export async function getApprovedCharacterAsset(characterId: string): Promise<string | null> {
  if (!characterId) return null;
  const row = await db("characters").where({ id: characterId }).first();
  if (row?.volc_asset_status === "approved" && row.volc_asset_id) {
    return String(row.volc_asset_id);
  }
  return null;
}

/**
 * 提交人物板到火山素材库审核（OSS → CreateAsset → 轮询至超时），状态落库。
 * 超时未出结果时状态停留在 auditing，可稍后调 refreshCharacterAsset 查询。
 */
export async function submitCharacterAsset(characterId: string): Promise<CharacterAssetState> {
  const row = await db("characters").where({ id: characterId }).first();
  if (!row?.board_path) throw new Error("人物不存在或缺少人物板");
  const boardAbs = absBoardPath(String(row.board_path));
  const now = new Date().toISOString();

  if (!hasAssetConfig()) throw new Error("未配置 ARK_ASSET_AK / ARK_ASSET_SK");
  if (!hasPublicBaseUrl()) throw new Error("未配置公网 URL 来源（请配置阿里云 OSS：OSS_ACCESS_KEY_ID/SECRET/REGION/BUCKET/PUBLIC_BASE_URL，bucket 需公读）");

  await db("characters").where({ id: characterId }).update({
    volc_asset_status: "submitting",
    volc_asset_reason: null,
    volc_submitted_at: now,
    updated_at: now,
  });

  try {
    const result = await submitImageAssetAndWait(boardAbs, `character-${characterId}-${Date.now()}`);
    const patch: Record<string, unknown> = {
      volc_asset_status: result ? result.status : "failed",
      volc_asset_reason: result?.reason || null,
      volc_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (result?.assetId) {
      patch.volc_asset_id = result.assetId;
      if (result.groupId) patch.volc_asset_group_id = result.groupId;
    }
    await db("characters").where({ id: characterId }).update(patch);
    return {
      assetId: (patch.volc_asset_id as string) || row.volc_asset_id || null,
      status: String(patch.volc_asset_status),
      reason: (patch.volc_asset_reason as string) || null,
      groupId: (patch.volc_asset_group_id as string) || row.volc_asset_group_id || null,
      submittedAt: now,
      checkedAt: String(patch.volc_checked_at),
    };
  } catch (e: any) {
    const reason = e?.message || String(e);
    await db("characters").where({ id: characterId }).update({
      volc_asset_status: "failed",
      volc_asset_reason: reason,
      volc_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    throw e;
  }
}

/** 刷新人物素材审核状态（GetAsset），落库并返回 */
export async function refreshCharacterAsset(characterId: string): Promise<CharacterAssetState> {
  const row = await db("characters").where({ id: characterId }).first();
  if (!row) throw new Error("人物不存在");
  const assetId = row.volc_asset_id ? String(row.volc_asset_id) : "";
  if (!assetId) {
    return {
      assetId: null,
      status: String(row.volc_asset_status || "none"),
      reason: row.volc_asset_reason ? String(row.volc_asset_reason) : null,
      groupId: row.volc_asset_group_id ? String(row.volc_asset_group_id) : null,
      submittedAt: row.volc_submitted_at ? String(row.volc_submitted_at) : null,
      checkedAt: row.volc_checked_at ? String(row.volc_checked_at) : null,
    };
  }
  const config = getAssetConfig();
  const result = await queryAsset({ assetId, config });
  const patch: Record<string, unknown> = {
    volc_asset_status: result.status,
    volc_asset_reason: result.reason || null,
    volc_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await db("characters").where({ id: characterId }).update(patch);
  return {
    assetId,
    status: result.status,
    reason: result.reason || null,
    groupId: row.volc_asset_group_id ? String(row.volc_asset_group_id) : null,
    submittedAt: row.volc_submitted_at ? String(row.volc_submitted_at) : null,
    checkedAt: String(patch.volc_checked_at),
  };
}
