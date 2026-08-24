import type { Shot } from "../schemas/storyboard.js";

export const OTHER =
  "面部五官清晰稳定不变形；口型与本段台词同步；人物与图1一致；场景与图2一致；人体比例正常；动作连续不跳帧；表情自然有神采、亲切有感染力；不添加第二人；不换装不换发型；无模糊无重影；画面内不得出现任何叠加文字（字幕、花字、角标、水印、Logo、标题卡、进度条、时间戳、平台标识、提示条）；无背景音乐；必须逐字朗读本段台词，不改写不概括不增删。";

const PUNCT = new Set(["。", "！", "？", "；", "\n"]);

export function inferStance(name: string, bio: string): "坐" | "站" {
  const t = `${name} ${bio}`;
  if (/演播室|会议室|访谈桌|播音台/.test(t)) return "坐";
  if (/演讲台|教室讲台|发布会/.test(t)) return "站";
  return "站";
}

export function alnum(s: string): string {
  return [...s].filter((c) => /\p{L}|\p{N}/u.test(c)).join("");
}

export function splitDialogue(text: string, ratio = 0.7): [string, string] {
  const chars = [...text];
  if (chars.length < 8) return [text, ""];
  let cut = Math.max(1, Math.min(chars.length - 1, Math.round(chars.length * ratio)));
  for (let i = cut; i > 0; i--) {
    if (PUNCT.has(chars[i - 1]!)) {
      cut = i;
      break;
    }
  }
  const head = text.slice(0, cut).trim();
  const tail = text.slice(cut).trim();
  if (!tail) return [text, ""];
  return [head, tail];
}

export type PromptCtx = {
  model: string;
  aspect_ratio: string;
  resolution: string;
  stance: string;
  character: string;
  scene: string;
  voice: string;
  img1?: string;
  img2?: string;
  img3?: string;
  aud1?: string;
  /** 第 2 段起是否用上一段尾帧衔接。默认 false，各段独立生成。 */
  linkEndFrame?: boolean;
  /** 用户补充的视频个性化要求，追加到每段视频组提示词。 */
  extra?: string;
};

export function renderKouboPrompt(shot: Shot, ctx: PromptCtx): string {
  const n = shot.index;
  const d = shot.duration_sec;
  const dolly = shot.camera === "固定，后段极轻 Dolly In" && d >= 6;
  const [headDlg, tailDlg] = dolly ? splitDialogue(shot.dialogue) : [shot.dialogue, ""];
  const splitT = dolly && tailDlg ? Math.round(d * 7) / 10 : d;
  const slices: { label: string; cam: string; vtag: string; dlg: string }[] = [
    { label: `[0-${splitT}s]`, cam: "固定", vtag: "台词", dlg: headDlg },
  ];
  if (dolly && tailDlg) {
    slices.push({
      label: `[${splitT}-${d}s]`,
      cam: "极轻 Dolly In",
      vtag: "台词（续",
      dlg: tailDlg,
    });
  }
  const mark = (k?: string) => (k ? `（${k}）` : "");
  const refs = [
    `- 图1 人物多视图${mark(ctx.img1)}：锁定身份、脸、发型、服装、体态`,
    `- 图2 场景多视图${mark(ctx.img2)}：锁定空间、主机位、灯光、家具陈设`,
    `- 音频1 音色参考${mark(ctx.aud1)}：用此音色逐字朗读本段台词，不改词、不唱歌、不配乐`,
  ];
  const link = n >= 2 && ctx.linkEndFrame === true;
  if (link) {
    refs.push(`- 图3 上一段精确尾帧逐像素提取的结构线稿${mark(ctx.img3)}：它与尾帧画幅和分辨率完全相同，每条线的位置都是原画面的坐标约束，只用于锁定机位、透视、构图和空间布局。人物在画面中的中心坐标、头顶与脚底位置、左右边界、头部大小、肩宽、身体占画面比例以及四周留白必须与图3一致；禁止裁切、缩放、推近、拉远、重新居中或改变景别。图3是普通参考图而不是本段首帧，不继承线稿风格、颜色、材质或清晰度；人物写实外观以图1为准，场景写实外观以图2为准`);
  }
  const cont = n === 1 ? "开篇" : link ? "承接上段尾帧" : "独立";
  let lead = `画面：${shot.shot_size}。${shot.visual}。${shot.facing}。姿态${shot.stance}。${shot.action}。与人物多视图同一人，与场景多视图同一空间。`;
  if (link) {
    lead = `严格按图3的坐标结构自然承接上一段动作：${shot.action}。本段起始画面的镜头机位、透视、景别、人物中心点、人物边界、头部大小、肩宽、身体占画面比例和四周留白必须与图3一一对应；身体角度、表情轮廓和手的位置保持连续。不得重新构图、裁切、缩放、推近、拉远或重新居中；不要把图3作为本段首帧，不要生成线稿画面或由线稿转写实的过程。${lead}`;
  }
  const lines = [
    `### 视频组${n}`,
    `模型: ${ctx.model}`,
    `时长: ${shot.duration_sec}s`,
    `画幅: ${ctx.aspect_ratio}`,
    `分辨率: ${ctx.resolution}`,
    `姿态: ${ctx.stance}`,
    "",
    "参考绑定:",
    ...refs,
    "",
    `场景: ${ctx.scene}`,
    `角色: ${ctx.character}`,
    `承接: ${cont}`,
    "",
  ];
  slices.forEach((sl, i) => {
    const voice =
      i === 0
        ? `${sl.vtag}（${shot.emotion}）：${ctx.character}："${sl.dlg}"`
        : `${sl.vtag}，${shot.emotion}）：${ctx.character}："${sl.dlg}"`;
    lines.push(i === 0 ? `运镜+画面：${sl.label}` : sl.label);
    lines.push(`画面：${i === 0 ? lead : shot.visual}`);
    lines.push(`运镜：${sl.cam}`);
    lines.push(`声音：房间轻微底噪。${voice}`);
    lines.push("");
  });
  lines.push(`尾帧: ${shot.end_frame}`, `其他需求：${OTHER}`);
  const extra = ctx.extra?.trim();
  if (extra) lines.push(`用户补充要求：${extra}`);
  return lines.join("\n");
}

export function modelLimits(model: string) {
  if (model === "seedance-2.5" || model === "seedance-2.5-real") return { min: 4, max: 30 };
  if (model === "MiniMax-H3") return { min: 2, max: 15 };
  return { min: 4, max: 15 };
}
