import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Router } from "express";
import { db } from "../db.js";
import { env } from "../env.js";
import { fail } from "../errors.js";
import { newId, nowIso } from "../ids.js";
import { probeDurationMs, sniffAudio, toWav48k } from "../services/media.js";
import { ensureDir, fileUrl, kindDir, removeDir, restoreVoiceSample, rotateVoiceSample } from "../services/storage.js";
import { upload } from "../upload.js";

export const voicesRouter = Router();

async function serialize(row: Record<string, unknown>) {
  const id = String(row.id);
  const jobCount = await db("jobs").where({ voice_id: id }).count<{ c: number }>("id as c").first();
  return {
    id,
    name: row.name,
    bio: row.bio,
    character_id: row.character_id,
    audio_path: row.audio_path,
    audio_url: fileUrl("voices", id, "sample.wav", row.updated_at),
    duration_ms: row.duration_ms,
    mime: row.mime,
    job_count: Number(jobCount?.c ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

voicesRouter.get("/voices", async (_req, res, next) => {
  try {
    const rows = await db("voices").orderBy("updated_at", "desc");
    res.json({ items: await Promise.all(rows.map(serialize)) });
  } catch (err) {
    next(err);
  }
});

voicesRouter.get("/voices/:id", async (req, res, next) => {
  try {
    const row = await db("voices").where({ id: req.params.id }).first();
    if (!row) fail(404, "not_found", "音色不存在");
    res.json(await serialize(row));
  } catch (err) {
    next(err);
  }
});

async function ingestVoiceAudio(id: string, file: Express.Multer.File, opts: { rotate: boolean }): Promise<number> {
  if (file.size > env.audioMaxMb * 1024 * 1024) fail(400, "validation_failed", "音频过大");
  if (!sniffAudio(file.buffer)) fail(400, "invalid_audio", "不支持的音频格式");
  const tmp = mkdtempSync(join(tmpdir(), "vo-"));
  let rotated = false;
  try {
    const src = join(tmp, "in.bin");
    writeFileSync(src, file.buffer);
    ensureDir("voices", id);
    if (opts.rotate) {
      rotateVoiceSample(id);
      rotated = true;
    }
    const dest = join(kindDir("voices", id), "sample.wav");
    await toWav48k(src, dest);
    const durationMs = await probeDurationMs(dest);
    if (durationMs > env.voiceMaxSec * 1000) {
      fail(400, "validation_failed", `音色不能超过 ${env.voiceMaxSec} 秒`);
    }
    return durationMs;
  } catch (err) {
    if (rotated) restoreVoiceSample(id);
    else if (!opts.rotate) removeDir("voices", id);
    throw err;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

voicesRouter.post("/voices", upload.single("audio"), async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const bio = String(req.body.bio || "").trim();
    if (!name) fail(400, "validation_failed", "名称必填");
    const file = req.file;
    if (!file) fail(400, "validation_failed", "请上传或录入音频");

    let characterId: string | null = req.body.character_id || null;
    if (characterId) {
      const ch = await db("characters").where({ id: characterId }).first();
      if (!ch) fail(400, "validation_failed", "绑定的人物不存在");
    }

    const id = newId();
    const durationMs = await ingestVoiceAudio(id, file, { rotate: false });
    const now = nowIso();
    await db("voices").insert({
      id,
      name,
      bio,
      character_id: characterId,
      audio_path: `voices/${id}/sample.wav`,
      duration_ms: durationMs,
      mime: "audio/wav",
      created_at: now,
      updated_at: now,
    });
    if (characterId) {
      const ch = await db("characters").where({ id: characterId }).first();
      if (ch && !ch.default_voice_id) {
        await db("characters").where({ id: characterId }).update({
          default_voice_id: id,
          updated_at: now,
        });
      }
    }
    res.status(201).json(await serialize((await db("voices").where({ id }).first())!));
  } catch (err) {
    next(err);
  }
});

voicesRouter.patch("/voices/:id", async (req, res, next) => {
  try {
    const row = await db("voices").where({ id: req.params.id }).first();
    if (!row) fail(404, "not_found", "音色不存在");
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body.bio !== undefined) patch.bio = String(req.body.bio);
    if (req.body.character_id !== undefined) {
      const cid = req.body.character_id || null;
      if (cid) {
        const ch = await db("characters").where({ id: cid }).first();
        if (!ch) fail(400, "validation_failed", "绑定的人物不存在");
      }
      patch.character_id = cid;
    }
    await db("voices").where({ id: req.params.id }).update(patch);
    res.json(await serialize((await db("voices").where({ id: req.params.id }).first())!));
  } catch (err) {
    next(err);
  }
});

voicesRouter.post("/voices/:id/remake", upload.single("audio"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const row = await db("voices").where({ id }).first();
    if (!row) fail(404, "not_found", "音色不存在");
    const file = req.file;
    if (!file) fail(400, "validation_failed", "请上传或录入音频");
    const durationMs = await ingestVoiceAudio(id, file, { rotate: true });
    const now = nowIso();
    await db("voices").where({ id }).update({
      audio_path: `voices/${id}/sample.wav`,
      duration_ms: durationMs,
      mime: "audio/wav",
      updated_at: now,
    });
    res.json(await serialize((await db("voices").where({ id }).first())!));
  } catch (err) {
    next(err);
  }
});

voicesRouter.delete("/voices/:id", async (req, res, next) => {
  try {
    const row = await db("voices").where({ id: req.params.id }).first();
    if (!row) fail(404, "not_found", "音色不存在");
    const used = await db("jobs").where({ voice_id: req.params.id }).first();
    if (used) fail(409, "in_use", "仍被制作任务引用，不能删除");
    await db("characters").where({ default_voice_id: req.params.id }).update({
      default_voice_id: null,
      updated_at: nowIso(),
    });
    await db("voices").where({ id: req.params.id }).delete();
    removeDir("voices", req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
