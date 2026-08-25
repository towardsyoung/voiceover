import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { db } from "../db.js";
import { env } from "../env.js";
import { ApiError } from "../errors.js";
import { newId, nowIso } from "../ids.js";
import { getVideoProvider } from "../providers/index.js";
import type { Shot } from "../schemas/storyboard.js";
import { renderKouboPrompt } from "../skills/koubo.js";
import { absStored, kindDir } from "./storage.js";
import { emitEvent } from "./events.js";
import { concatColorMatched, concatCopy, extractLastFrame, probeVideo, toStructureSketch } from "./media.js";
import { jobLinksEndFrame, promptCtx, readStoryboard } from "./storyboard.js";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function shotDir(jobId: string, index: number) {
  const dir = join(kindDir("jobs", jobId), "shots", pad(index));
  mkdirSync(dir, { recursive: true });
  return dir;
}

const POLL_TIMEOUT_MS = 60 * 60 * 1000;

function persistProviderRequestId(jobId: string, shotIndex: number, requestId: string, extra?: Record<string, unknown>) {
  writeFileSync(
    join(shotDir(jobId, shotIndex), "provider.json"),
    JSON.stringify({ request_id: requestId, ...extra }, null, 2),
  );
}

function readStoredRequestId(jobId: string, shotIndex: number, run?: { provider_request_id?: unknown } | null): string {
  const fromDb = String(run?.provider_request_id || "").trim();
  if (fromDb) return fromDb;
  const file = join(shotDir(jobId, shotIndex), "provider.json");
  if (!existsSync(file)) return "";
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as { request_id?: unknown };
    return String(json.request_id || "").trim();
  } catch {
    return "";
  }
}

export async function syncShotRuns(jobId: string, shots: Shot[]) {
  const existing = await db("shot_runs").where({ job_id: jobId });
  const keep = new Set(shots.map((s) => s.index));
  for (const row of existing) {
    if (!keep.has(Number(row.shot_index)) && row.status !== "cancelled") {
      await db("shot_runs").where({ id: row.id }).update({ status: "cancelled" });
    }
  }
  for (const s of shots) {
    const row = existing.find((r) => Number(r.shot_index) === s.index);
    if (!row) {
      await db("shot_runs").insert({
        id: newId(),
        job_id: jobId,
        shot_index: s.index,
        status: "pending",
        attempt: 0,
      });
    }
  }
}

export async function cascadeInvalidate(jobId: string, fromIndex: number) {
  const rows = await db("shot_runs").where({ job_id: jobId }).andWhere("shot_index", ">", fromIndex);
  const dir = kindDir("jobs", jobId);
  for (const row of rows) {
    const nn = pad(Number(row.shot_index));
    const video = join(dir, "shots", nn, "video.mp4");
    const ends = ["png", "jpg"].map((ext) => ({
      path: join(dir, "shots", nn, `end.${ext}`),
      stale: join(dir, "shots", nn, `end.stale${Number(row.attempt || 1)}.${ext}`),
    }));
    const sketches = ["png", "jpg", "webp"].map((ext) => join(dir, "shots", nn, `end-sketch.${ext}`));
    const grayscale = join(dir, "shots", nn, "end-gray.png");
    const structure = join(dir, "shots", nn, "end-structure.png");
    const n = Number(row.attempt || 1);
    if (existsSync(video)) renameSync(video, join(dir, "shots", nn, `video.stale${n}.mp4`));
    for (const end of ends) {
      if (existsSync(end.path)) renameSync(end.path, end.stale);
    }
    for (const sketch of sketches) {
      if (existsSync(sketch)) renameSync(sketch, `${sketch}.stale${n}`);
    }
    if (existsSync(grayscale)) renameSync(grayscale, join(dir, "shots", nn, `end-gray.stale${n}.png`));
    if (existsSync(structure)) renameSync(structure, join(dir, "shots", nn, `end-structure.stale${n}.png`));
    await db("shot_runs").where({ id: row.id }).update({
      status: "pending",
      video_path: null,
      end_frame_path: null,
      provider_request_id: null,
      error: null,
    });
  }
}

