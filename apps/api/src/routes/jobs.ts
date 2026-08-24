import { existsSync } from "node:fs";
import { basename } from "node:path";
import { Router } from "express";
import { db } from "../db.js";
import { env } from "../env.js";
import { fail } from "../errors.js";
import { newId, nowIso } from "../ids.js";
import { inferStance } from "../skills/koubo.js";
import { getVideoProvider } from "../providers/index.js";
import {
  applyShotEdits,
  fillPrompts,
  jobLinksEndFrame,
  promptCtx,
  readStoryboard,
  validateStoryboard,
  writeStoryboard,
} from "../services/storyboard.js";
import { cascadeInvalidate, queryShotFromProvider, resetShotRun, syncShotRuns } from "../services/generation.js";
import { absStored, fileUrl } from "../services/storage.js";
import { renderKouboPrompt } from "../skills/koubo.js";
import type { Shot, Storyboard } from "../schemas/storyboard.js";

export const jobsRouter = Router();

const PROMPT_MAX = 8000;

function clipText(v: unknown): string {
  return String(v ?? "").trim().slice(0, PROMPT_MAX);
}

async function loadJob(id: string) {
  const row = await db("jobs").where({ id }).first();
  if (!row) fail(404, "not_found", "任务不存在");
  return row;
}

function safeJson(raw: unknown) {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

async function serialize(row: Record<string, unknown>) {
  const id = String(row.id);
  const board = readStoryboard(id);
  const ch = row.character_id
    ? await db("characters").where({ id: row.character_id }).first()
    : null;
  const sc = row.scene_id ? await db("scenes").where({ id: row.scene_id }).first() : null;
  const vo = row.voice_id ? await db("voices").where({ id: row.voice_id }).first() : null;
  const runs = await db("shot_runs").where({ job_id: id }).orderBy("shot_index");
  const shots = runs.map((r) => {
    const nn = String(r.shot_index).padStart(2, "0");
    return {
      ...r,
      video_url: r.video_path ? fileUrl("jobs", id, `shots/${nn}/video.mp4`) : null,
      end_frame_url: r.end_frame_path ? fileUrl("jobs", id, `shots/${nn}/${basename(String(r.end_frame_path))}`) : null,
    };
  });
  return {
    id,
    title: row.title,
    status: row.status,
    script: row.script,
    error: row.error,
    video_model: row.video_model,
    aspect_ratio: row.aspect_ratio,
    resolution: row.resolution,
    stance: row.stance,
    skill: row.skill,
    link_end_frame: Number(row.link_end_frame) === 1,
    storyboard_system_prompt: String(row.storyboard_system_prompt || ""),
    video_system_prompt: String(row.video_system_prompt || ""),
    cancel_requested: Number(row.cancel_requested) || 0,
    assets: {
      character: ch
        ? {
            id: ch.id,
            name: ch.name,
            board_url: ch.board_path
              ? fileUrl("characters", String(ch.id), String(ch.board_path).replace(`characters/${String(ch.id)}/`, ""), ch.updated_at)
              : null,
          }
        : null,
      scene: sc
        ? {
            id: sc.id,
            name: sc.name,
            board_url: sc.board_path
              ? fileUrl("scenes", String(sc.id), String(sc.board_path).replace(`scenes/${String(sc.id)}/`, ""), sc.updated_at)
              : null,
          }
        : null,
      voice: vo
        ? {
            id: vo.id,
            name: vo.name,
            audio_url: fileUrl("voices", String(vo.id), "sample.wav", vo.updated_at),
            duration_ms: vo.duration_ms,
          }
        : null,
    },
    storyboard: board,
    shots,
    final_video_url: row.final_video_path ? fileUrl("jobs", id, "final.mp4") : null,
    events_url: `/api/jobs/${id}/events`,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

jobsRouter.get("/jobs", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await db("jobs").orderBy("created_at", "desc").limit(limit);
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        created_at: r.created_at,
        character_name_snap: r.character_name_snap,
        scene_name_snap: r.scene_name_snap,
        video_model: r.video_model,
      })),
    });
  } catch (err) {
    next(err);
  }
});

