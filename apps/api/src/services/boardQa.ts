import { sniffImage } from "./media.js";

export function qaBoardPng(buf: Buffer): { ok: true } | { ok: false; reason: string } {
  if (!buf || buf.length < 512) return { ok: false, reason: "板图为空或过小" };
  if (!sniffImage(buf)) return { ok: false, reason: "不是有效图片（PNG/JPG/WebP）" };
  return { ok: true };
}
