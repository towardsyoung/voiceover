import { createReadStream, existsSync } from "node:fs";
import { extname } from "node:path";
import { Router } from "express";
import { fail } from "../errors.js";
import { resolveRel, type FileKind } from "../services/storage.js";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

const KINDS = new Set<FileKind>(["characters", "scenes", "voices", "jobs"]);

export const filesRouter = Router();

filesRouter.get("/files/:kind/:id/*rel", (req, res, next) => {
  try {
    const kind = req.params.kind as FileKind;
    if (!KINDS.has(kind)) fail(404, "not_found", "未知资源类型");
    const rel = Array.isArray(req.params.rel) ? req.params.rel.join("/") : String(req.params.rel || "");
    const abs = resolveRel(kind, req.params.id, rel);
    if (!existsSync(abs)) fail(404, "not_found", "文件不存在");
    res.setHeader("Content-Type", MIME[extname(abs).toLowerCase()] || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=60");
    createReadStream(abs).pipe(res);
  } catch (err) {
    next(err);
  }
});
