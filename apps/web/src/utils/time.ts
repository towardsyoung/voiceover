/** Broadcast-style mm:ss for shot ranges. */
export function fmtTimecode(sec: number): string {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** Spoken duration from Chinese script length (~3.5 chars / sec). */
export function estimateSpeakSec(text: string): number {
  const n = text.replace(/\s+/g, "").length;
  if (!n) return 0;
  return n / 3.5;
}
