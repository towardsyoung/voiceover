import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ImageProvider } from "../src/providers/image.js";
import { CONTINUITY_SKETCH_PROMPT, ensureContinuitySketch } from "../src/services/continuitySketch.js";

test("continuity sketch is generated once and then reused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "voiceover-sketch-"));
  const endFrame = join(dir, "end.jpg");
  writeFileSync(endFrame, Buffer.from([0xff, 0xd8, 0xff]));
  let calls = 0;
  const provider: ImageProvider = {
    async generate(req) {
      calls++;
      assert.equal(req.kind, "continuity_sketch");
      assert.deepEqual(req.refs, [endFrame]);
      assert.equal(req.size, "1536x1024");
      return { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), provider: "test", model: "test" };
    },
  };

  const first = await ensureContinuitySketch(endFrame, dir, "16:9", provider);
  const second = await ensureContinuitySketch(endFrame, dir, "16:9", provider);

  assert.equal(first, join(dir, "end-sketch.png"));
  assert.equal(second, first);
  assert.equal(calls, 1);
});

test("continuity sketch prompt keeps geometry but removes photographic detail", () => {
  assert.match(CONTINUITY_SKETCH_PROMPT, /严格保持原图的画幅、镜头机位/);
  assert.match(CONTINUITY_SKETCH_PROMPT, /不得裁切、缩放、旋转/);
  assert.match(CONTINUITY_SKETCH_PROMPT, /去除颜色、真实纹理/);
});
