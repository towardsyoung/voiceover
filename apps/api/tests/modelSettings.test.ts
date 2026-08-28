import assert from "node:assert/strict";
import test from "node:test";
import { enabledVideoModelIds, isImageEnabled, isLlmEnabled, normalizeModelSettings } from "../src/services/modelSettings.js";

test("只启用配置完整的视频模型", () => {
  const settings = normalizeModelSettings({
    ark: {
      baseUrl: "https://ark.example.com/v3/",
      apiKey: "ark-key",
      models: { "seedance-2.0": "upstream-20", "seedance-2.5": "" },
    },
    minimax: { baseUrl: "https://minimax.example.com/", apiKey: "", model: "MiniMax-H3" },
  });

  assert.deepEqual(enabledVideoModelIds(settings), ["seedance-2.0"]);
  assert.equal(settings.ark.baseUrl, "https://ark.example.com/v3");
});

test("LLM 和图片模型缺少任一必填项时保持禁用", () => {
  const settings = normalizeModelSettings({
    llm: { baseUrl: "https://llm.example.com/v1", apiKey: "key", model: "", jsonMode: "json_schema" },
    image: { baseUrl: "https://image.example.com/v1", apiKey: "", model: "image-1", size: "", quality: "" },
  });

  assert.equal(isLlmEnabled(settings), false);
  assert.equal(isImageEnabled(settings), false);
  assert.equal(settings.image.size, "1024x1024");
});
