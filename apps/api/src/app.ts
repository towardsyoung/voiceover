import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { env } from "./env.js";
import { ApiError } from "./errors.js";
import { initDb } from "./db.js";
import { ffmpegVersion } from "./services/media.js";
import { healthRouter } from "./routes/health.js";
import { filesRouter } from "./routes/files.js";
import { charactersRouter } from "./routes/characters.js";
import { scenesRouter } from "./routes/scenes.js";
import { voicesRouter } from "./routes/voices.js";
import { assetJobsRouter } from "./routes/assetJobs.js";
import { jobsRouter } from "./routes/jobs.js";
import { startWorker } from "./services/worker.js";

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: true }));
app.use(express.json({ limit: "4mb" }));

app.use("/api", healthRouter);
app.use("/api", charactersRouter);
app.use("/api", scenesRouter);
app.use("/api", voicesRouter);
app.use("/api", assetJobsRouter);
app.use("/api", jobsRouter);
app.use(filesRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "接口不存在" } });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  const anyErr = err as { status?: number; code?: string; message?: string };
  if (anyErr?.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({ error: { code: "validation_failed", message: "文件过大" } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "internal", message: anyErr?.message || "服务器错误" } });
});

async function main() {
  if (env.host !== "127.0.0.1" && env.host !== "localhost") {
    console.warn(`API_HOST=${env.host} 一期建议只绑 127.0.0.1`);
  }
  const ffmpeg = await ffmpegVersion();
  await initDb();
  startWorker();
  const server = app.listen(env.port, env.host, () => {
    console.log(`voiceover api http://${env.host}:${env.port}  ffmpeg=${ffmpeg}  data=${env.dataDir}`);
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(`listen ${env.host}:${env.port} failed:`, err.code || err.message);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
