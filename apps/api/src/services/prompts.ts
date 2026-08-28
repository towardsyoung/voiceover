import { readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../env.js";

function extractTextBlock(md: string): string {
  const m = md.match(/```text\n([\s\S]*?)```/);
  return (m?.[1] ?? md).trim();
}

function load(name: string): string {
  return extractTextBlock(readFileSync(join(env.resourceRoot, "prompts", name), "utf8"));
}

export function stylePrefix(): string {
  return load("style-prefix.md");
}

export function characterBoardPrompt(input: {
  name: string;
  bio: string;
  roles: string[];
}): string {
  let body = load("character-board.md")
    .replaceAll("{name}", input.name || "口播人物")
    .replaceAll("{bio}", input.bio || "");
  const have = new Set(input.roles);
  const lines = [
    ["front", "第 1 张=正脸"],
    ["side", "第 2 张=侧面"],
    ["back", "第 3 张=背面"],
    ["mouth", "第 4 张=微张嘴"],
  ];
  const kept = lines.filter(([role]) => have.has(role)).map(([, line]) => line);
  if (kept.length) {
    body = body.replace(
      /第 1 张=正脸，第 2 张=侧面，第 3 张=背面，第 4 张=微张嘴。缺某张则忽略对应句，至少保留一张正脸类参考。/,
      `${kept.join("，")}。缺某张已省略。`,
    );
  }
  return `${stylePrefix()}\n\n${body}`;
}

export function sceneBoardPrompt(input: { name: string; bio: string; userPrompt: string }): string {
  const body = load("scene-board.md")
    .replaceAll("{name}", input.name || "口播场景")
    .replaceAll("{bio}", input.bio || "")
    .replaceAll("{user_prompt}", input.userPrompt || "");
  return `${stylePrefix()}\n\n${body}`;
}
