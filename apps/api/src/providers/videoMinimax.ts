import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { ApiError } from "../errors.js";
import { getModelSettings, MINIMAX_VIDEO_MODEL } from "../services/modelSettings.js";
import type { VideoGenRequest, VideoPoll, VideoProvider } from "./video.js";

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

interface MinimaxTaskPollResponse {
  status?: string;
  content?: { url?: string };
  error?: { message?: string };
}

interface MinimaxSubmitResponse {
  task_id?: string;
  id?: string;
  task?: { id?: string; task_id?: string };
  error?: { message?: string };
}

function extractTaskId(json: MinimaxSubmitResponse): string {
  const nested = json.task?.task_id || json.task?.id;
  return String(json.task_id || json.id || nested || "").trim();
}

export { MINIMAX_VIDEO_MODEL } from "../services/modelSettings.js";

function log(msg: string) {
  console.log(`[videoMinimax] ${msg}`);
}

export class MinimaxH3Provider implements VideoProvider {
  id = "minimax";

  supports(model: string): boolean {
    return model === MINIMAX_VIDEO_MODEL;
  }

  limits(): { min: number; max: number } {
    return { min: 2, max: 15 };
  }

  private modelId(): string {
    return getModelSettings().minimax.model;
  }

  private ensureEnv() {
    const settings = getModelSettings().minimax;
    if (!settings.apiKey || !settings.baseUrl || !settings.model) {
      throw new ApiError(400, "feature_disabled", "请先在模型设置中配置 MiniMax H3");
    }
  }

  private baseUrl(): string {
    return getModelSettings().minimax.baseUrl;
  }

  async submit(req: VideoGenRequest): Promise<string> {
    if (!this.supports(req.model)) {
      throw new ApiError(400, "validation_failed", `MiniMax provider 不支持模型 ${req.model}`);
    }
    this.ensureEnv();
    if (req.images.length > 9) throw new ApiError(400, "validation_failed", "MiniMax-H3 最多 9 张参考图");
    const totalMedia = req.images.length + req.videos.length + req.audios.length;
    if (totalMedia > 12) throw new ApiError(400, "validation_failed", "MiniMax-H3 混合输入总上限 12 个文件");
    const lim = this.limits();
    const duration = Math.max(lim.min, Math.min(lim.max, Math.round(req.durationSec)));
    const content: Record<string, unknown>[] = [{ type: "text", text: req.prompt }];
    for (const p of req.images) {
      content.push({ type: "image_url", image_url: { url: dataUrl(p) }, role: "reference_image" });
    }
    for (const p of req.audios) {
      content.push({ type: "audio_url", audio_url: { url: dataUrl(p) }, role: "reference_audio" });
    }
    for (const p of req.videos) {
      content.push({ type: "video_url", video_url: { url: dataUrl(p) }, role: "reference_video" });
    }
    const body: Record<string, unknown> = {
      model: this.modelId(),
      content,
      duration,
      resolution: req.resolution || "768P",
      ratio: req.aspectRatio,
    };
    log(`提交视频任务: model=${req.model} upstream=${body.model} duration=${duration}s resolution=${req.resolution || "768P"} ratio=${req.aspectRatio} 图片=${req.images.length} 音频=${req.audios.length} 视频=${req.videos.length}`);
    const promptChars = Array.from(req.prompt).length;
    log("完整视频提示词 (" + promptChars + "字):\n" + req.prompt);
    const res = await fetch(`${this.baseUrl()}/v1/video/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getModelSettings().minimax.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let json = {} as MinimaxSubmitResponse;
    try {
      json = JSON.parse(raw) as MinimaxSubmitResponse;
    } catch {
      /* 非 JSON */
    }
    const taskId = extractTaskId(json);
    if (!res.ok || !taskId) {
      const code = /moderat|sensitive|risk|audit/i.test(json.error?.message || "")
        ? "provider_moderation"
        : res.status >= 500
          ? "provider_5xx"
          : "provider_bad_input";
      const msg =
        json.error?.message ||
        (raw && !/^\s*</.test(raw) ? raw.slice(0, 200) : `MiniMax 返回 ${res.status}（非 JSON，请检查 MINIMAX_BASE_URL）`);
      throw new ApiError(res.status || 400, code, msg || "MiniMax 创建任务失败");
    }
    log(`提交成功: requestId=${taskId} status=${res.status}`);
    return taskId;
  }

  async poll(requestId: string): Promise<VideoPoll> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}/v1/video/generations/${requestId}`, {
        headers: { Authorization: `Bearer ${getModelSettings().minimax.apiKey}` },
      });
    } catch (err) {
      const msg = (err as Error).message || "fetch failed";
      log(`轮询网络错误: requestId=${requestId} message=${msg}`);
      return { status: "unavailable", message: msg };
    }
    const raw = await res.text();
    let json = {} as { task?: MinimaxTaskPollResponse };
    try {
      json = JSON.parse(raw) as typeof json;
    } catch {
      /* 非 JSON */
    }
    if (!res.ok) {
      const msg =
        json.task?.error?.message ||
        (raw && !/^\s*</.test(raw) ? raw.slice(0, 200) : `查询返回 ${res.status}（非 JSON）`);
      if (res.status >= 500 || res.status === 429) {
        log(`轮询暂不可用: requestId=${requestId} status=${res.status} message=${msg}`);
        return { status: "unavailable", message: msg || `查询 ${res.status}` };
      }
      return { status: "failed", code: "provider_5xx", message: msg || `查询 ${res.status}` };
    }
    const task = json.task;
    const status = (task?.status || "").toLowerCase();
    if (status === "succeeded" || status === "success") {
      const url = task?.content?.url;
      if (!url) return { status: "failed", code: "provider_bad_input", message: "成功但没有 video_url" };
      return { status: "succeeded", url };
    }
    if (status === "failed" || status === "cancelled" || status === "canceled") {
      const msg = task?.error?.message || status;
      const code = /moderat|sensitive|risk|audit/i.test(msg) ? "provider_moderation" : "provider_bad_input";
      return { status: "failed", code, message: msg };
    }
    return { status: status === "queued" || status === "pending" ? "queued" : "running" };
  }

  async download(url: string, dest: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new ApiError(502, "provider_5xx", `下载成片失败 ${res.status}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }

  async cancel(requestId: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl()}/v2/video_generation/${requestId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getModelSettings().minimax.apiKey}` },
      });
    } catch {
      /* MiniMax 未明确 DELETE 语义，忽略 */
    }
  }
}
