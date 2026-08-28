import { Router } from "express";
import { ARK_VIDEO_MODELS, getModelSettings, saveModelSettings } from "../services/modelSettings.js";

export const settingsRouter = Router();

settingsRouter.get("/settings/models", (_req, res) => {
  res.json({ settings: getModelSettings(), ark_models: ARK_VIDEO_MODELS });
});

settingsRouter.put("/settings/models", async (req, res, next) => {
  try {
    res.json({ settings: await saveModelSettings(req.body || {}), ark_models: ARK_VIDEO_MODELS });
  } catch (err) {
    next(err);
  }
});
