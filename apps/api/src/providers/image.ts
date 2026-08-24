export type ImageGenRequest = {
  kind: "character_board" | "scene_board" | "continuity_sketch";
  prompt: string;
  refs: string[];
  size?: string;
  quality?: "medium" | "high";
};

export type ImageGenResult = {
  bytes: Buffer;
  provider: string;
  model: string;
  revisedPrompt?: string;
};

export interface ImageProvider {
  generate(req: ImageGenRequest): Promise<ImageGenResult>;
}
