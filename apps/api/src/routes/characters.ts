import { Router } from "express";
import { db } from "../db.js";
import { fail } from "../errors.js";
import { newId, nowIso } from "../ids.js";
import { assertNoInflightBoard, enqueueAssetJob } from "./assetJobs.js";
import { requireImage } from "../services/media.js";
import { clearSources, ensureDir, fileUrl, removeDir, rotateBoard, writeBytes } from "../services/storage.js";
import { refreshCharacterAsset, submitCharacterAsset, volcResetPatch } from "../providers/volcengineAsset.js";
import { upload } from "../upload.js";

export const charactersRouter = Router();

async function serialize(row: Record<string, unknown>) {
  const id = String(row.id);
  const sources = await db("character_sources").where({ character_id: id }).orderBy("sort_order");
  const jobCount = await db("jobs").where({ character_id: id }).count<{ c: number }>("id as c").first();
  return {
    id,
    name: row.name,
    bio: row.bio,
    default_voice_id: row.default_voice_id,
    source_kind: row.source_kind,
    board_path: row.board_path,
    board_url: row.board_path
      ? fileUrl("characters", id, String(row.board_path).replace(`characters/${id}/`, ""), row.updated_at)
      : null,
    sources: sources.map((s) => ({
      id: s.id,
      role: s.role,
      path: s.path,
      url: fileUrl("characters", id, s.path.replace(`characters/${id}/`, ""), row.updated_at),
    })),
    job_count: Number(jobCount?.c ?? 0),
    volc_asset: {
      asset_id: row.volc_asset_id || null,
      status: row.volc_asset_status || "none",
      reason: row.volc_asset_reason || null,
      group_id: row.volc_asset_group_id || null,
      submitted_at: row.volc_submitted_at || null,
      checked_at: row.volc_checked_at || null,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

charactersRouter.get("/characters", async (_req, res, next) => {
  try {
    const rows = await db("characters").orderBy("updated_at", "desc");
    res.json({ items: await Promise.all(rows.map(serialize)) });
  } catch (err) {
    next(err);
  }
});

charactersRouter.get("/characters/:id", async (req, res, next) => {
  try {
    const row = await db("characters").where({ id: req.params.id }).first();
    if (!row) fail(404, "not_found", "人物不存在");
    res.json(await serialize(row));
  } catch (err) {
    next(err);
  }
});

function parseRoles(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (raw) return [String(raw)];
  return [];
}

function writeCharacterBoard(id: string, board: Express.Multer.File): string {
  const ext = requireImage(board);
  rotateBoard("characters", id);
  return writeBytes("characters", id, `board.${ext}`, board.buffer);
}

async function replaceCharacterSources(id: string, sources: Express.Multer.File[], roles: string[]) {
  await db("character_sources").where({ character_id: id }).delete();
  clearSources("characters", id);
  for (let i = 0; i < sources.length; i++) {
    const file = sources[i];
    const ext = requireImage(file);
    const role = String(roles[i] || "other");
    const rel = `sources/${String(i + 1).padStart(2, "0")}_${role}.${ext}`;
    const path = writeBytes("characters", id, rel, file.buffer);
    await db("character_sources").insert({
      id: newId(),
      character_id: id,
      role,
      path,
      sort_order: i,
    });
  }
}

charactersRouter.post(
  "/characters",
  upload.fields([
    { name: "board", maxCount: 1 },
    { name: "sources", maxCount: 8 },
  ]),
  async (req, res, next) => {
    try {
      const name = String(req.body.name || "").trim();
      const bio = String(req.body.bio || "").trim();
      const mode = String(req.body.mode || "");
      if (!name) fail(400, "validation_failed", "名称必填");
      if (mode !== "upload_board" && mode !== "generate") {
        fail(400, "validation_failed", "mode 必须是 upload_board 或 generate");
      }

      let defaultVoiceId: string | null = req.body.default_voice_id || null;
      if (defaultVoiceId) {
        const voice = await db("voices").where({ id: defaultVoiceId }).first();
        if (!voice) defaultVoiceId = null;
      }

      const id = newId();
      const now = nowIso();
      ensureDir("characters", id);
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;

      let boardPath: string | null = null;
      if (mode === "upload_board") {
        const board = files?.board?.[0];
        if (!board) fail(400, "validation_failed", "请上传成品人物多视图");
        boardPath = writeCharacterBoard(id, board);
      }

      const sources = files?.sources ?? [];
      if (mode === "generate" && sources.length < 1) {
        fail(400, "validation_failed", "请至少上传一张角度图");
      }

      await db("characters").insert({
        id,
        name,
        bio,
        default_voice_id: defaultVoiceId,
        source_kind: mode === "upload_board" ? "upload_board" : "generated",
        board_path: boardPath,
        created_at: now,
        updated_at: now,
      });

      if (sources.length) {
        await replaceCharacterSources(id, sources, parseRoles(req.body.source_roles));
      }

      const row = await db("characters").where({ id }).first();
      res.status(201).json(await serialize(row!));
    } catch (err) {
      next(err);
    }
  },
);

charactersRouter.patch("/characters/:id", async (req, res, next) => {
  try {
    const row = await db("characters").where({ id: req.params.id }).first();
    if (!row) fail(404, "not_found", "人物不存在");
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body.bio !== undefined) patch.bio = String(req.body.bio);
    if (req.body.default_voice_id !== undefined) {
      const vid = req.body.default_voice_id;
      if (vid) {
        const voice = await db("voices").where({ id: vid }).first();
        if (!voice) fail(400, "validation_failed", "音色不存在");
      }
      patch.default_voice_id = vid || null;
    }
    await db("characters").where({ id: req.params.id }).update(patch);
    res.json(await serialize((await db("characters").where({ id: req.params.id }).first())!));
  } catch (err) {
    next(err);
  }
});

charactersRouter.post(
  "/characters/:id/remake",
  upload.fields([
    { name: "board", maxCount: 1 },
    { name: "sources", maxCount: 8 },
  ]),
  async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const row = await db("characters").where({ id }).first();
      if (!row) fail(404, "not_found", "人物不存在");
      const mode = String(req.body.mode || "");
      if (mode !== "upload_board" && mode !== "generate") {
        fail(400, "validation_failed", "mode 必须是 upload_board 或 generate");
      }
      await assertNoInflightBoard(id);
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const now = nowIso();
      ensureDir("characters", id);
      const patch: Record<string, unknown> = {
        source_kind: mode === "upload_board" ? "upload_board" : "generated",
        updated_at: now,
      };

      if (mode === "upload_board") {
        const board = files?.board?.[0];
        if (!board) fail(400, "validation_failed", "请上传成品人物多视图");
        patch.board_path = writeCharacterBoard(id, board);
        Object.assign(patch, volcResetPatch());
      } else {
        const sources = files?.sources ?? [];
        if (sources.length < 1) fail(400, "validation_failed", "请至少上传一张角度图");
        await replaceCharacterSources(id, sources, parseRoles(req.body.source_roles));
      }

      await db("characters").where({ id }).update(patch);
      res.json(await serialize((await db("characters").where({ id }).first())!));
    } catch (err) {
      next(err);
    }
  },
);

