import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { env } from "./env.js";
import { ApiError } from "./errors.js";
import { closeDb, initDb } from "./db.js";
import { ffmpegVersion } from "./services/media.js";
import { healthRouter } from "./routes/health.js";
import { filesRouter } from "./routes/files.js";
import { charactersRouter } from "./routes/characters.js";
import { scenesRouter } from "./routes/scenes.js";
import { voicesRouter } from "./routes/voices.js";
import { assetJobsRouter } from "./routes/assetJobs.js";
import { jobsRouter } from "./routes/jobs.js";
import { settingsRouter } from "./routes/settings.js";
import { initModelSettings } from "./services/modelSettings.js";
import { startWorker, stopWorker } from "./services/worker.js";

export type StartServerOptions = {
  host?: string;
  port?: number;
  webDistDir?: string;
};

export type RunningServer = {
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
};

function createApp(webDistDir?: string) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "4mb" }));

  app.use("/api", healthRouter);
  app.use("/api", settingsRouter);
  app.use("/api", charactersRouter);
  app.use("/api", scenesRouter);
  app.use("/api", voicesRouter);
  app.use("/api", assetJobsRouter);
  app.use("/api", jobsRouter);
  app.use(filesRouter);

  const webRoot = webDistDir ? resolve(webDistDir) : "";
  const indexPath = webRoot ? join(webRoot, "index.html") : "";
  if (webRoot && existsSync(indexPath)) {
    app.use(express.static(webRoot));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api") || req.path.startsWith("/files")) {
        next();
        return;
      }
      res.sendFile(indexPath);
    });
  }

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

  return app;
}

function listen(app: ReturnType<typeof createApp>, host: string, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.once("error", reject);
  });
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections?.();
    setTimeout(() => server.closeAllConnections?.(), 1_000).unref();
  });
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const host = options.host || env.host;
  const requestedPort = options.port ?? env.port;
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.warn(`API_HOST=${host} 建议只绑定 127.0.0.1`);
  }
  const ffmpeg = await ffmpegVersion();
  await initDb();
  await initModelSettings();
  await startWorker();
  const server = await listen(createApp(options.webDistDir), host, requestedPort);
  const port = (server.address() as AddressInfo).port;
  const url = `http://${host}:${port}`;
  console.log(`voiceover api ${url}  ffmpeg=${ffmpeg}  data=${env.dataDir}`);
  let closed = false;
  return {
    host,
    port,
    url,
    async close() {
      if (closed) return;
      closed = true;
      await stopWorker(10_000);
      await closeHttpServer(server);
      await closeDb();
    },
  };
}
