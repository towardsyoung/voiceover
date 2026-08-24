import { Router } from "express";
import { env, REPO_ROOT } from "../env.js";
import { MINIMAX_VIDEO_MODEL } from "../providers/videoMinimax.js";
import { ffmpegVersion } from "../services/media.js";

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
  res.json({
    video_models: [
      { id: "seedance-2.0", label: "Seedance 2.0", min_sec: 4, max_sec: 15, resolutions: ["480p", "720p"] },
      { id: "seedance-2.0-fast", label: "Seedance 2.0 Fast", min_sec: 4, max_sec: 15, resolutions: ["480p", "720p"] },
      { id: "seedance-2.0-mini", label: "Seedance 2.0 Mini", min_sec: 4, max_sec: 15, resolutions: ["480p", "720p"] },
      { id: "seedance-2.5", label: "Seedance 2.5", min_sec: 4, max_sec: 30, resolutions: ["480p", "720p"] },
      { id: "seedance-2.0-real", label: "Seedance 2.0（真人）", min_sec: 4, max_sec: 15, resolutions: ["480p", "720p"] },
      { id: "seedance-2.0-fast-real", label: "Seedance 2.0 Fast（真人）", min_sec: 4, max_sec: 15, resolutions: ["480p", "720p"] },
      { id: "seedance-2.0-mini-real", label: "Seedance 2.0 Mini（真人）", min_sec: 4, max_sec: 15, resolutions: ["480p", "720p"] },
      { id: "seedance-2.5-real", label: "Seedance 2.5（真人）", min_sec: 4, max_sec: 30, resolutions: ["480p", "720p"] },
      { id: MINIMAX_VIDEO_MODEL, label: "MiniMax H3", min_sec: 2, max_sec: 15, resolutions: ["480p", "720p", "768P", "2K"] },
    ],
    image_models: env.imageModel ? [{ id: env.imageModel, label: env.imageModel }] : [],
    skills: [{ id: "koubo", label: "口播", path: "skills/koubo/SKILL.md" }],
    defaults: {
      video_model: env.defaultVideoModel,
      aspect_ratio: "16:9",
      resolution: "720p",
    },
    limits: {
      voice_max_sec: env.voiceMaxSec,
      image_max_mb: env.imageMaxMb,
      audio_max_mb: env.audioMaxMb,
    },
    features: {
      image_gen: env.featureImageGen,
      video_gen: env.featureVideoGen,
    },
    repo_root: REPO_ROOT,
  });
});
