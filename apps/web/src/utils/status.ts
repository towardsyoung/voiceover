// 统一的任务/分段状态文案与色调（与后端状态机保持一致）
export const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  storyboarding: "分镜中",
  storyboard_ready: "分镜就绪",
  queued: "排队中",
  generating: "生成中",
  needs_retry: "待重试",
  concatenating: "拼接中",
  concat_failed: "拼接失败",
  done: "已完成",
  cancelled: "已取消",
  pending: "待生成",
  succeeded: "成功",
  failed: "失败",
};

// tone 对应全局样式里的 .status-badge--{tone}
export const STATUS_TONE: Record<string, string> = {
  draft: "neutral",
  storyboarding: "info",
  storyboard_ready: "success",
  queued: "neutral",
  generating: "info",
  needs_retry: "danger",
  concatenating: "info",
  concat_failed: "danger",
  done: "success",
  cancelled: "neutral",
  pending: "neutral",
  succeeded: "success",
  failed: "danger",
};

export function statusLabel(status: string | undefined | null): string {
  if (!status) return "未开始";
  return STATUS_LABEL[status] || status;
}

export function statusTone(status: string | undefined | null): string {
  if (!status) return "neutral";
  return STATUS_TONE[status] || "neutral";
}

export function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}
