import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { alnum, inferStance, renderKouboPrompt, splitDialogue } from "../src/skills/koubo.js";
import type { Shot } from "../src/schemas/storyboard.js";

const here = dirname(fileURLToPath(import.meta.url));

const baseShot = (over: Partial<Shot>): Shot => ({
  index: 1,
  dialogue: "各位好，欢迎来到今天的口播。我们来讲清楚产品怎么用。",
  duration_sec: 12,
  shot_size: "中近景",
  camera: "固定",
  stance: "坐",
  facing: "面向镜头",
  action: "(开篇) 双手搭桌，自然说话",
  emotion: "沉稳",
  visual: "中近景胸像，坐在演播台后，面光，正对镜头",
  continuity: "开篇",
  end_frame: "面向镜头，双手搭桌沿，嘴自然闭合",
  prompt: "",
  prompt_override: false,
  ...over,
});

const ctx = {
  model: "seedance-2.0",
  aspect_ratio: "16:9",
  resolution: "720p",
  stance: "坐",
  character: "李主播",
  scene: "演播室",
  voice: "默认",
};

test("inferStance", () => {
  assert.equal(inferStance("演播室", ""), "坐");
  assert.equal(inferStance("教室讲台", ""), "站");
  assert.equal(inferStance("未知", ""), "站");
});

test("alnum ignores punctuation", () => {
  assert.equal(alnum("你好，世界！"), alnum("你好世界"));
});

test("splitDialogue does not repeat the full line", () => {
  const text = "第一句说完了。第二句接着讲。第三句收束。";
  const [a, b] = splitDialogue(text);
  assert.ok(a);
  assert.ok(b);
  assert.notEqual(a, text);
  assert.notEqual(b, text);
  assert.equal(alnum(a + b), alnum(text));
});

test("prompt shot1 fixed camera golden", () => {
  const text = renderKouboPrompt(baseShot({ camera: "固定" }), ctx);
  const expect = readFileSync(join(here, "goldens/prompt_shot1_fixed.md"), "utf8").trim();
  assert.equal(text.trim(), expect);
  assert.equal((text.match(/各位好/g) || []).length, 1);
});

test("prompt shot2 dolly does not repeat full dialogue", () => {
  const text = renderKouboPrompt(
    baseShot({
      index: 2,
      camera: "固定，后段极轻 Dolly In",
      continuity: "承接上段尾帧",
      action: "(承接上段尾帧) 继续说话",
    }),
    { ...ctx, linkEndFrame: true },
  );
  const expect = readFileSync(join(here, "goldens/prompt_shot2_dolly.md"), "utf8").trim();
  assert.equal(text.trim(), expect);
  assert.equal((text.match(/各位好，欢迎来到今天的口播。我们来讲清楚产品怎么用。/g) || []).length, 0);
  assert.match(text, /台词（续/);
  assert.match(text, /图3 .*结构线稿/);
  assert.match(text, /普通参考图.*不是本段首帧/);
  assert.match(text, /人物中心点、人物边界、头部大小、肩宽、身体占画面比例/);
});

test("prompt includes user extra requirements", () => {
  const text = renderKouboPrompt(baseShot({ camera: "固定" }), { ...ctx, extra: "始终看镜头，双手不要离开桌面" });
  assert.match(text, /用户补充要求：始终看镜头，双手不要离开桌面/);
});

test("prompt shot2 independent skips end-frame link", () => {
  const text = renderKouboPrompt(
    baseShot({
      index: 2,
      camera: "固定",
      continuity: "独立",
      action: "继续说话",
    }),
    { ...ctx, linkEndFrame: false },
  );
  assert.doesNotMatch(text, /图3 .*尾帧/);
  assert.doesNotMatch(text, /从尾帧接着/);
  assert.match(text, /承接: 独立/);
});
