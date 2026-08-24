import multer from "multer";
import { env } from "./env.js";

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(env.imageMaxMb, env.audioMaxMb) * 1024 * 1024, files: 12 },
});
