import { appendFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, Menu, session, shell } from "electron";
import type { RunningServer } from "@voiceover/api/server";

const PRODUCT_NAME = "小阳哥数字人口播工作台";
const APP_DATA_NAME = "xiaoyang-voiceover";
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let mainWindow: BrowserWindow | null = null;
let server: RunningServer | null = null;
let isWorkerBusy: (() => boolean) | null = null;
let quitting = false;
let shutdownStarted = false;

app.setName(PRODUCT_NAME);
app.setPath("userData", join(app.getPath("appData"), APP_DATA_NAME));

function installLogging(): void {
  const logDir = join(app.getPath("userData"), "logs");
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, "main.log");
  const originalLog = console.log.bind(console);
  const originalError = console.error.bind(console);
  const write = (level: string, args: unknown[]) => {
    const text = args.map((value) => value instanceof Error ? value.stack || value.message : String(value)).join(" ");
    appendFileSync(logFile, `${new Date().toISOString()} ${level} ${text}\n`);
  };
  console.log = (...args: unknown[]) => {
    originalLog(...args);
    write("INFO", args);
  };
  console.error = (...args: unknown[]) => {
    originalError(...args);
    write("ERROR", args);
  };
}

function configureRuntimePaths(): { webDistDir: string } {
  const root = resolve(here, "../../..");
  const resources = app.isPackaged ? process.resourcesPath : root;
  const unpacked = (path: string) => app.isPackaged ? path.replace("app.asar", "app.asar.unpacked") : path;
  const ffmpegPath = unpacked(String((require("@ffmpeg-installer/ffmpeg") as { path: string }).path));
  const ffprobePath = unpacked(String((require("@ffprobe-installer/ffprobe") as { path: string }).path));
  const userData = app.getPath("userData");
  process.env.ELECTRON_USER_DATA = userData;
  process.env.VOICEOVER_DATA_DIR = join(userData, "data");
  process.env.VOICEOVER_RESOURCE_DIR = app.isPackaged
    ? join(resources, "app-resources")
    : root;
  process.env.FFMPEG_PATH = ffmpegPath;
  process.env.FFPROBE_PATH = ffprobePath;
  return {
    webDistDir: app.isPackaged ? join(resources, "web-dist") : join(root, "apps/web/dist"),
  };
}

function installSecurity(origin: string): void {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = permission === "media" && details.requestingUrl.startsWith(origin);
    callback(allowed);
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
          "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
        ],
      },
    });
  });
}

function createMenu(): void {
  const dataDir = join(app.getPath("userData"), "data");
  const logDir = join(app.getPath("userData"), "logs");
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      label: "帮助",
      submenu: [
        { label: "打开数据目录", click: () => void shell.openPath(dataDir) },
        { label: "打开日志目录", click: () => void shell.openPath(logDir) },
        { type: "separator" },
        { label: `关于${PRODUCT_NAME}`, click: () => void dialog.showMessageBox({
          type: "info",
          title: `关于${PRODUCT_NAME}`,
          message: PRODUCT_NAME,
          detail: `版本 ${app.getVersion()}\n数据仅保存在本机。`,
        }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function requestQuit(): Promise<void> {
  if (shutdownStarted) return;
  if (isWorkerBusy?.()) {
    const options: Electron.MessageBoxOptions = {
      type: "warning",
      title: "任务正在运行",
      message: "当前有生成任务正在运行",
      detail: "关闭后任务会在安全位置暂停，下次启动时自动继续。已经提交到模型平台的任务可能仍会在云端运行。",
      buttons: ["取消", "关闭应用"],
      defaultId: 0,
      cancelId: 0,
    };
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    if (result.response === 0) return;
  }
  shutdownStarted = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  try {
    await server?.close();
  } catch (err) {
    console.error("shutdown", err);
  }
  quitting = true;
  app.quit();
}

function createWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 700,
    show: false,
    title: PRODUCT_NAME,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    void requestQuit();
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(url)) event.preventDefault();
  });
  void win.loadURL(url);
  return win;
}

async function main(): Promise<void> {
  installLogging();
  const { webDistDir } = configureRuntimePaths();
  const [{ startServer }, worker] = await Promise.all([
    import("@voiceover/api/server"),
    import("@voiceover/api/worker"),
  ]);
  isWorkerBusy = worker.isWorkerBusy;
  server = await startServer({ host: "127.0.0.1", port: 0, webDistDir });
  installSecurity(server.url);
  createMenu();
  mainWindow = createWindow(server.url);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    void requestQuit();
  });
  app.whenReady().then(main).catch((err) => {
    console.error("desktop startup", err);
    void dialog.showErrorBox(PRODUCT_NAME, `应用启动失败：${err instanceof Error ? err.message : String(err)}`);
    quitting = true;
    app.quit();
  });
}
