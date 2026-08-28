import { db } from "../db.js";
import { env } from "../env.js";
import { enabledVideoModelIds } from "./modelSettings.js";
import { ApiError } from "../errors.js";
import { nowIso } from "../ids.js";
import { setWorkerStatus } from "../routes/health.js";
import { runAssetJob } from "./boardGenerate.js";
import { emitEvent } from "./events.js";
import { concatJob, runJob } from "./generation.js";
import { generateStoryboard } from "./storyboard.js";
import { beginShutdown, resetShutdown } from "./runtime.js";

const WORKER = "local-1";

function leaseExpiry() {
  return new Date(Date.now() + env.leaseSec * 1000).toISOString();
}

function videoLeaseExpiry() {
  return new Date(Date.now() + env.leaseSec * 20 * 1000).toISOString();
}

export async function recoverStuckJobs() {
  const now = nowIso();
  await db("asset_jobs")
    .where({ status: "generating" })
    .update({ status: "queued", error: null, worker_id: null, lease_expires_at: null, updated_at: now });
  await db("jobs")
    .where({ status: "storyboarding" })
    .whereNotNull("worker_id")
    .update({ worker_id: null, lease_expires_at: null, updated_at: now });
  await db("jobs")
    .where({ status: "generating", cancel_requested: 1 })
    .update({ status: "cancelled", worker_id: null, lease_expires_at: null, updated_at: now });
  await db("jobs")
    .where({ status: "generating" })
    .whereNotNull("worker_id")
    .update({ worker_id: null, lease_expires_at: null, updated_at: now });
  await db("jobs")
    .where({ status: "concatenating" })
    .update({ worker_id: null, lease_expires_at: null, updated_at: now });
}

async function claimAsset() {
  const now = nowIso();
  const row = await db("asset_jobs")
    .where((q) => {
      q.where({ status: "queued" }).orWhere((q2) => {
        q2.where({ status: "generating" }).andWhere("lease_expires_at", "<", now);
      });
    })
    .orderBy("created_at", "asc")
    .first();
  if (!row) return null;
  const n = await db("asset_jobs")
    .where({ id: row.id })
    .whereIn("status", ["queued", "generating"])
    .update({
      status: "generating",
      worker_id: WORKER,
      claimed_at: now,
      lease_expires_at: leaseExpiry(),
      updated_at: now,
    });
  return n ? row : null;
}

async function claimStoryboard() {
  const now = nowIso();
  const row = await db("jobs")
    .where((q) => {
      q.where((q1) => {
        q1.where({ status: "storyboarding" }).andWhere((q2) => {
          q2.whereNull("worker_id").orWhere("lease_expires_at", "<", now);
        });
      });
    })
    .orderBy("created_at", "asc")
    .first();
  if (!row) return null;
  const n = await db("jobs")
    .where({ id: row.id, status: "storyboarding" })
    .update({
      worker_id: WORKER,
      claimed_at: now,
      lease_expires_at: leaseExpiry(),
      updated_at: now,
    });
  return n ? { ...row, worker_id: WORKER } : null;
}

async function claimGenerate() {
  const now = nowIso();
  const statuses = enabledVideoModelIds().length
    ? ["queued", "generating", "concatenating"]
    : ["generating", "concatenating"];
  const row = await db("jobs")
    .whereIn("status", statuses)
    .andWhere((q) => {
      q.whereNull("worker_id").orWhere("lease_expires_at", "<", now);
    })
    .orderBy("created_at", "asc")
    .first();
  if (!row) return null;
  const nextStatus = row.status === "queued" ? "generating" : row.status;
  const n = await db("jobs")
    .where({ id: row.id })
    .whereIn("status", statuses)
    .update({
      status: nextStatus,
      worker_id: WORKER,
      claimed_at: now,
      lease_expires_at: videoLeaseExpiry(),
      updated_at: now,
    });
  return n ? { ...row, status: nextStatus, worker_id: WORKER } : null;
}

