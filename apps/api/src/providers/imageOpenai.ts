import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { ApiError } from "../errors.js";
import { getModelSettings, isImageEnabled, type ModelSettings } from "../services/modelSettings.js";
import type { ImageGenRequest, ImageGenResult, ImageProvider } from "./image.js";

const NO_RETRY = new Set(["moderation_blocked", "image_generation_user_error", "content_policy_violation"]);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function requireImageSettings(): ModelSettings["image"] {
  const settings = getModelSettings();
  if (!isImageEnabled(settings)) {
    throw new ApiError(400, "feature_disabled", "请先在模型设置中配置图片模型");
  }
  return settings.image;
}

export class CompatibleImageProvider implements ImageProvider {
  async generate(req: ImageGenRequest): Promise<ImageGenResult> {
    const settings = requireImageSettings();
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.once(req, settings);
      } catch (err) {
        last = err;
        const code = (err as ApiError).code;
        const status = (err as ApiError).status;
        if (NO_RETRY.has(code) || (status && status < 500 && status !== 429)) throw err;
        await sleep(2000 * 2 ** attempt);
      }
    }
    throw last;
  }

  private headers(json: boolean, settings: ModelSettings["image"]): Record<string, string> {
    const h: Record<string, string> = { Authorization: `Bearer ${settings.apiKey}` };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  private bodyExtras(settings: ModelSettings["image"]): Record<string, unknown> {
    const extra: Record<string, unknown> = {};
    if (settings.quality) extra.quality = settings.quality;
    return extra;
  }

  private async once(req: ImageGenRequest, settings: ModelSettings["image"]): Promise<ImageGenResult> {
    const size = req.size || settings.size || "1024x1024";
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 180_000);
    try {
      let res: Response;
      if (req.refs.length === 0) {
        res = await fetch(`${settings.baseUrl}/images/generations`, {
          method: "POST",
          signal: ac.signal,
          headers: this.headers(true, settings),
          body: JSON.stringify({
            model: settings.model,
            prompt: req.prompt,
            size,
            n: 1,
            response_format: "b64_json",
            ...this.bodyExtras(settings),
            ...(req.quality && !settings.quality ? { quality: req.quality } : {}),
          }),
        });
      } else {
        const fd = new FormData();
        fd.append("model", settings.model);
        fd.append("prompt", req.prompt);
        fd.append("size", size);
        fd.append("n", "1");
        fd.append("response_format", "b64_json");
        if (settings.quality) fd.append("quality", settings.quality);
        else if (req.quality) fd.append("quality", req.quality);
        for (const p of req.refs) {
          const buf = readFileSync(p);
          fd.append("image", new Blob([buf]), basename(p));
        }
        res = await fetch(`${settings.baseUrl}/images/edits`, {
          method: "POST",
          signal: ac.signal,
          headers: this.headers(false, settings),
          body: fd,
        });
      }
      const text = await res.text();
      let json = {} as {
        error?: { code?: string; message?: string; type?: string };
        data?: { b64_json?: string; url?: string; revised_prompt?: string }[];
      };
      try {
        json = JSON.parse(text) as typeof json;
      } catch {
        /* 非 JSON 响应，稍后统一报错 */
      }
      if (!res.ok) {
        const raw = `${json.error?.code || ""} ${json.error?.message || ""}`;
        const msg =
          json.error?.message ||
          (text && !/^\s*</.test(text) ? text.slice(0, 200) : `图片接口返回 ${res.status}（非 JSON，请检查 IMAGE_BASE_URL）`);
        const code = /moderat|sensitive|risk|audit|content.?policy/i.test(raw)
          ? "moderation_blocked"
          : res.status >= 500
            ? "provider_5xx"
            : "provider_bad_input";
        throw new ApiError(res.status, code, msg);
      }
      const item = json.data?.[0];
      let bytes: Buffer;
      if (item?.b64_json) bytes = Buffer.from(item.b64_json, "base64");
      else if (item?.url) {
        const img = await fetch(item.url, { signal: ac.signal });
        if (!img.ok) throw new ApiError(502, "provider_5xx", `下载生成图失败 ${img.status}`);
        bytes = Buffer.from(await img.arrayBuffer());
      } else {
        throw new ApiError(502, "provider_bad_input", "图片接口没有返回图像");
      }
      return {
        bytes,
        provider: "openai-compat",
        model: settings.model,
        revisedPrompt: item.revised_prompt,
      };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if ((err as Error).name === "AbortError") {
        throw new ApiError(504, "provider_timeout", "图片生成超时");
      }
      throw new ApiError(502, "provider_5xx", (err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }
}

export { CompatibleImageProvider as OpenAIImageProvider };
