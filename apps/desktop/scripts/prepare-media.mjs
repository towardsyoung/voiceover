import { chmodSync } from "node:fs";
import { createRequire } from "node:module";

if (process.platform !== "win32") {
  const require = createRequire(import.meta.url);
  const ffmpeg = require("@ffmpeg-installer/ffmpeg").path;
  const ffprobe = require("@ffprobe-installer/ffprobe").path;
  chmodSync(ffmpeg, 0o755);
  chmodSync(ffprobe, 0o755);
  console.log(`prepared ffmpeg: ${ffmpeg}`);
  console.log(`prepared ffprobe: ${ffprobe}`);
}
