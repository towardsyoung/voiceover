export type VideoGenRequest = {
  model: string;
  prompt: string;
  images: string[];
  videos: string[];
  audios: string[];
  durationSec: number;
  aspectRatio: "16:9" | "9:16";
  resolution: string;
  generateAudio: boolean;
  /** 人物资产 ID：真人模型时用于优先复用已审核的火山 assetId */
  characterId?: string;
};

export type VideoPoll =
  | { status: "queued" | "running" }
  | { status: "succeeded"; url: string }
  | { status: "failed"; code: string; message: string }
  /** 查不到终态（网络抖动 / 5xx），不是云端生成失败 */
  | { status: "unavailable"; message: string };

export interface VideoProvider {
  id: string;
  supports(model: string): boolean;
  limits(model: string): { min: number; max: number };
  submit(req: VideoGenRequest): Promise<string>;
  poll(requestId: string): Promise<VideoPoll>;
  download(url: string, dest: string): Promise<void>;
  cancel(requestId: string): Promise<void>;
}