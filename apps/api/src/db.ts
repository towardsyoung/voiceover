import { mkdirSync } from "node:fs";
import { join } from "node:path";
import knex, { type Knex } from "knex";
import { env } from "./env.js";

mkdirSync(env.dataDir, { recursive: true });

export const db: Knex = knex({
  client: "better-sqlite3",
  connection: { filename: join(env.dataDir, "app.db") },
  useNullAsDefault: true,
});

export async function initDb(): Promise<void> {
  await db.raw("PRAGMA journal_mode=WAL");
  await db.raw("PRAGMA foreign_keys=ON");

  async function ensureColumn(table: string, column: string, type: string, defaultTo?: string) {
    const exists = await db.schema.hasColumn(table, column);
    if (exists) return;
    const sql = defaultTo
      ? `ALTER TABLE ${table} ADD COLUMN ${column} ${type} DEFAULT '${defaultTo}'`
      : `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`;
    await db.schema.raw(sql);
  }

  if (!(await db.schema.hasTable("characters"))) {
    await db.schema.createTable("characters", (t) => {
      t.text("id").primary();
      t.text("name").notNullable();
      t.text("bio").notNullable().defaultTo("");
      t.text("default_voice_id");
      t.text("source_kind").notNullable();
      t.text("board_path");
      t.text("created_at").notNullable();
      t.text("updated_at").notNullable();
      // 火山素材库（真人参考图审核，对标 Toonflow o_image 的 volcengineAsset* 字段）
      t.text("volc_asset_id");
      t.text("volc_asset_status").notNullable().defaultTo("none"); // none|submitting|auditing|approved|rejected|failed
      t.text("volc_asset_reason");
      t.text("volc_asset_group_id");
      t.text("volc_submitted_at");
      t.text("volc_checked_at");
    });
  }
  // 旧库补列
  await ensureColumn("characters", "volc_asset_id", "text");
  await ensureColumn("characters", "volc_asset_status", "text", "none");
  await ensureColumn("characters", "volc_asset_reason", "text");
  await ensureColumn("characters", "volc_asset_group_id", "text");
  await ensureColumn("characters", "volc_submitted_at", "text");
  await ensureColumn("characters", "volc_checked_at", "text");
  if (!(await db.schema.hasTable("character_sources"))) {
    await db.schema.createTable("character_sources", (t) => {
      t.text("id").primary();
      t.text("character_id").notNullable().references("id").inTable("characters").onDelete("CASCADE");
      t.text("role").notNullable();
      t.text("path").notNullable();
      t.integer("sort_order").notNullable().defaultTo(0);
    });
  }
  if (!(await db.schema.hasTable("scenes"))) {
    await db.schema.createTable("scenes", (t) => {
      t.text("id").primary();
      t.text("name").notNullable();
      t.text("bio").notNullable().defaultTo("");
      t.text("source_kind").notNullable();
      t.text("gen_prompt");
      t.text("board_path");
      t.text("created_at").notNullable();
      t.text("updated_at").notNullable();
    });
  }
  if (!(await db.schema.hasTable("voices"))) {
    await db.schema.createTable("voices", (t) => {
      t.text("id").primary();
      t.text("name").notNullable();
      t.text("bio").notNullable().defaultTo("");
      t.text("character_id").references("id").inTable("characters").onDelete("SET NULL");
      t.text("audio_path").notNullable();
      t.integer("duration_ms").notNullable();
      t.text("mime").notNullable().defaultTo("audio/wav");
      t.text("created_at").notNullable();
      t.text("updated_at").notNullable();
    });
  }
  if (!(await db.schema.hasTable("jobs"))) {
    await db.schema.createTable("jobs", (t) => {
      t.text("id").primary();
      t.text("title").notNullable().defaultTo("");
      t.text("script").notNullable().defaultTo("");
      t.text("character_id").references("id").inTable("characters");
      t.text("scene_id").references("id").inTable("scenes");
      t.text("voice_id").references("id").inTable("voices");
      t.text("character_name_snap");
      t.text("scene_name_snap");
      t.text("voice_name_snap");
      t.text("skill").notNullable().defaultTo("koubo");
      t.text("video_model").notNullable().defaultTo("seedance-2.0");
      t.text("aspect_ratio").notNullable().defaultTo("16:9");
      t.text("resolution").notNullable().defaultTo("720p");
      t.text("stance");
      t.text("storyboard_path");
      t.text("status").notNullable().defaultTo("draft");
      t.text("error");
      t.text("final_video_path");
      t.text("worker_id");
      t.text("claimed_at");
      t.text("lease_expires_at");
      t.integer("cancel_requested").notNullable().defaultTo(0);
      t.integer("link_end_frame").notNullable().defaultTo(0);
      t.text("storyboard_system_prompt").notNullable().defaultTo("");
      t.text("video_system_prompt").notNullable().defaultTo("");
      t.text("created_at").notNullable();
      t.text("updated_at").notNullable();
    });
  }
  // 旧任务默认保持原行为（衔尾帧）；新任务插入时显式写 0/1
  await ensureColumn("jobs", "link_end_frame", "integer", "1");
  await ensureColumn("jobs", "storyboard_system_prompt", "text", "");
  await ensureColumn("jobs", "video_system_prompt", "text", "");
  if (!(await db.schema.hasTable("shot_runs"))) {
    await db.schema.createTable("shot_runs", (t) => {
      t.text("id").primary();
      t.text("job_id").notNullable().references("id").inTable("jobs").onDelete("CASCADE");
      t.integer("shot_index").notNullable();
      t.text("status").notNullable();
      t.integer("attempt").notNullable().defaultTo(0);
      t.text("video_path");
      t.text("end_frame_path");
      t.text("provider_request_id");
      t.integer("seed");
      t.text("error");
      t.text("started_at");
      t.text("finished_at");
      t.unique(["job_id", "shot_index"]);
    });
  }
  if (!(await db.schema.hasTable("asset_jobs"))) {
    await db.schema.createTable("asset_jobs", (t) => {
      t.text("id").primary();
      t.text("kind").notNullable();
      t.text("target_id").notNullable();
      t.text("status").notNullable();
      t.text("error");
      t.text("result_path");
      t.text("worker_id");
      t.text("claimed_at");
      t.text("lease_expires_at");
      t.integer("cancel_requested").notNullable().defaultTo(0);
      t.text("created_at").notNullable();
      t.text("updated_at").notNullable();
    });
    await db.schema.raw(
      "CREATE INDEX IF NOT EXISTS asset_jobs_target_inflight ON asset_jobs(target_id, status)",
    );
  }
  if (!(await db.schema.hasTable("job_events"))) {
    await db.schema.createTable("job_events", (t) => {
      t.increments("id").primary();
      t.text("job_id").notNullable();
      t.text("ts").notNullable();
      t.text("level").notNullable();
      t.text("event_type").notNullable();
      t.integer("shot_index");
      t.text("message").notNullable();
      t.text("extra_json");
    });
    await db.schema.raw("CREATE INDEX IF NOT EXISTS job_events_job_id ON job_events(job_id, id)");
  }
}
