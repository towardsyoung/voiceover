import { ApiError } from "../errors.js";
import type { VideoProvider } from "./video.js";
import { ArkSeedanceProvider } from "./videoArk.js";
import { MinimaxH3Provider } from "./videoMinimax.js";

const arkProvider = new ArkSeedanceProvider();
const minimaxProvider = new MinimaxH3Provider();
const providers: VideoProvider[] = [arkProvider, minimaxProvider];

export function getVideoProvider(model: string): VideoProvider {
  for (const p of providers) {
    if (p.supports(model)) return p;
  }
  throw new ApiError(400, "validation_failed", `不支持的视频模型：${model}`);
}

export function listVideoProviders(): VideoProvider[] {
  return providers;
}