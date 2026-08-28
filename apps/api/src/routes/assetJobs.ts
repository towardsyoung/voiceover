import { Router } from "express";
import { db } from "../db.js";
import { fail } from "../errors.js";
import { newId, nowIso } from "../ids.js";
import { fileUrl } from "../services/storage.js";
import { isImageEnabled } from "../services/modelSettings.js";

export const assetJobsRouter = Router();

export async function assertNoInflightBoard(targetId: string) {
  const inflight = await db("asset_jobs")
    .where({ target_id: targetId })
    .whereIn("status", ["queued", "generating"])
    .first();
  if (inflight) fail(409, "board_job_in_flight", "该资产已有制板任务在进行");
}

export async function enqueueAssetJob(kind: "character_board" | "scene_board", targetId: string) {
  if (!isImageEnabled()) {
    fail(400, "feature_disabled", "请先在模型设置中配置图片模型");
  }
  await assertNoInflightBoard(targetId);
  const now = nowIso();
  const row = {
    id: newId(),
    kind,
    target_id: targetId,
    status: "queued",
    error: null,
    result_path: null,
    created_at: now,
    updated_at: now,
  };
  await db("asset_jobs").insert(row);
  return serializeAssetJob(row);
}

export function serializeAssetJob(row: Record<string, unknown>) {
  const kind = row.kind === "scene_board" ? "scenes" : "characters";
  const targetId = String(row.target_id);
  return {
    id: row.id,
    kind: row.kind,
    target_id: targetId,
    status: row.status,
    error: row.error ?? null,
    result_path: row.result_path ?? null,
    result_url:
      row.status === "succeeded" && row.result_path
        ? fileUrl(kind as "characters" | "scenes", targetId, String(row.result_path).replace(`${kind}/${targetId}/`, ""))
        : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

assetJobsRouter.get("/asset-jobs/:id", async (req, res, next) => {
  try {
    const row = await db("asset_jobs").where({ id: req.params.id }).first();
    if (!row) fail(404, "not_found", "制板任务不存在");
    res.json(serializeAssetJob(row));
  } catch (err) {
    next(err);
  }
});