export async function resetShotRun(jobId: string, index: number) {
  const row = await db("shot_runs").where({ job_id: jobId, shot_index: index }).first();
  const dir = kindDir("jobs", jobId);
  const nn = pad(index);
  const video = join(dir, "shots", nn, "video.mp4");
  const ends = ["png", "jpg"].map((ext) => ({
    path: join(dir, "shots", nn, `end.${ext}`),
    attempt: join(dir, "shots", nn, `end.attempt${Number(row?.attempt || 1)}.${ext}`),
  }));
  const sketches = ["png", "jpg", "webp"].map((ext) => join(dir, "shots", nn, `end-sketch.${ext}`));
  const grayscale = join(dir, "shots", nn, "end-gray.png");
  const structure = join(dir, "shots", nn, "end-structure.png");
  const n = Number(row?.attempt || 1);
  if (existsSync(video)) renameSync(video, join(dir, "shots", nn, `video.attempt${n}.mp4`));
  for (const end of ends) {
    if (existsSync(end.path)) renameSync(end.path, end.attempt);
  }
  for (const sketch of sketches) {
    if (existsSync(sketch)) renameSync(sketch, `${sketch}.attempt${n}`);
  }
  if (existsSync(grayscale)) renameSync(grayscale, join(dir, "shots", nn, `end-gray.attempt${n}.png`));
  if (existsSync(structure)) renameSync(structure, join(dir, "shots", nn, `end-structure.attempt${n}.png`));
  if (row) {
    await db("shot_runs").where({ id: row.id }).update({
      status: "pending",
      video_path: null,
      end_frame_path: null,
      provider_request_id: null,
      error: null,
    });
  }
}

function videoLeaseExpiry() {
  return new Date(Date.now() + env.leaseSec * 20 * 1000).toISOString();
}

async function cancelled(jobId: string) {
  const job = await db("jobs").where({ id: jobId }).first();
  return Number(job?.cancel_requested) === 1;
}

