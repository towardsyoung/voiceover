import { env } from "../env.js";
import { ApiError } from "../errors.js";

export async function chatJson(input: {
  system: string;
  user: string;
  schema?: Record<string, unknown>;
}): Promise<{ text: string; usedSchema: boolean }> {
  if (!env.llmBaseUrl || !env.llmApiKey || !env.llmModel) {
    throw new ApiError(400, "feature_disabled", "未配置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL");
  }
  const url = `${env.llmBaseUrl}/chat/completions`;
  const messages = [
    { role: "system", content: input.system },
    { role: "user", content: input.user },
  ];

  async function call(mode: "json_schema" | "json_object") {
    const body: Record<string, unknown> = {
      model: env.llmModel,
      messages,
      max_completion_tokens: 8192,
    };
    if (mode === "json_schema" && input.schema) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "storyboard", strict: true, schema: input.schema },
      };
    } else {
      body.response_format = { type: "json_object" };
    }
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.llmApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let json = {} as {
      error?: { message?: string };
      choices?: { message?: { content?: string } }[];
    };
    try {
      json = JSON.parse(raw) as typeof json;
    } catch {
      /* 非 JSON 响应，稍后统一报错 */
    }
    if (!res.ok) {
      const msg =
        json.error?.message ||
        (raw && !/^\s*</.test(raw) ? raw.slice(0, 200) : `LLM 返回 ${res.status}（非 JSON，请检查 LLM_BASE_URL）`);
      throw new ApiError(res.status, res.status === 400 ? "llm_bad_request" : "provider_5xx", msg);
    }
    const text = json.choices?.[0]?.message?.content;
    if (!text) throw new ApiError(502, "provider_bad_input", "LLM 没有返回内容");
    return text;
  }

  const preferSchema = env.llmJsonMode === "json_schema" && !!input.schema;
  if (preferSchema) {
    try {
      return { text: await call("json_schema"), usedSchema: true };
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        return { text: await call("json_object"), usedSchema: false };
      }
      throw err;
    }
  }
  return { text: await call("json_object"), usedSchema: false };
}
