import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { db } from "../db.js";
import { env } from "../env.js";
import { ApiError } from "../errors.js";
import { chatJson } from "../providers/llm.js";
import { StoryboardSchema, type Shot, type Storyboard } from "../schemas/storyboard.js";
import { alnum, inferStance, modelLimits, renderKouboPrompt } from "../skills/koubo.js";
import { emitEvent } from "./events.js";
import { kindDir } from "./storage.js";

function loadSkill(): string {
  return readFileSync(join(env.resourceRoot, "skills/koubo/SKILL.md"), "utf8");
}

export function jobLinksEndFrame(job: Record<string, unknown>): boolean {
  return Number(job.link_end_frame) === 1;
}

export function promptCtx(job: Record<string, unknown>, names: { character: string; scene: string; voice: string }) {
  return {
    model: String(job.video_model),
    aspect_ratio: String(job.aspect_ratio),
    resolution: String(job.resolution),
    stance: String(job.stance || "站"),
    character: names.character,
    scene: names.scene,
    voice: names.voice,
    img1: "图1",
    img2: "图2",
    img3: "图3",
    aud1: "音频1",
    linkEndFrame: jobLinksEndFrame(job),
    extra: String(job.video_system_prompt || "").trim(),
  };
}

export function fillPrompts(board: Storyboard, job: Record<string, unknown>, onlyMissing = false) {
  const ctx = promptCtx(job, board.assets);
  const link = jobLinksEndFrame(job);
  for (const shot of board.shots) {
    shot.continuity = shot.index === 1 ? "开篇" : link ? "承接上段尾帧" : "独立";
    if (onlyMissing && shot.prompt && shot.prompt_override) continue;
    if (shot.prompt_override) continue;
    shot.prompt = renderKouboPrompt(shot, ctx);
  }
}

export function validateStoryboard(board: Storyboard, script: string, model: string, linkEndFrame = false) {
  const lim = modelLimits(model);
  const joined = alnum(board.shots.map((s) => s.dialogue).join(""));
  if (joined !== alnum(script)) {
    throw new ApiError(422, "dialogue_mismatch", "分镜台词与口播稿不完全一致（去掉标点后须逐字相同）");
  }
  const stance = board.stance;
  for (const s of board.shots) {
    if (s.duration_sec < lim.min || s.duration_sec > lim.max) {
      throw new ApiError(422, "duration_out_of_range", `第 ${s.index} 段时长 ${s.duration_sec}s 超出 ${model} 的 ${lim.min}-${lim.max}s`);
    }
    if (s.prompt_override && !s.prompt.trim()) {
      throw new ApiError(422, "validation_failed", `第 ${s.index} 段的手动完整提示词不能为空`);
    }
    if (s.stance !== stance) throw new ApiError(422, "stance_mismatch", "全片姿态必须一致");
    if (!s.end_frame.trim()) throw new ApiError(422, "validation_failed", `第 ${s.index} 段缺少尾帧`);
  }
  if (board.shots[0]?.continuity !== "开篇") throw new ApiError(422, "validation_failed", "第 1 段承接必须是开篇");
  if (linkEndFrame) {
    for (const s of board.shots.slice(1)) {
      if (s.continuity !== "承接上段尾帧") {
        throw new ApiError(422, "validation_failed", `第 ${s.index} 段必须承接上段尾帧`);
      }
    }
  }
}

export function writeStoryboard(jobId: string, board: Storyboard) {
  const dir = kindDir("jobs", jobId);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, "storyboard.json.tmp");
  const dest = join(dir, "storyboard.json");
  writeFileSync(tmp, JSON.stringify(board, null, 2));
  renameSync(tmp, dest);
  return `jobs/${jobId}/storyboard.json`;
}

export function readStoryboard(jobId: string): Storyboard | null {
  try {
    const raw = JSON.parse(readFileSync(join(kindDir("jobs", jobId), "storyboard.json"), "utf8"));
    return StoryboardSchema.parse(raw);
  } catch {
    return null;
  }
}