export async function generateShot(job: Record<string, unknown>, shot: Shot) {
  const jobId = String(job.id);
  const dir = shotDir(jobId, shot.index);
  const videoProvider = getVideoProvider(String(job.video_model));
  const ch = await db("characters").where({ id: job.character_id }).first();
  const sc = await db("scenes").where({ id: job.scene_id }).first();
  const vo = await db("voices").where({ id: job.voice_id }).first();
  if (!ch?.board_path || !sc?.board_path || !vo?.audio_path) {
    throw new ApiError(400, "validation_failed", "人物板、场景板或音色缺失");
  }
  const images = [absStored(String(ch.board_path)), absStored(String(sc.board_path))];
  const link = jobLinksEndFrame(job);
  if (link && shot.index > 1) {
    const prevDir = join(kindDir("jobs", jobId), "shots", pad(shot.index - 1));
    const prevPng = join(prevDir, "end.png");
    const prevVideo = join(prevDir, "video.mp4");
    if (!existsSync(prevPng) && existsSync(prevVideo)) {
      await extractLastFrame(prevVideo, prevPng);
      await db("shot_runs").where({ job_id: jobId, shot_index: shot.index - 1 }).update({
        end_frame_path: `jobs/${jobId}/shots/${pad(shot.index - 1)}/end.png`,
      });
    }
    const prev = existsSync(prevPng) ? prevPng : join(prevDir, "end.jpg");
    if (!existsSync(prev)) throw new ApiError(400, "validation_failed", "缺少上一段尾帧");
    const prevStructure = join(prevDir, "end-structure.png");
    if (!existsSync(prevStructure)) await toStructureSketch(prev, prevStructure);
    images.push(prevStructure);
  }
  const req = {
    model: String(job.video_model),
    prompt: shot.prompt_override
      ? shot.prompt
      : renderKouboPrompt(
          shot,
          promptCtx(job, { character: String(ch.name), scene: String(sc.name), voice: String(vo.name) }),
        ),
    images,
    videos: [] as string[],
    audios: [absStored(String(vo.audio_path))],
    durationSec: shot.duration_sec,
    aspectRatio: job.aspect_ratio as "16:9" | "9:16",
    resolution: String(job.resolution),
    generateAudio: true,
    characterId: job.character_id ? String(job.character_id) : undefined,
  };
  if (link && env.attachPrevVideo && shot.index > 1) {
    const prevVid = join(kindDir("jobs", jobId), "shots", pad(shot.index - 1), "video.mp4");
    if (existsSync(prevVid)) req.videos = [prevVid];
  }
  const promptChars = Array.from(req.prompt).length;
  console.log(
    "[generate] job=" +
      jobId +
      " shot=" +
      shot.index +
      " 完整视频提示词 (" +
      promptChars +
      "字):\n" +
      req.prompt,
  );
  const redacted = {
    ...req,
    images: req.images.map(() => "[local]"),
    audios: ["[local]"],
    videos: req.videos.map(() => "[local]"),
  };
  writeFileSync(join(dir, "request.json"), JSON.stringify(redacted, null, 2));

  const run = await db("shot_runs").where({ job_id: jobId, shot_index: shot.index }).first();
  let requestId = readStoredRequestId(jobId, shot.index, run);
  if (!requestId) {
    requestId = await videoProvider.submit(req);
    persistProviderRequestId(jobId, shot.index, requestId);
    await db("shot_runs").where({ job_id: jobId, shot_index: shot.index }).update({
      provider_request_id: requestId,
      status: "generating",
      started_at: nowIso(),
      attempt: Number(run?.attempt || 0) + 1,
    });
  } else if (!run?.provider_request_id) {
    await db("shot_runs").where({ job_id: jobId, shot_index: shot.index }).update({
      provider_request_id: requestId,
    });
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await cancelled(jobId)) {
      await videoProvider.cancel(requestId);
      throw new ApiError(409, "cancelled", "用户取消");
    }
    await db("jobs").where({ id: jobId }).update({ lease_expires_at: videoLeaseExpiry() });
    let poll;
    try {
      poll = await videoProvider.poll(requestId);
    } catch (err) {
      console.log(`[generate] 轮询异常 job=${jobId} shot=${shot.index} ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 4000));
      continue;
    }
    if (poll.status === "succeeded") {
      await ingestSucceededVideo(jobId, shot.index, poll.url, videoProvider);
      return;
    }
    if (poll.status === "failed") {
      throw new ApiError(502, poll.code, poll.message);
    }
    if (poll.status === "unavailable") {
      console.log(`[generate] 轮询暂不可用 job=${jobId} shot=${shot.index} ${poll.message}`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new ApiError(504, "provider_timeout", "视频生成超时（已等待 1 小时）");
}

async function ingestSucceededVideo(
  jobId: string,
  shotIndex: number,
  url: string,
  videoProvider: ReturnType<typeof getVideoProvider>,
) {
  const dir = shotDir(jobId, shotIndex);
  const videoPath = join(dir, "video.mp4");
  await videoProvider.download(url, videoPath);
  await probeVideo(videoPath);
  const endPath = join(dir, "end.png");
  await extractLastFrame(videoPath, endPath);
  if (!existsSync(endPath)) throw new ApiError(500, "extract_failed", "抽尾帧失败");
  const relVideo = `jobs/${jobId}/shots/${pad(shotIndex)}/video.mp4`;
  const relEnd = `jobs/${jobId}/shots/${pad(shotIndex)}/end.png`;
  await db("shot_runs").where({ job_id: jobId, shot_index: shotIndex }).update({
    status: "succeeded",
    video_path: relVideo,
    end_frame_path: relEnd,
    error: null,
    finished_at: nowIso(),
  });
  await emitEvent({ jobId, eventType: "shot_done", shotIndex, message: `第 ${shotIndex} 段完成` });
}

async function reconcileJobAfterShotQuery(jobId: string) {
  const board = readStoryboard(jobId);
  const runs = await db("shot_runs").where({ job_id: jobId });
  const byIndex = new Map(runs.map((r) => [Number(r.shot_index), r]));
  const allSucceeded = (board?.shots || []).every((s) => byIndex.get(s.index)?.status === "succeeded");
  if (allSucceeded && board?.shots.length) {
    await db("jobs").where({ id: jobId }).update({
      status: "concatenating",
      error: null,
      worker_id: null,
      lease_expires_at: null,
      updated_at: nowIso(),
    });
    return;
  }
  const failed = (board?.shots || [])
    .map((s) => byIndex.get(s.index))
    .find((r) => r && r.status === "failed");
  await db("jobs").where({ id: jobId }).update({
    status: "needs_retry",
    error: failed ? String(failed.error || "") : null,
    worker_id: null,
    lease_expires_at: null,
    updated_at: nowIso(),
  });
}

/** 用提交时记下的 provider_request_id 向云端查一次。成功则落盘并更新段/任务状态。 */
export async function queryShotFromProvider(jobId: string, shotIndex: number) {
  const job = await db("jobs").where({ id: jobId }).first();
  if (!job) throw new ApiError(404, "not_found", "任务不存在");
  const run = await db("shot_runs").where({ job_id: jobId, shot_index: shotIndex }).first();
  if (!run) throw new ApiError(404, "not_found", "没有这一段");
  if (run.status === "succeeded" && run.video_path) {
    return;
  }
  const requestId = readStoredRequestId(jobId, shotIndex, run);
  if (!requestId) {
    throw new ApiError(400, "validation_failed", "没有云端任务 ID（提交未成功记下），请重做本段");
  }
  if (!run.provider_request_id) {
    await db("shot_runs").where({ id: run.id }).update({ provider_request_id: requestId });
  }
  const videoProvider = getVideoProvider(String(job.video_model));
  let poll;
  try {
    poll = await videoProvider.poll(requestId);
  } catch (err) {
    throw new ApiError(502, "provider_5xx", (err as Error).message || "查询失败");
  }
  if (poll.status === "unavailable") {
    throw new ApiError(502, "provider_5xx", poll.message || "查询失败");
  }
  if (poll.status === "queued" || poll.status === "running") {
    await db("shot_runs").where({ id: run.id }).update({
      error: "云端仍在生成，请稍后再查",
    });
    await db("jobs").where({ id: jobId }).update({
      error: "云端仍在生成，请稍后再查",
      updated_at: nowIso(),
    });
    return;
  }
  if (poll.status === "failed") {
    await db("shot_runs").where({ id: run.id }).update({
      status: "failed",
      error: poll.message,
      finished_at: nowIso(),
    });
    await db("jobs").where({ id: jobId }).update({
      status: "needs_retry",
      error: poll.message,
      worker_id: null,
      lease_expires_at: null,
      updated_at: nowIso(),
    });
    await emitEvent({
      jobId,
      level: "error",
      eventType: "shot_failed",
      shotIndex,
      message: poll.message,
    });
    return;
  }
  if (poll.status !== "succeeded") {
    throw new ApiError(502, "provider_5xx", "查询结果未知");
  }
  await ingestSucceededVideo(jobId, shotIndex, poll.url, videoProvider);
  await reconcileJobAfterShotQuery(jobId);
}

export async function concatJob(jobId: string) {
  const now = nowIso();
  await db("jobs").where({ id: jobId }).update({ status: "concatenating", updated_at: now });
  const job = await db("jobs").where({ id: jobId }).first();
  if (!job) throw new ApiError(404, "not_found", "任务不存在");
  const colorMatchEnabled = Number(job.color_match_enabled) !== 0;
  const colorMatchRequested = Number(job.color_match_requested) === 1;
  const shouldColorMatch = colorMatchEnabled || colorMatchRequested;
  const board = readStoryboard(jobId);
  if (!board) throw new ApiError(400, "validation_failed", "没有分镜");
  const rels = board.shots.map((s) => `shots/${pad(s.index)}/video.mp4`);
  const dir = kindDir("jobs", jobId);
  const final = join(dir, "final.mp4");
  const original = join(dir, "final-original.mp4");
  const colorMeta = join(dir, "color-match.json");
  if (existsSync(final)) copyFileSync(final, join(dir, "final.prev.mp4"));
  await concatCopy(dir, rels, "final-original.mp4");
  let colorMatchApplied = false;
  let colorMessage = shouldColorMatch ? "单段视频无需匹配色彩" : "使用原始拼接版";
  if (rels.length > 1 && shouldColorMatch) {
    try {
      const result = await concatColorMatched(dir, rels);
      colorMatchApplied = true;
      colorMessage = "已以第 1 段为基准自动统一各段色彩";
      writeFileSync(
        colorMeta,
        JSON.stringify({ enabled: colorMatchEnabled, requested: colorMatchRequested, applied: true, ...result }, null, 2),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      colorMessage = `色彩匹配失败，已回退原始拼接版：${message}`;
      const fallback = join(dir, `final.fallback-${randomUUID()}.mp4`);
      copyFileSync(original, fallback);
      renameSync(fallback, final);
      writeFileSync(
        colorMeta,
        JSON.stringify({ enabled: colorMatchEnabled, requested: colorMatchRequested, applied: false, error: message }, null, 2),
      );
    }
  } else {
    const single = join(dir, `final.single-${randomUUID()}.mp4`);
    copyFileSync(original, single);
    renameSync(single, final);
    writeFileSync(
      colorMeta,
      JSON.stringify(
        {
          enabled: colorMatchEnabled,
          requested: colorMatchRequested,
          applied: false,
          reason: shouldColorMatch ? "single_segment" : "disabled",
        },
        null,
        2,
      ),
    );
  }
  await db("jobs").where({ id: jobId }).update({
    status: "done",
    final_video_path: `jobs/${jobId}/final.mp4`,
    error: null,
    color_match_requested: 0,
    worker_id: null,
    lease_expires_at: null,
    updated_at: nowIso(),
  });
  await emitEvent({
    jobId,
    level: colorMatchApplied || rels.length === 1 || !shouldColorMatch ? "info" : "warning",
    eventType: "concat_done",
    message: `成片已拼接。${colorMessage}`,
  });
}

export async function runJob(jobId: string) {
  const job = await db("jobs").where({ id: jobId }).first();
  if (!job) return;
  const board = readStoryboard(jobId);
  if (!board) throw new ApiError(400, "validation_failed", "没有分镜");
  await syncShotRuns(jobId, board.shots);
  for (const shot of board.shots) {
    if (await cancelled(jobId)) {
      await db("jobs").where({ id: jobId }).update({
        status: "cancelled",
        worker_id: null,
        updated_at: nowIso(),
      });
      await emitEvent({ jobId, eventType: "cancelled", message: "已取消" });
      return;
    }
    const run = await db("shot_runs").where({ job_id: jobId, shot_index: shot.index }).first();
    if (run?.status === "succeeded") continue;
    try {
      await generateShot(job, shot);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err as Error).message;
      const code = err instanceof ApiError ? err.code : "error";
      if (code === "cancelled") {
        await db("shot_runs").where({ job_id: jobId, shot_index: shot.index }).update({ status: "cancelled", error: message });
        await db("jobs").where({ id: jobId }).update({ status: "cancelled", worker_id: null, updated_at: nowIso() });
        return;
      }
      await db("shot_runs").where({ job_id: jobId, shot_index: shot.index }).update({
        status: "failed",
        error: message,
        finished_at: nowIso(),
      });
      await db("jobs").where({ id: jobId }).update({
        status: "needs_retry",
        error: message,
        worker_id: null,
        lease_expires_at: null,
        updated_at: nowIso(),
      });
      await emitEvent({ jobId, level: "error", eventType: "shot_failed", shotIndex: shot.index, message });
      return;
    }
  }
  try {
    await concatJob(jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db("jobs").where({ id: jobId }).update({
      status: "concat_failed",
      error: message,
      worker_id: null,
      updated_at: nowIso(),
    });
    await emitEvent({ jobId, level: "error", eventType: "concat_failed", message });
  }
}