charactersRouter.delete("/characters/:id", async (req, res, next) => {
  try {
    const row = await db("characters").where({ id: req.params.id }).first();
    if (!row) fail(404, "not_found", "人物不存在");
    const used = await db("jobs").where({ character_id: req.params.id }).first();
    if (used) fail(409, "in_use", "仍被制作任务引用，不能删除");
    await db("voices").where({ character_id: req.params.id }).update({ character_id: null });
    await db("characters").where({ id: req.params.id }).delete();
    removeDir("characters", req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

charactersRouter.post("/characters/:id/generate-board", async (req, res, next) => {
  try {
    const row = await db("characters").where({ id: req.params.id }).first();
    if (!row) fail(404, "not_found", "人物不存在");
    const job = await enqueueAssetJob("character_board", req.params.id);
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
});

// 提交人物板到火山素材库审核（OSS 上传 → CreateAsset → 轮询至超时），状态落库
charactersRouter.post("/characters/:id/volc-asset", async (req, res, next) => {
  try {
    const row = await db("characters").where({ id: req.params.id }).first();
    if (!row) fail(404, "not_found", "人物不存在");
    if (!row.board_path) fail(400, "validation_failed", "人物缺少人物板，无法提交审核");
    const state = await submitCharacterAsset(req.params.id);
    res.json(state);
  } catch (err) {
    next(err);
  }
});

// 刷新人物素材审核状态（GetAsset）
charactersRouter.get("/characters/:id/volc-asset", async (req, res, next) => {
  try {
    const row = await db("characters").where({ id: req.params.id }).first();
    if (!row) fail(404, "not_found", "人物不存在");
    if (!row.volc_asset_id) {
      res.json({
        asset_id: null,
        status: row.volc_asset_status || "none",
        reason: row.volc_asset_reason || null,
        group_id: row.volc_asset_group_id || null,
        submitted_at: row.volc_submitted_at || null,
        checked_at: row.volc_checked_at || null,
      });
      return;
    }
    res.json(await refreshCharacterAsset(req.params.id));
  } catch (err) {
    next(err);
  }
});
