import { existsSync } from "node:fs";
import { join } from "node:path";
import { Router } from "express";
import { db } from "../db.js";
import { fail } from "../errors.js";
import { newId, nowIso } from "../ids.js";
import { assertNoInflightBoard, enqueueAssetJob } from "./assetJobs.js";
import { requireImage } from "../services/media.js";
import { clearSources, ensureDir, fileUrl, kindDir, removeDir, rotateBoard, writeBytes } from "../services/storage.js";
import { upload } from "../upload.js";

export const scenesRouter = Router();

function refUrl(id: string, version?: unknown): string | null {
  for (const ext of ["png", "jpg", "webp"]) {
    if (existsSync(join(kindDir("scenes", id), "sources", `ref.${ext}`))) {
      return fileUrl("scenes", id, `sources/ref.${ext}`, version);
    }
  }
  return null;
}

async function serialize(row: Record<string, unknown>) {
  const id = String(row.id);
  const jobCount = await db("jobs").where({ scene_id: id }).count<{ c: number }>("id as c").first();
  return {
    id,
    name: row.name,
    bio: row.bio,
    source_kind: row.source_kind,
    gen_prompt: row.gen_prompt,
    board_path: row.board_path,
    board_url: row.board_path
      ? fileUrl("scenes", id, String(row.board_path).replace(`scenes/${id}/`, ""), row.updated_at)
      : null,
    ref_url: row.source_kind === "i2i" ? refUrl(id, row.updated_at) : null,
    job_count: Number(jobCount?.c ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

scenesRouter.get("/scenes", async (_req, res, next) => {
  try {
    const rows = await db("scenes").orderBy("updated_at", "desc");
    res.json({ items: await Promise.all(rows.map(serialize)) });
  } catch (err) {
    next(err);
  }
});

scenesRouter.get("/scenes/:id", async (req, res, next) => {
  try {
    const row = await db("scenes").where({ id: req.params.id }).first();
    if (!row) fail(404, "not_found", "场景不存在");
    res.json(await serialize(row));
  } catch (err) {
    next(err);
  }
});

function writeSceneBoard(id: string, board: Express.Multer.File): string {
  const ext = requireImage(board);
  rotateBoard("scenes", id);
  return writeBytes("scenes", id, `board.${ext}`, board.buffer);
}

function writeSceneRef(id: string, ref: Express.Multer.File): string {
  const ext = requireImage(ref);
  clearSources("scenes", id);
  return writeBytes("scenes", id, `sources/ref.${ext}`, ref.buffer);
}

scenesRouter.post(
  "/scenes",
  upload.fields([
    { name: "board", maxCount: 1 },
    { name: "ref", maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const name = String(req.body.name || "").trim();
      const bio = String(req.body.bio || "").trim();
      const mode = String(req.body.mode || "");
      const prompt = String(req.body.prompt || "").trim();
      if (!name) fail(400, "validation_failed", "名称必填");
      if (!["upload", "t2i", "i2i"].includes(mode)) {
        fail(400, "validation_failed", "mode 必须是 upload / t2i / i2i");
      }
      const id = newId();
      const now = nowIso();
      ensureDir("scenes", id);
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      let boardPath: string | null = null;

      if (mode === "upload") {
        const board = files?.board?.[0];
        if (!board) fail(400, "validation_failed", "请上传场景多视图");
        boardPath = writeSceneBoard(id, board);
      }
      if (mode === "i2i") {
        const ref = files?.ref?.[0];
        if (!ref) fail(400, "validation_failed", "图生图需要参考图");
        writeSceneRef(id, ref);
      }
      if ((mode === "t2i" || mode === "i2i") && !prompt) {
        fail(400, "validation_failed", "请填写场景提示词");
      }

      await db("scenes").insert({
        id,
        name,
        bio,
        source_kind: mode,
        gen_prompt: prompt || null,
        board_path: boardPath,
        created_at: now,
        updated_at: now,
      });
      res.status(201).json(await serialize((await db("scenes").where({ id }).first())!));
    } catch (err) {
      next(err);
    }
  },
);

scenesRouter.patch("/scenes/:id", async (req, res, next) => {
  try {
    const row = await db("scenes").where({ id: req.params.id }).first();
    if (!row) fail(404, "not_found", "场景不存在");
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body.bio !== undefined) patch.bio = String(req.body.bio);
    if (req.body.gen_prompt !== undefined) patch.gen_prompt = String(req.body.gen_prompt);
    await db("scenes").where({ id: req.params.id }).update(patch);
    res.json(await serialize((await db("scenes").where({ id: req.params.id }).first())!));
  } catch (err) {
    next(err);
  }
});

scenesRouter.post(
  "/scenes/:id/remake",
  upload.fields([
    { name: "board", maxCount: 1 },
    { name: "ref", maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const row = await db("scenes").where({ id }).first();
      if (!row) fail(404, "not_found", "场景不存在");
      const mode = String(req.body.mode || "");
      const prompt = String(req.body.prompt || "").trim();
      if (!["upload", "t2i", "i2i"].includes(mode)) {
        fail(400, "validation_failed", "mode 必须是 upload / t2i / i2i");
      }
      if ((mode === "t2i" || mode === "i2i") && !prompt) {
        fail(400, "validation_failed", "请填写场景提示词");
      }
      await assertNoInflightBoard(id);
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const now = nowIso();
      ensureDir("scenes", id);
      const patch: Record<string, unknown> = {
        source_kind: mode,
        gen_prompt: prompt || null,
        updated_at: now,
      };

      if (mode === "upload") {
        const board = files?.board?.[0];
        if (!board) fail(400, "validation_failed", "请上传场景多视图");
        patch.board_path = writeSceneBoard(id, board);
        clearSources("scenes", id);
      } else if (mode === "i2i") {
        const ref = files?.ref?.[0];
        if (!ref) fail(400, "validation_failed", "图生图需要参考图");
        writeSceneRef(id, ref);
      } else {
        clearSources("scenes", id);
      }

      await db("scenes").where({ id }).update(patch);
      res.json(await serialize((await db("scenes").where({ id }).first())!));
    } catch (err) {
      next(err);
    }
  },
);

scenesRouter.delete("/scenes/:id", async (req, res, next) => {
  try {
    const row = await db("scenes").where({ id: req.params.id }).first();
    if (!row) fail(404, "not_found", "场景不存在");
    const used = await db("jobs").where({ scene_id: req.params.id }).first();
    if (used) fail(409, "in_use", "仍被制作任务引用，不能删除");
    await db("scenes").where({ id: req.params.id }).delete();
    removeDir("scenes", req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

scenesRouter.post("/scenes/:id/generate", async (req, res, next) => {
  try {
    const row = await db("scenes").where({ id: req.params.id }).first();
    if (!row) fail(404, "not_found", "场景不存在");
    const job = await enqueueAssetJob("scene_board", req.params.id);
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
});
