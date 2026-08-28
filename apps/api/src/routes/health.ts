import { Router } from "express";
import { env, REPO_ROOT } from "../env.js";
import { ffmpegVersion } from "../services/media.js";
import { ARK_VIDEO_MODELS, enabledVideoModelIds, getModelSettings, isImageEnabled, MINIMAX_VIDEO_MODEL } from "../services/modelSettings.js";

export const healthRouter = Router();

export let workerStatus = "idle";

export function setWorkerStatus(s: string) {
  workerStatus = s;
}

healthRouter.get("/health", async (_req, res, next) => {
  try {
    const ffmpeg = await ffmpegVersion();
    res.json({ ok: true, ffmpeg, data_dir: env.dataDir, worker: workerStatus });
  } catch (err) {
    next(err);
  }
});

healthRouter.get("/config", (_req, res) => {
  const settings = getModelSettings();
  const enabled = new Set(enabledVideoModelIds(settings));
  const videoModels: { id: string; label: string; min_sec: number; max_sec: number; resolutions: string[] }[] = ARK_VIDEO_MODELS.filter((m) => enabled.has(m.id)).map((m) => ({
    id: m.id,
    label: m.label,
    min_sec: m.minSec,
    max_sec: m.maxSec,
    resolutions: ["480p", "720p"],
  }));
  if (enabled.has(MINIMAX_VIDEO_MODEL)) {
    videoModels.push({ id: MINIMAX_VIDEO_MODEL, label: "MiniMax H3", min_sec: 2, max_sec: 15, resolutions: ["480p", "720p", "768P", "2K"] });
  }
  res.json({
    video_models: videoModels,
    image_models: isImageEnabled(settings) ? [{ id: settings.image.model, label: settings.image.model }] : [],
    skills: [{ id: "koubo", label: "口播", path: "skills/koubo/SKILL.md" }],
    defaults: {
      video_model: settings.defaultVideoModel,
      aspect_ratio: "16:9",
      resolution: "720p",
    },
    limits: {
      voice_max_sec: env.voiceMaxSec,
      image_max_mb: env.imageMaxMb,
      audio_max_mb: env.audioMaxMb,
    },
    features: {
      image_gen: isImageEnabled(settings),
      video_gen: videoModels.length > 0,
    },
    repo_root: REPO_ROOT,
  });
});
