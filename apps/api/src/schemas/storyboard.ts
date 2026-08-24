import { z } from "zod";

export const ShotSchema = z.object({
  index: z.number().int(),
  dialogue: z.string(),
  duration_sec: z.number(),
  shot_size: z.enum(["中近景", "近景", "中景"]),
  camera: z.enum(["固定", "固定，后段极轻 Dolly In"]),
  stance: z.enum(["坐", "站"]),
  facing: z.string(),
  action: z.string(),
  emotion: z.string(),
  visual: z.string(),
  continuity: z.enum(["开篇", "承接上段尾帧", "独立"]),
  end_frame: z.string(),
  prompt: z.string().default(""),
  prompt_override: z.boolean().default(false),
});

export const StoryboardSchema = z.object({
  skill: z.literal("koubo"),
  model: z.enum([
    "seedance-2.0",
    "seedance-2.0-fast",
    "seedance-2.0-mini",
    "seedance-2.5",
    "seedance-2.0-real",
    "seedance-2.0-fast-real",
    "seedance-2.0-mini-real",
    "seedance-2.5-real",
    "MiniMax-H3",
  ]),
  aspect_ratio: z.enum(["16:9", "9:16"]),
  resolution: z.enum(["480p", "720p", "768P", "2K"]),
  stance: z.enum(["坐", "站"]),
  assets: z.object({
    character: z.string(),
    scene: z.string(),
    voice: z.string(),
  }),
  shots: z.array(ShotSchema).min(1),
});

export type Shot = z.infer<typeof ShotSchema>;
export type Storyboard = z.infer<typeof StoryboardSchema>;

export const MODEL_LIMITS: Record<string, { min: number; max: number }> = {
  "seedance-2.0": { min: 4, max: 15 },
  "seedance-2.0-fast": { min: 4, max: 15 },
  "seedance-2.0-mini": { min: 4, max: 15 },
  "seedance-2.5": { min: 4, max: 30 },
  "seedance-2.0-real": { min: 4, max: 15 },
  "seedance-2.0-fast-real": { min: 4, max: 15 },
  "seedance-2.0-mini-real": { min: 4, max: 15 },
  "seedance-2.5-real": { min: 4, max: 30 },
  "MiniMax-H3": { min: 2, max: 15 },
};
