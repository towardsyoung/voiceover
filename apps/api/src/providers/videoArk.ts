import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { env } from "../env.js";
import { ApiError } from "../errors.js";
import { modelLimits } from "../skills/koubo.js";
import type { VideoGenRequest, VideoPoll, VideoProvider } from "./video.js";
import { getApprovedCharacterAsset, hasAssetConfig, prepareRealReferenceList, type PreparedReference } from "./volcengineAsset.js";

function log(msg: string) {
  console.log(`[videoArk] ${msg}`);
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
};

function dataUrl(path: string): string {
  const ext = extname(path).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

const SEEDANCE_MODELS = new Set([
  "seedance-2.0",
  "seedance-2.0-fast",
  "seedance-2.0-mini",
  "seedance-2.5",
  "seedance-2.0-real",
  "seedance-2.0-fast-real",
  "seedance-2.0-mini-real",
  "seedance-2.5-real",
]);

const REAL_MODELS = new Set([
  "seedance-2.0-real",
  "seedance-2.0-fast-real",
  "seedance-2.0-mini-real",
  "seedance-2.5-real",
]);

export class ArkSeedanceProvider implements VideoProvider {
  id = "ark";

  supports(model: string): boolean {
    return SEEDANCE_MODELS.has(model);
  }

  limits(model: string) {
    return modelLimits(model);
  }

  private isRealModel(model: string): boolean {
    return REAL_MODELS.has(model);
  }

  private arkModelId(model: string): string {
    if (model === "seedance-2.0-fast") return env.arkModel20Fast;
    if (model === "seedance-2.0-mini") return env.arkModel20Mini;
    if (model === "seedance-2.5") return env.arkModel25;
    if (model === "seedance-2.0-real") return env.arkModel20Real;
    if (model === "seedance-2.0-fast-real") return env.arkModel20FastReal;
    if (model === "seedance-2.0-mini-real") return env.arkModel20MiniReal;
    if (model === "seedance-2.5-real") return env.arkModel25Real;
    return env.arkModel20;
  }

  async submit(req: VideoGenRequest): Promise<string> {
    if (!this.supports(req.model)) {
      throw new ApiError(400, "validation_failed", `方舟 provider 不支持模型 ${req.model}`);
    }
    if (!env.featureVideoGen) throw new ApiError(400, "feature_disabled", "未开启 FEATURE_VIDEO_GEN");
    if (!env.arkApiKey) throw new ApiError(400, "feature_disabled", "未配置 ARK_API_KEY");
    if (req.resolution !== "480p" && req.resolution !== "720p") {
      throw new ApiError(400, "validation_failed", "方舟模型只支持 480p / 720p");
    }
    const lim = this.limits(req.model);
    const duration = Math.max(lim.min, Math.min(lim.max, Math.round(req.durationSec)));
    const content: Record<string, unknown>[] = [{ type: "text", text: req.prompt }];

    // 真人模型：参考图必须提交火山素材库审核，审核通过后用 asset:// URI；
    // 任何一张图未能通过素材库都直接报错（回退 base64 会触发方舟真人风控，报错不可理解）
    const isReal = this.isRealModel(req.model);

    let imageUrls: PreparedReference[] | null = null;
    if (isReal) {
      log(`真人模型 ${req.model} 素材库检查: ak/sk=${hasAssetConfig()} 图片数=${req.images.length}`);
      // 人物板（images[0]）优先复用人物资产库中已审核的 assetId，避免每次生成重复提交审核
      if (req.characterId && req.images.length > 0) {
        const approvedId = await getApprovedCharacterAsset(req.characterId);
        if (approvedId) {
          log(`人物板复用已审核素材: character=${req.characterId} asset://${approvedId}`);
          const rest = await prepareRealReferenceList(req.images.slice(1), true);
          imageUrls = [{ url: `asset://${approvedId}`, isAsset: true }, ...rest];
        }
      }
      if (!imageUrls) {
        imageUrls = await prepareRealReferenceList(req.images, true);
      }
      const failed = imageUrls.filter((x) => !x.isAsset);
      if (failed.length) {
        const reasons = failed.map((f) => f.reason || "未知原因").join("；");
        throw new ApiError(
          400,
          "provider_moderation",
          `真人模型参考图未通过火山素材库审核，无法生成：${reasons}。请先在人物资产库提交审核（推荐配置阿里云 OSS：OSS_ACCESS_KEY_ID/SECRET/REGION/BUCKET/PUBLIC_BASE_URL），并确认参考图为真人本人授权素材。`,
        );
      }
      log(`参考图全部通过素材库: ${imageUrls.length} 张 asset:// 引用`);
    } else {
      // 非真人模型：本地图片直接转 base64 data URL（此处仅保留路径，循环内再转换）
      imageUrls = req.images.map((p) => ({ url: p, isAsset: false }));
    }
    for (const { url, isAsset } of imageUrls) {
      // asset:// URI 直接透传；普通图片转 base64 data URL
      const imageUrl = isAsset ? url : dataUrl(url);
      content.push({ type: "image_url", image_url: { url: imageUrl }, role: "reference_image" });
    }
    for (const p of req.audios) {
      content.push({ type: "audio_url", audio_url: { url: dataUrl(p) }, role: "reference_audio" });
    }
    for (const p of req.videos) {
      content.push({ type: "video_url", video_url: { url: dataUrl(p) }, role: "reference_video" });
    }
    const body: Record<string, unknown> = {
      model: this.arkModelId(req.model),
      content,
      resolution: req.resolution,
      ratio: req.aspectRatio,
      duration,
      watermark: false,
      generate_audio: req.generateAudio,
    };
    log(`提交视频任务: model=${req.model} arkModel=${body.model} duration=${duration}s resolution=${req.resolution} ratio=${req.aspectRatio} 图片=${req.images.length} 音频=${req.audios.length} 视频=${req.videos.length}`);
    const promptChars = Array.from(req.prompt).length;
    log("完整视频提示词 (" + promptChars + "字):\n" + req.prompt);
    const startedAt = Date.now();
    const res = await fetch(`${env.arkBaseUrl}/contents/generations/tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.arkApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const cost = Date.now() - startedAt;
    const raw = await res.text();
    let json = {} as { id?: string; task_id?: string; error?: { message?: string; code?: string } };
    try {
      json = JSON.parse(raw) as typeof json;
    } catch {
      /* 非 JSON 响应 */
    }
    const taskId = String(json.id || json.task_id || "").trim();
    if (!res.ok || !taskId) {
      const code = /moderat|sensitive|risk|audit/i.test(json.error?.message || "")
        ? "provider_moderation"
        : res.status >= 500
          ? "provider_5xx"
          : "provider_bad_input";
      const msg =
        json.error?.message ||
        (raw && !/^\s*</.test(raw) ? raw.slice(0, 200) : `方舟返回 ${res.status}（非 JSON，请检查 ARK_BASE_URL）`);
      log(`提交失败: status=${res.status} cost=${cost}ms code=${code} message=${msg}`);
      throw new ApiError(res.status || 400, code, msg || "方舟创建任务失败");
    }
    log(`提交成功: requestId=${taskId} status=${res.status} cost=${cost}ms`);
    return taskId;
  }

  async poll(requestId: string): Promise<VideoPoll> {
    const startedAt = Date.now();
    let res: Response;
    try {
      res = await fetch(`${env.arkBaseUrl}/contents/generations/tasks/${requestId}`, {
        headers: { Authorization: `Bearer ${env.arkApiKey}` },
      });
    } catch (err) {
      const msg = (err as Error).message || "fetch failed";
      log(`轮询网络错误: requestId=${requestId} message=${msg}`);
      return { status: "unavailable", message: msg };
    }
    const cost = Date.now() - startedAt;
    const raw = await res.text();
    let json = {} as { status?: string; content?: { video_url?: string }; error?: { message?: string } };
    try {
      json = JSON.parse(raw) as typeof json;
    } catch {
      /* 非 JSON */
    }
    if (!res.ok) {
      const msg =
        json.error?.message ||
        (raw && !/^\s*</.test(raw) ? raw.slice(0, 200) : `查询返回 ${res.status}（非 JSON）`);
      if (res.status >= 500 || res.status === 429) {
        log(`轮询暂不可用: requestId=${requestId} status=${res.status} cost=${cost}ms message=${msg}`);
        return { status: "unavailable", message: msg || `查询 ${res.status}` };
      }
      log(`轮询失败: requestId=${requestId} status=${res.status} cost=${cost}ms message=${msg}`);
      return { status: "failed", code: "provider_5xx", message: msg || `查询 ${res.status}` };
    }
    const st = (json.status || "").toLowerCase();
    if (st === "succeeded" || st === "success") {
      const url = json.content?.video_url;
      if (!url) return { status: "failed", code: "provider_bad_input", message: "成功但没有 video_url" };
      log(`轮询成功: requestId=${requestId} cost=${cost}ms`);
      return { status: "succeeded", url };
    }
    if (st === "failed" || st === "cancelled" || st === "canceled") {
      const msg = json.error?.message || st;
      const code = /moderat|sensitive|risk|audit/i.test(msg) ? "provider_moderation" : "provider_bad_input";
      log(`轮询终态失败: requestId=${requestId} status=${st} cost=${cost}ms message=${msg}`);
      return { status: "failed", code, message: msg };
    }
    return { status: st === "queued" || st === "pending" ? "queued" : "running" };
  }

  async download(url: string, dest: string): Promise<void> {
    const startedAt = Date.now();
    const res = await fetch(url);
    const cost = Date.now() - startedAt;
    if (!res.ok) {
      log(`下载成片失败: status=${res.status} cost=${cost}ms dest=${dest}`);
      throw new ApiError(502, "provider_5xx", `下载成片失败 ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    log(`下载成片成功: status=${res.status} cost=${cost}ms bytes=${buf.length}`);
  }

  async cancel(requestId: string): Promise<void> {
    try {
      const res = await fetch(`${env.arkBaseUrl}/contents/generations/tasks/${requestId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${env.arkApiKey}` },
      });
      log(`取消任务: requestId=${requestId} status=${res.status}`);
    } catch (e) {
      log(`取消任务失败: requestId=${requestId} ${(e as Error).message}`);
    }
  }
}
