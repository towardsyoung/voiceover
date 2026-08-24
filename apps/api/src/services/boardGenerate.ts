import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db.js";
import { nowIso } from "../ids.js";
import { CompatibleImageProvider } from "../providers/imageOpenai.js";
import { volcResetPatch } from "../providers/volcengineAsset.js";
import { qaBoardPng } from "./boardQa.js";
import { sniffImage } from "./media.js";
import { characterBoardPrompt, sceneBoardPrompt } from "./prompts.js";
import { absStored, kindDir, rotateBoard } from "./storage.js";
import { emitEvent } from "./events.js";
import { ApiError } from "../errors.js";

const image = new CompatibleImageProvider();
const ROLE_ORDER = ["front", "side", "back", "mouth"];

export async function runAssetJob(job: Record<string, unknown>) {
  const id = String(job.id);
  const targetId = String(job.target_id);
  const kind = job.kind === "scene_board" ? "scenes" : "characters";
  const eventJob = `asset:${id}`;
  await emitEvent({ jobId: eventJob, eventType: "asset_progress", message: "开始制板" });

  let prompt: string;
  let refs: string[] = [];

  if (kind === "characters") {
    const ch = await db("characters").where({ id: targetId }).first();
    if (!ch) throw new ApiError(404, "not_found", "人物不存在");
    const sources = await db("character_sources").where({ character_id: targetId }).orderBy("sort_order");
    const byRole = new Map(sources.map((s) => [String(s.role), String(s.path)]));
    const roles: string[] = [];
    for (const role of ROLE_ORDER) {
      const p = byRole.get(role);
      if (p) {
        refs.push(absStored(p));
        roles.push(role);
      }
    }
    for (const s of sources) {
      if (!ROLE_ORDER.includes(String(s.role))) refs.push(absStored(String(s.path)));
    }
    if (!refs.length) throw new ApiError(400, "validation_failed", "没有可用于制板的角度图");
    prompt = characterBoardPrompt({ name: String(ch.name), bio: String(ch.bio || ""), roles });
  } else {
    const sc = await db("scenes").where({ id: targetId }).first();
    if (!sc) throw new ApiError(404, "not_found", "场景不存在");
    const dir = join(kindDir("scenes", targetId), "sources");
    try {
      for (const name of readdirSync(dir)) {
        if (/\.(png|jpe?g|webp)$/i.test(name)) refs.push(join(dir, name));
      }
    } catch {
      /* no sources */
    }
    prompt = sceneBoardPrompt({
      name: String(sc.name),
      bio: String(sc.bio || ""),
      userPrompt: String(sc.gen_prompt || ""),
    });
  }

  const result = await image.generate({
    kind: kind === "scenes" ? "scene_board" : "character_board",
    prompt,
    refs,
  });
  const qa = qaBoardPng(result.bytes);
  if (!qa.ok) throw new ApiError(422, "board_qa_failed", qa.reason);

  const ext = sniffImage(result.bytes) || "png";
  rotateBoard(kind, targetId);
  const rel = `${kind}/${targetId}/board.${ext}`;
  writeFileSync(join(kindDir(kind, targetId), `board.${ext}`), result.bytes);
  const now = nowIso();
  if (kind === "characters") {
    await db("characters").where({ id: targetId }).update({
      board_path: rel,
      source_kind: "generated",
      updated_at: now,
      ...volcResetPatch(),
    });
  } else {
    await db("scenes").where({ id: targetId }).update({ board_path: rel, updated_at: now });
  }
  await db("asset_jobs").where({ id }).update({
    status: "succeeded",
    result_path: rel,
    error: null,
    updated_at: now,
    worker_id: null,
    lease_expires_at: null,
  });
  await emitEvent({ jobId: eventJob, eventType: "asset_progress", message: "制板完成" });
}