jobsRouter.get("/jobs/:id", async (req, res, next) => {
  try {
    res.json(await serialize(await loadJob(req.params.id)));
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/jobs", async (req, res, next) => {
  try {
    const b = req.body || {};
    const script = String(b.script || "").trim();
    if (!script) fail(400, "validation_failed", "口播稿不能为空");
    const ch = await db("characters").where({ id: b.character_id }).first();
    const sc = await db("scenes").where({ id: b.scene_id }).first();
    const vo = await db("voices").where({ id: b.voice_id }).first();
    if (!ch || !sc || !vo) fail(400, "validation_failed", "人物、场景、音色都必须选择");
    const stance = b.stance || inferStance(String(sc.name), String(sc.bio || ""));
    const now = nowIso();
    const id = newId();
    await db("jobs").insert({
      id,
      title: String(b.title || script.slice(0, 24)),
      script,
      character_id: ch.id,
      scene_id: sc.id,
      voice_id: vo.id,
      character_name_snap: ch.name,
      scene_name_snap: sc.name,
      voice_name_snap: vo.name,
      skill: "koubo",
      video_model: b.video_model || "seedance-2.0",
      aspect_ratio: b.aspect_ratio || "16:9",
      resolution: b.resolution || "720p",
      stance,
      link_end_frame: b.link_end_frame === true || b.link_end_frame === 1 || b.link_end_frame === "1" ? 1 : 0,
      storyboard_system_prompt: clipText(b.storyboard_system_prompt),
      video_system_prompt: clipText(b.video_system_prompt),
      status: "draft",
      created_at: now,
      updated_at: now,
    });
    res.status(201).json(await serialize((await db("jobs").where({ id }).first())!));
  } catch (err) {
    next(err);
  }
});

jobsRouter.patch("/jobs/:id", async (req, res, next) => {
  try {
    const job = await loadJob(req.params.id);
    const jobId = String(job.id);
    if (["storyboarding", "queued", "generating", "concatenating"].includes(String(job.status))) {
      fail(409, "invalid_state", "进行中的任务不能编辑");
    }

    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (req.body.title !== undefined) patch.title = String(req.body.title);
    if (req.body.script !== undefined) patch.script = String(req.body.script);
    if (req.body.stance !== undefined) patch.stance = req.body.stance;

    // 结构类字段可直接改，保留现有分镜与分段；出片提示词按新配置重写
    const structural: Record<string, unknown> = {};
    if (req.body.character_id !== undefined) {
      const ch = await db("characters").where({ id: req.body.character_id }).first();
      if (!ch) fail(400, "validation_failed", "所选人物不存在");
      structural.character_id = ch.id;
      structural.character_name_snap = ch.name;
    }
    if (req.body.scene_id !== undefined) {
      const sc = await db("scenes").where({ id: req.body.scene_id }).first();
      if (!sc) fail(400, "validation_failed", "所选场景不存在");
      structural.scene_id = sc.id;
      structural.scene_name_snap = sc.name;
    }
    if (req.body.voice_id !== undefined) {
      const vo = await db("voices").where({ id: req.body.voice_id }).first();
      if (!vo) fail(400, "validation_failed", "所选音色不存在");
      structural.voice_id = vo.id;
      structural.voice_name_snap = vo.name;
    }
    if (req.body.video_model !== undefined) {
      getVideoProvider(String(req.body.video_model));
      structural.video_model = String(req.body.video_model);
    }
    if (req.body.aspect_ratio !== undefined) structural.aspect_ratio = String(req.body.aspect_ratio);
    if (req.body.resolution !== undefined) structural.resolution = String(req.body.resolution);
    if (req.body.link_end_frame !== undefined) {
      patch.link_end_frame = req.body.link_end_frame === true || req.body.link_end_frame === 1 || req.body.link_end_frame === "1" ? 1 : 0;
    }
    if (req.body.storyboard_system_prompt !== undefined) {
      patch.storyboard_system_prompt = clipText(req.body.storyboard_system_prompt);
    }
    if (req.body.video_system_prompt !== undefined) {
      patch.video_system_prompt = clipText(req.body.video_system_prompt);
    }

    const fieldChanged = (key: string, next: unknown) =>
      next !== undefined && String(next) !== String(job[key] ?? "");
    const boardFieldsChanged =
      fieldChanged("character_id", structural.character_id) ||
      fieldChanged("scene_id", structural.scene_id) ||
      fieldChanged("voice_id", structural.voice_id) ||
      fieldChanged("video_model", structural.video_model) ||
      fieldChanged("aspect_ratio", structural.aspect_ratio) ||
      fieldChanged("resolution", structural.resolution) ||
      fieldChanged("stance", patch.stance) ||
      (req.body.link_end_frame !== undefined && Number(patch.link_end_frame) !== Number(job.link_end_frame)) ||
      (req.body.video_system_prompt !== undefined &&
        String(patch.video_system_prompt ?? "") !== String(job.video_system_prompt ?? ""));

    Object.assign(patch, structural);

    await db("jobs").where({ id: jobId }).update(patch);
    const updated = (await db("jobs").where({ id: jobId }).first())!;
    if (boardFieldsChanged) {
      const board = readStoryboard(jobId);
      if (board) {
        board.model = String(updated.video_model) as Storyboard["model"];
        board.aspect_ratio = String(updated.aspect_ratio) as Storyboard["aspect_ratio"];
        board.resolution = String(updated.resolution) as Storyboard["resolution"];
        if (updated.stance === "坐" || updated.stance === "站") board.stance = updated.stance;
        board.assets = {
          character: String(updated.character_name_snap || board.assets.character),
          scene: String(updated.scene_name_snap || board.assets.scene),
          voice: String(updated.voice_name_snap || board.assets.voice),
        };
        fillPrompts(board, updated);
        writeStoryboard(jobId, board);
      }
    }
    res.json(await serialize(updated));
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/jobs/:id/storyboard", async (req, res, next) => {
  try {
    const job = await loadJob(req.params.id);
    if (!["draft", "storyboard_ready", "needs_retry", "cancelled", "done", "concat_failed"].includes(String(job.status))) {
      fail(409, "invalid_state", "当前状态不能生成分镜");
    }
    await db("jobs").where({ id: job.id }).update({
      status: "storyboarding",
      worker_id: null,
      lease_expires_at: null,
      error: null,
      updated_at: nowIso(),
    });
    res.json({ id: job.id, status: "storyboarding" });
  } catch (err) {
    next(err);
  }
});

jobsRouter.put("/jobs/:id/storyboard", async (req, res, next) => {
  try {
    const job = await loadJob(req.params.id);
    if (String(job.status) === "generating") fail(409, "invalid_state", "生成中不能改分镜");
    const board = readStoryboard(String(job.id));
    if (!board) fail(400, "validation_failed", "还没有分镜");
    const shots = (req.body.shots || []) as Partial<Shot>[];
    const next = applyShotEdits(board, shots);
    const oldIdx = board.shots.map((s) => s.index).join(",");
    const newIdx = next.shots.map((s) => s.index).join(",");
    if (oldIdx !== newIdx && !req.body.invalidate_runs) {
      fail(409, "structural_edit_requires_invalidate", "改段数需要 invalidate_runs=true");
    }
    if (req.body.rerender_prompts !== false) {
      fillPrompts(next, job);
    }
    validateStoryboard(next, String(job.script), String(job.video_model), jobLinksEndFrame(job));
    writeStoryboard(String(job.id), next);
    await db("jobs").where({ id: job.id }).update({ updated_at: nowIso() });
    res.json(await serialize((await db("jobs").where({ id: job.id }).first())!));
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/jobs/:id/shots/:index/render-prompt", async (req, res, next) => {
  try {
    const job = await loadJob(req.params.id);
    const board = readStoryboard(String(job.id));
    if (!board) fail(400, "validation_failed", "还没有分镜");
    const idx = Number(req.params.index);
    const shot = board.shots.find((s) => s.index === idx);
    if (!shot) fail(404, "not_found", "没有这一段");
    shot.prompt_override = false;
    shot.prompt = renderKouboPrompt(shot, promptCtx(job, board.assets));
    writeStoryboard(String(job.id), board);
    res.json({ shot });
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/jobs/:id/generate", async (req, res, next) => {
  try {
    const job = await loadJob(req.params.id);
    const jobId = String(job.id);
    if (!["storyboard_ready", "needs_retry", "done", "concat_failed", "cancelled"].includes(String(job.status))) {
      fail(409, "invalid_state", "当前状态不能出片");
    }
    if (!env.featureVideoGen) fail(400, "feature_disabled", "未开启 FEATURE_VIDEO_GEN");
    const board = readStoryboard(jobId);
    if (!board) fail(400, "validation_failed", "还没有分镜");
    validateStoryboard(board, String(job.script), String(job.video_model), jobLinksEndFrame(job));
    const rerunAll = Boolean(req.body?.rerun_all);
    if (rerunAll) await cascadeInvalidate(jobId, 0);
    await syncShotRuns(jobId, board.shots);
    await db("shot_runs")
      .where({ job_id: jobId })
      .whereIn("status", ["failed", "cancelled"])
      .update({ status: "pending", error: null });
    await db("jobs").where({ id: jobId }).update({
      status: "queued",
      cancel_requested: 0,
      error: null,
      worker_id: null,
      lease_expires_at: null,
      updated_at: nowIso(),
    });
    res.json(await serialize((await db("jobs").where({ id: jobId }).first())!));
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/jobs/:id/shots/:index/query", async (req, res, next) => {
  try {
    const job = await loadJob(req.params.id);
    const jobId = String(job.id);
    if (!["needs_retry", "cancelled", "concat_failed"].includes(String(job.status))) {
      fail(409, "invalid_state", "当前状态不能查询本段");
    }
    const idx = Number(req.params.index);
    if (!Number.isInteger(idx) || idx < 1) fail(400, "validation_failed", "无效段号");
    const run = await db("shot_runs").where({ job_id: jobId, shot_index: idx }).first();
    if (!run) fail(404, "not_found", "没有这一段");
    if (run.status === "succeeded") fail(409, "invalid_state", "本段已经成功");
    if (!["failed", "generating", "pending"].includes(String(run.status))) {
      fail(409, "invalid_state", "当前段状态不能查询");
    }
    await queryShotFromProvider(jobId, idx);
    res.json(await serialize((await db("jobs").where({ id: jobId }).first())!));
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/jobs/:id/shots/:index/retry", async (req, res, next) => {
  try {
    const job = await loadJob(req.params.id);
    const jobId = String(job.id);
    if (!["needs_retry", "done", "concat_failed", "cancelled"].includes(String(job.status))) {
      fail(409, "invalid_state", "当前状态不能重试本段");
    }
    if (!env.featureVideoGen) fail(400, "feature_disabled", "未开启 FEATURE_VIDEO_GEN");
    const board = readStoryboard(jobId);
    if (!board) fail(400, "validation_failed", "还没有分镜");
    const idx = Number(req.params.index);
    if (!Number.isInteger(idx) || idx < 1) fail(400, "validation_failed", "无效段号");
    const shot = board.shots.find((s) => s.index === idx);
    if (!shot) fail(404, "not_found", "没有这一段");
    let run = await db("shot_runs").where({ job_id: jobId, shot_index: idx }).first();
    if (!run) {
      await syncShotRuns(jobId, board.shots);
      run = await db("shot_runs").where({ job_id: jobId, shot_index: idx }).first();
    }
    if (!run) fail(404, "not_found", "没有这一段");
    if (!["failed", "succeeded", "cancelled", "pending"].includes(String(run.status))) {
      fail(409, "invalid_state", "当前段状态不能重试");
    }
    if (jobLinksEndFrame(job) && idx > 1) {
      const prev = await db("shot_runs").where({ job_id: jobId, shot_index: idx - 1 }).first();
      if (!prev?.end_frame_path || !existsSync(absStored(String(prev.end_frame_path)))) {
        fail(400, "validation_failed", "缺少上一段尾帧");
      }
    }
    if (req.body?.prompt != null) {
      shot.prompt = String(req.body.prompt);
      shot.prompt_override = true;
      writeStoryboard(jobId, board);
    }
    await resetShotRun(jobId, idx);
    await db("jobs").where({ id: jobId }).update({
      status: "queued",
      cancel_requested: 0,
      error: null,
      worker_id: null,
      lease_expires_at: null,
      updated_at: nowIso(),
    });
    res.json(await serialize((await db("jobs").where({ id: jobId }).first())!));
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/jobs/:id/concat", async (req, res, next) => {
  try {
    const job = await loadJob(req.params.id);
    const jobId = String(job.id);
    if (!["done", "concat_failed", "needs_retry"].includes(String(job.status))) {
      fail(409, "invalid_state", "当前状态不能拼接");
    }
    const board = readStoryboard(jobId);
    if (!board) fail(400, "validation_failed", "还没有分镜");
    const runs = await db("shot_runs").where({ job_id: jobId });
    const byIndex = new Map(runs.map((r) => [Number(r.shot_index), r]));
    for (const s of board.shots) {
      if (byIndex.get(s.index)?.status !== "succeeded") {
        fail(400, "validation_failed", "还有未完成的段，不能拼接");
      }
    }
    await db("jobs").where({ id: jobId }).update({
      status: "concatenating",
      worker_id: null,
      lease_expires_at: null,
      error: null,
      updated_at: nowIso(),
    });
    res.json(await serialize((await db("jobs").where({ id: jobId }).first())!));
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/jobs/:id/cancel", async (req, res, next) => {
  try {
    const job = await loadJob(req.params.id);
    const jobId = String(job.id);
    const status = String(job.status);
    if (status === "cancelled") fail(409, "invalid_state", "已经取消");
    if (status === "done") fail(409, "invalid_state", "已完成不能取消");
    const immediate = ["draft", "storyboard_ready", "queued", "needs_retry"];
    const inflight = ["storyboarding", "generating", "concatenating"];
    if (immediate.includes(status)) {
      await db("jobs").where({ id: jobId }).update({
        status: "cancelled",
        cancel_requested: 1,
        worker_id: null,
        lease_expires_at: null,
        updated_at: nowIso(),
      });
    } else if (inflight.includes(status)) {
      await db("jobs").where({ id: jobId }).update({
        cancel_requested: 1,
        updated_at: nowIso(),
      });
    } else {
      fail(409, "invalid_state", "当前状态不能取消");
    }
    res.json(await serialize((await db("jobs").where({ id: jobId }).first())!));
  } catch (err) {
    next(err);
  }
});

jobsRouter.get("/jobs/:id/events", async (req, res, next) => {
  try {
    const job = await loadJob(req.params.id);
    const jobId = String(job.id);
    let last = Number(req.query.after || req.header("Last-Event-ID") || 0) || 0;
    const snap = await serialize(job);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);
    const timer = setInterval(async () => {
      try {
        const rows = await db("job_events").where({ job_id: jobId }).andWhere("id", ">", last).orderBy("id");
        for (const row of rows) {
          last = Number(row.id);
          const data = {
            id: row.id,
            job_id: row.job_id,
            ts: row.ts,
            level: row.level,
            event_type: row.event_type,
            shot_index: row.shot_index,
            message: row.message,
            extra: row.extra_json ? safeJson(row.extra_json) : null,
          };
          res.write(`id: ${row.id}\nevent: ${row.event_type}\ndata: ${JSON.stringify(data)}\n\n`);
        }
      } catch (err) {
        console.error("sse", err);
      }
    }, 500);
    req.on("close", () => {
      clearInterval(timer);
    });
  } catch (err) {
    next(err);
  }
});
