import axios from "axios";

export const api = axios.create({ baseURL: "/api" });

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const msg = err.response?.data?.error?.message || err.message || "请求失败";
    return Promise.reject(new Error(msg));
  },
);

export type Config = {
  video_models: {
    id: string;
    label: string;
    min_sec: number;
    max_sec: number;
    resolutions?: string[];
  }[];
  defaults: { video_model: string; aspect_ratio: string; resolution: string };
  limits: { voice_max_sec: number; image_max_mb: number; audio_max_mb: number };
  features: { image_gen: boolean; video_gen: boolean };
};

export type VolcAssetState = {
  asset_id?: string | null;
  assetId?: string | null;
  status?: string | null;
  reason?: string | null;
  group_id?: string | null;
  groupId?: string | null;
  submitted_at?: string | null;
  submittedAt?: string | null;
  checked_at?: string | null;
  checkedAt?: string | null;
};

export type Character = {
  id: string;
  name: string;
  bio: string;
  default_voice_id: string | null;
  source_kind: string;
  board_url: string | null;
  job_count: number;
  volc_asset?: {
    asset_id: string | null;
    status: string;
    reason: string | null;
    group_id: string | null;
    submitted_at: string | null;
    checked_at: string | null;
  };
};

export type Scene = {
  id: string;
  name: string;
  bio: string;
  source_kind: string;
  gen_prompt?: string | null;
  board_url: string | null;
  job_count: number;
};

export type Voice = {
  id: string;
  name: string;
  bio: string;
  character_id: string | null;
  audio_url: string;
  duration_ms: number;
  job_count: number;
};

export async function getConfig() {
  return (await api.get<Config>("/config")).data;
}

export async function listCharacters() {
  return (await api.get<{ items: Character[] }>("/characters")).data.items;
}
export async function listScenes() {
  return (await api.get<{ items: Scene[] }>("/scenes")).data.items;
}
export async function listVoices() {
  return (await api.get<{ items: Voice[] }>("/voices")).data.items;
}

export async function createCharacter(fd: FormData) {
  return (await api.post<Character>("/characters", fd)).data;
}
export async function createScene(fd: FormData) {
  return (await api.post<Scene>("/scenes", fd)).data;
}
export async function createVoice(fd: FormData) {
  return (await api.post<Voice>("/voices", fd)).data;
}

export async function updateCharacter(id: string, body: Record<string, unknown>) {
  return (await api.patch<Character>(`/characters/${id}`, body)).data;
}
export async function updateScene(id: string, body: Record<string, unknown>) {
  return (await api.patch<Scene>(`/scenes/${id}`, body)).data;
}
export async function updateVoice(id: string, body: Record<string, unknown>) {
  return (await api.patch<Voice>(`/voices/${id}`, body)).data;
}

export async function deleteCharacter(id: string) {
  await api.delete(`/characters/${id}`);
}
export async function deleteScene(id: string) {
  await api.delete(`/scenes/${id}`);
}
export async function deleteVoice(id: string) {
  await api.delete(`/voices/${id}`);
}

export async function remakeCharacter(id: string, fd: FormData) {
  return (await api.post<Character>(`/characters/${id}/remake`, fd)).data;
}
export async function remakeScene(id: string, fd: FormData) {
  return (await api.post<Scene>(`/scenes/${id}/remake`, fd)).data;
}
export async function remakeVoice(id: string, fd: FormData) {
  return (await api.post<Voice>(`/voices/${id}/remake`, fd)).data;
}

export async function generateCharacterBoard(id: string) {
  return (await api.post(`/characters/${id}/generate-board`)).data;
}

// 提交人物板到火山素材库审核（OSS → CreateAsset → 轮询）
export async function submitCharacterVolcAsset(id: string) {
  return (await api.post<VolcAssetState>(`/characters/${id}/volc-asset`)).data;
}
// 刷新人物素材审核状态
export async function refreshCharacterVolcAsset(id: string) {
  return (await api.get<VolcAssetState>(`/characters/${id}/volc-asset`)).data;
}
export async function generateSceneBoard(id: string) {
  return (await api.post(`/scenes/${id}/generate`)).data;
}

export async function getAssetJob(id: string) {
  return (await api.get(`/asset-jobs/${id}`)).data as {
    id: string;
    status: string;
    error: string | null;
    result_url: string | null;
  };
}

export type Shot = {
  index: number;
  dialogue: string;
  duration_sec: number;
  shot_size: string;
  camera: string;
  stance: string;
  facing: string;
  action: string;
  emotion: string;
  visual: string;
  continuity: string;
  end_frame: string;
  prompt: string;
  prompt_override?: boolean;
};

export type ShotRun = {
  id: string;
  job_id: string;
  shot_index: number;
  status: string;
  attempt: number;
  video_path: string | null;
  end_frame_path: string | null;
  error: string | null;
  provider_request_id?: string | null;
  video_url?: string | null;
  end_frame_url?: string | null;
};

export type Job = {
  id: string;
  title: string;
  status: string;
  script: string;
  error: string | null;
  video_model: string;
  aspect_ratio: string;
  resolution: string;
  stance: string | null;
  link_end_frame?: boolean;
  storyboard_system_prompt?: string;
  video_system_prompt?: string;
  cancel_requested?: number;
  assets: {
    character: { id: string; name: string; board_url: string | null } | null;
    scene: { id: string; name: string; board_url: string | null } | null;
    voice: { id: string; name: string; audio_url: string; duration_ms: number } | null;
  };
  storyboard: { shots: Shot[] } | null;
  shots?: ShotRun[];
  final_video_url?: string | null;
  events_url?: string;
  created_at: string;
};

export async function createJob(body: Record<string, unknown>) {
  return (await api.post<Job>("/jobs", body)).data;
}
export async function getJob(id: string) {
  return (await api.get<Job>(`/jobs/${id}`)).data;
}
export async function updateJob(id: string, body: Record<string, unknown>) {
  return (await api.patch<Job>(`/jobs/${id}`, body)).data;
}
export async function listJobs() {
  return (
    await api.get<{
      items: {
        id: string;
        title: string;
        status: string;
        created_at: string;
        character_name_snap?: string | null;
        scene_name_snap?: string | null;
      }[];
    }>("/jobs")
  ).data.items;
}
export async function requestStoryboard(id: string) {
  return (await api.post(`/jobs/${id}/storyboard`)).data as { id: string; status: string };
}
export async function saveStoryboard(id: string, shots: Shot[]) {
  return (await api.put<Job>(`/jobs/${id}/storyboard`, { shots, rerender_prompts: true })).data;
}
export async function generateJob(id: string, body?: { rerun_all?: boolean }) {
  return (await api.post<Job>(`/jobs/${id}/generate`, body || {})).data;
}
export async function retryShot(id: string, index: number, body?: { prompt?: string }) {
  return (await api.post<Job>(`/jobs/${id}/shots/${index}/retry`, body || {})).data;
}
export async function queryShot(id: string, index: number) {
  return (await api.post<Job>(`/jobs/${id}/shots/${index}/query`)).data;
}
export async function concatJob(id: string) {
  return (await api.post<Job>(`/jobs/${id}/concat`)).data;
}
export async function cancelJob(id: string) {
  return (await api.post<Job>(`/jobs/${id}/cancel`)).data;
}