let busy = false;
let accepting = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function tick() {
  if (busy || !accepting) return;
  busy = true;
  try {
    await tickOnce();
  } finally {
    busy = false;
  }
}

async function tickOnce() {
  const asset = await claimAsset();
  if (asset) {
    setWorkerStatus("generating_board");
    try {
      await runAssetJob(asset);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err as Error).message;
      const paused = err instanceof ApiError && err.code === "worker_paused";
      await db("asset_jobs").where({ id: asset.id }).update({
        status: paused ? "queued" : "failed",
        error: paused ? null : message,
        worker_id: null,
        lease_expires_at: null,
        updated_at: nowIso(),
      });
      if (!paused) {
        await emitEvent({
          jobId: `asset:${asset.id}`,
          level: "error",
          eventType: "error",
          message,
        });
      }
    }
    setWorkerStatus("idle");
    return;
  }

  const job = await claimStoryboard();
  if (job) {
    setWorkerStatus("storyboarding");
    try {
      const fresh = await db("jobs").where({ id: job.id }).first();
      await generateStoryboard(fresh!);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err as Error).message;
      const paused = err instanceof ApiError && err.code === "worker_paused";
      await db("jobs").where({ id: job.id }).update({
        status: paused ? "storyboarding" : "draft",
        error: paused ? null : message,
        worker_id: null,
        lease_expires_at: null,
        updated_at: nowIso(),
      });
      if (!paused) {
        await emitEvent({ jobId: String(job.id), level: "error", eventType: "error", message });
      }
    }
    setWorkerStatus("idle");
    return;
  }

  const gen = await claimGenerate();
  if (gen) {
    const concatenating = String(gen.status) === "concatenating";
    setWorkerStatus(concatenating ? "concatenating" : "generating_video");
    try {
      if (concatenating) await concatJob(String(gen.id));
      else await runJob(String(gen.id));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err as Error).message;
      const code = err instanceof ApiError ? err.code : "error";
      if (code === "worker_paused") {
        await db("jobs").where({ id: gen.id }).update({
          worker_id: null,
          lease_expires_at: null,
          error: null,
          updated_at: nowIso(),
        });
      } else if (code === "cancelled") {
        await db("jobs").where({ id: gen.id }).update({
          status: "cancelled",
          worker_id: null,
          lease_expires_at: null,
          updated_at: nowIso(),
        });
      } else if (concatenating) {
        await db("jobs").where({ id: gen.id }).update({
          status: "concat_failed",
          error: message,
          color_match_requested: 0,
          worker_id: null,
          lease_expires_at: null,
          updated_at: nowIso(),
        });
        await emitEvent({ jobId: String(gen.id), level: "error", eventType: "concat_failed", message });
      } else {
        await db("jobs").where({ id: gen.id }).update({
          status: "needs_retry",
          error: message,
          worker_id: null,
          lease_expires_at: null,
          updated_at: nowIso(),
        });
        await emitEvent({ jobId: String(gen.id), level: "error", eventType: "error", message });
      }
    }
    setWorkerStatus("idle");
  }
}

export async function startWorker() {
  if (timer) return;
  resetShutdown();
  accepting = true;
  await recoverStuckJobs();
  timer = setInterval(() => {
    void tick().catch((err) => console.error("worker", err));
  }, 500);
}

export function isWorkerBusy(): boolean {
  return busy;
}

export async function stopWorker(waitMs = 10_000): Promise<boolean> {
  accepting = false;
  beginShutdown();
  if (timer) clearInterval(timer);
  timer = null;
  const deadline = Date.now() + waitMs;
  while (busy && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const now = nowIso();
  await db("asset_jobs").where({ worker_id: WORKER }).update({
    status: "queued",
    error: null,
    worker_id: null,
    lease_expires_at: null,
    updated_at: now,
  });
  await db("jobs").where({ worker_id: WORKER }).update({
    worker_id: null,
    lease_expires_at: null,
    updated_at: now,
  });
  setWorkerStatus("paused");
  return !busy;
}