export async function generateStoryboard(job: Record<string, unknown>) {
  const jobId = String(job.id);
  const ch = await db("characters").where({ id: job.character_id }).first();
  const sc = await db("scenes").where({ id: job.scene_id }).first();
  const vo = await db("voices").where({ id: job.voice_id }).first();
  if (!ch?.board_path || !sc?.board_path || !vo?.audio_path) {
    throw new ApiError(400, "validation_failed", "人物板、场景板和音色都必须齐备才能出分镜");
  }
  const lim = modelLimits(String(job.video_model));
  const stance = (job.stance as "坐" | "站") || inferStance(String(sc.name), String(sc.bio || ""));
  const skill = loadSkill();
  const userExtra = String(job.storyboard_system_prompt || "").trim();
  const userExtraBlock = userExtra
    ? `\n\n用户补充要求（须遵守，但不得改台词、不得增减或改写 JSON 字段合同）：\n${userExtra}`
    : "";
  const user = `口播稿：
<<<
${job.script}
>>>
人物：${ch.name}。${ch.bio || ""}
场景：${sc.name}。${sc.bio || ""}
音色：${vo.name}
模型：${job.video_model} 最短${lim.min}s 最长${lim.max}s
画幅：${job.aspect_ratio} 分辨率：${job.resolution} 姿态：${stance}
按 Skill 由你理解内容后切段。用户标点可能错误，不得把句号等同于必须切段；优先保留完整语义，只在内容上能明显停顿、上下段可独立表达的位置切分。优先使用最少视频任务，尽量让每段接近 ${lim.max}s。若一个语义完整段的估算时长仅超出上限 1s 以内，不要因此拆成两段，应将 duration_sec 设为 ${lim.max}s；超出 1s 以上才在最佳语义停顿处切分。台词必须保持原文顺序且不得改字。只输出工作台 JSON。${userExtraBlock}`;

  let usedSchema = true;
  let parsed: Storyboard | null = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const extra = lastErr ? `\n上次校验失败：${lastErr}。请修正后再输出完整 JSON。` : "";
    const { text, usedSchema: used } = await chatJson({
      system: `${skill}\n\n只输出一个 JSON 对象，字段必须与工作台 JSON 完全一致。不要 Markdown 围栏。prompt 字段可留空，服务端会按模板渲染。${userExtraBlock}${extra}`,
      user,
      schema: z.toJSONSchema(StoryboardSchema) as Record<string, unknown>,
    });
    usedSchema = used;
    try {
      const json = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
      parsed = StoryboardSchema.parse(json);
      parsed.skill = "koubo";
      parsed.model = job.video_model as Storyboard["model"];
      parsed.aspect_ratio = job.aspect_ratio as Storyboard["aspect_ratio"];
      parsed.resolution = job.resolution as Storyboard["resolution"];
      parsed.stance = stance;
      parsed.assets = { character: String(ch.name), scene: String(sc.name), voice: String(vo.name) };
      const link = jobLinksEndFrame(job);
      parsed.shots.forEach((s, i) => {
        s.index = i + 1;
        s.stance = stance;
        s.continuity = i === 0 ? "开篇" : link ? "承接上段尾帧" : "独立";
        s.prompt_override = false;
      });
      fillPrompts(parsed, { ...job, stance });
      validateStoryboard(parsed, String(job.script), String(job.video_model), link);
      lastErr = "";
      break;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      parsed = null;
    }
  }
  if (!parsed) {
    throw new ApiError(422, "storyboard_invalid", lastErr || "分镜校验失败");
  }

  const path = writeStoryboard(jobId, parsed);
  const now = new Date().toISOString();
  await db("shot_runs").where({ job_id: jobId }).del();
  await db("jobs").where({ id: jobId }).update({
    status: "storyboard_ready",
    stance,
    storyboard_path: path,
    final_video_path: null,
    error: null,
    worker_id: null,
    lease_expires_at: null,
    updated_at: now,
  });
  await emitEvent({
    jobId,
    eventType: "storyboard_ready",
    message: usedSchema ? "分镜已就绪" : "分镜已就绪（LLM 回退 json_object）",
  });
}

export function applyShotEdits(board: Storyboard, shots: Partial<Shot>[]): Storyboard {
  const byIndex = new Map(board.shots.map((s) => [s.index, s]));
  const next: Shot[] = shots.map((p, i) => {
    const idx = p.index ?? i + 1;
    const old = byIndex.get(idx);
    return {
      ...(old ?? board.shots[0]!),
      ...p,
      index: idx,
    };
  });
  return { ...board, shots: next };
}
