import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "../errors.js";
import type { ImageProvider } from "../providers/image.js";
import { CompatibleImageProvider } from "../providers/imageOpenai.js";
import { sniffImage, type ImageExt } from "./media.js";

const image = new CompatibleImageProvider();
const EXTENSIONS: ImageExt[] = ["png", "jpg", "webp"];

export const CONTINUITY_SKETCH_PROMPT = `把输入图片转换成用于视频动作衔接的黑白结构线稿参考图。

必须严格保持原图的画幅、镜头机位、景别、透视、构图、人物位置和大小、头部角度、身体姿态、手势、四肢轮廓、人与物体的遮挡关系，以及场景中主要物体的边界和空间关系。不得裁切、缩放、旋转或改变任何元素，不得新增或删除人物、物体和背景结构。

只做视觉风格转换：白色底，清晰干净的黑色细线，必要处可用少量浅灰辅助线；保留人物五官、发型、服装边界、手部和场景结构的可辨识轮廓。去除颜色、真实纹理、照片噪点、压缩痕迹、光影渐变和材质细节。不要上色，不要写实渲染，不要阴影块，不要文字、字幕、水印、边框或标注。输出应像忠实描摹原图的专业动画布局线稿，而不是重新设计画面。`;

function existingSketch(dir: string): string | null {
  for (const ext of EXTENSIONS) {
    const path = join(dir, `end-sketch.${ext}`);
    if (existsSync(path)) return path;
  }
  return null;
}

export async function ensureContinuitySketch(
  endFrame: string,
  dir: string,
  aspectRatio: "16:9" | "9:16",
  provider: ImageProvider = image,
): Promise<string> {
  const cached = existingSketch(dir);
  if (cached) return cached;

  const result = await provider.generate({
    kind: "continuity_sketch",
    prompt: CONTINUITY_SKETCH_PROMPT,
    refs: [endFrame],
    size: aspectRatio === "16:9" ? "1536x1024" : "1024x1536",
    quality: "high",
  });
  const ext = sniffImage(result.bytes);
  if (!ext) throw new ApiError(502, "invalid_image", "尾帧线稿模型返回了不支持的图片格式");
  const dest = join(dir, `end-sketch.${ext}`);
  writeFileSync(dest, result.bytes);
  return dest;
}
