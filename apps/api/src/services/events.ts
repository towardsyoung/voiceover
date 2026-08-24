import { db } from "../db.js";
import { nowIso } from "../ids.js";

export async function emitEvent(input: {
  jobId: string;
  level?: string;
  eventType: string;
  message: string;
  shotIndex?: number;
  extra?: unknown;
}) {
  await db("job_events").insert({
    job_id: input.jobId,
    ts: nowIso(),
    level: input.level || "info",
    event_type: input.eventType,
    shot_index: input.shotIndex ?? null,
    message: input.message,
    extra_json: input.extra ? JSON.stringify(input.extra) : null,
  });
}
