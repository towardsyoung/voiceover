<script setup lang="ts">
import { DialogPlugin, MessagePlugin } from "tdesign-vue-next";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { EditIcon, PlayCircleIcon, RefreshIcon, StopCircleIcon, SaveIcon } from "tdesign-icons-vue-next";
import {
  type Character,
  type Config,
  type Job,
  type Scene,
  type Shot,
  type Voice,
  cancelJob,
  concatJob,
  generateJob,
  getConfig,
  getJob,
  listCharacters,
  listScenes,
  listVoices,
  queryShot,
  requestStoryboard,
  retryShot,
  saveStoryboard,
  smartColorMatchJob,
  updateJob,
} from "../api/client";
import CastPicker from "../components/CastPicker.vue";
import ProductionSteps from "../components/ProductionSteps.vue";
import ShotEditor from "../components/ShotEditor.vue";
import { statusLabel, statusTone } from "../utils/status";
import { fmtTimecode } from "../utils/time";

const route = useRoute();
const job = ref<Job | null>(null);
const loadError = ref("");
const pending = ref(false);
const saving = ref(false);
const videoGen = ref(false);
const shots = ref<Shot[]>([]);
const savedSnap = ref("");

const config = ref<Config | null>(null);
const characters = ref<Character[]>([]);
const scenes = ref<Scene[]>([]);
const voices = ref<Voice[]>([]);
const editVisible = ref(false);
const afterEditVisible = ref(false);
const editing = ref(false);
const pane = ref<"board" | "film">("board");
const editForm = ref({
  character_id: "",
  scene_id: "",
  voice_id: "",
  video_model: "seedance-2.0",
  aspect_ratio: "16:9",
  resolution: "720p",
  stance: "站" as "坐" | "站",
  link_end_frame: false,
  storyboard_system_prompt: "",
  video_system_prompt: "",
});
const storyboardSystemPrompt = ref("");
const videoSystemPrompt = ref("");
const extrasSnap = ref("");

const INFLIGHT = ["storyboarding", "queued", "generating", "concatenating"];
const CAN_STORYBOARD = ["draft", "storyboard_ready", "needs_retry", "cancelled", "done", "concat_failed"];
const CAN_GENERATE = ["storyboard_ready", "needs_retry", "done", "concat_failed", "cancelled"];
const RETRYABLE_RUN = ["succeeded", "failed", "cancelled"];
const QUERYABLE_JOB = ["needs_retry", "cancelled", "concat_failed"];
const QUERYABLE_RUN = ["failed", "generating", "pending"];
const VIDEO_GEN_HINT = "未开启视频生成。在 .env 设 FEATURE_VIDEO_GEN=1 并填写 ARK_API_KEY";

const id = computed(() => String(route.params.id || ""));

const dirty = computed(() => JSON.stringify(shots.value) !== savedSnap.value && shots.value.length > 0);
const extrasDirty = computed(
  () =>
    JSON.stringify({
      s: storyboardSystemPrompt.value,
      v: videoSystemPrompt.value,
    }) !== extrasSnap.value,
);

const step = computed<1 | 2 | 3>(() => {
  const s = job.value?.status;
  if (!s || s === "draft" || s === "storyboarding" || s === "storyboard_ready") return 2;
  return 3;
});

const rows = computed(() => {
  const board = job.value?.storyboard?.shots || shots.value;
  const runs = job.value?.shots || [];
  const byIndex = new Map(runs.map((r) => [r.shot_index, r]));
  const indexes = board.length ? board.map((s) => s.index) : runs.map((r) => r.shot_index);
  return indexes.map((index) => ({
    index,
    shot: board.find((s) => s.index === index),
    run: byIndex.get(index),
  }));
});

const progress = computed(() => {
  const runs = job.value?.shots || [];
  const done = runs.filter((r) => r.status === "succeeded").length;
  const total = Math.max(runs.length, shots.value.length);
  return { done, total };
});

const totalSec = computed(() => shots.value.reduce((a, s) => a + (Number(s.duration_sec) || 0), 0));

const maxSec = computed(() => {
  const m = config.value?.video_models?.find((x) => x.id === job.value?.video_model);
  return m?.max_sec ?? 15;
});

const modelOptions = computed(() => {
  const list = config.value?.video_models ?? [];
  if (list.length) return list.map((m) => ({ value: m.id, label: `${m.label} · ${m.min_sec}-${m.max_sec}s` }));
  return [
    { value: "seedance-2.0", label: "Seedance 2.0 · 4-15s" },
    { value: "seedance-2.0-fast", label: "Seedance 2.0 Fast · 4-15s" },
    { value: "seedance-2.0-mini", label: "Seedance 2.0 Mini · 4-15s" },
    { value: "seedance-2.5", label: "Seedance 2.5 · 4-30s" },
    { value: "seedance-2.0-real", label: "Seedance 2.0（真人） · 4-15s" },
    { value: "seedance-2.0-fast-real", label: "Seedance 2.0 Fast（真人） · 4-15s" },
    { value: "seedance-2.0-mini-real", label: "Seedance 2.0 Mini（真人） · 4-15s" },
    { value: "seedance-2.5-real", label: "Seedance 2.5（真人） · 4-30s" },
    { value: "MiniMax-H3", label: "MiniMax H3 · 2-15s" },
  ];
});

const resolutionOptions = computed(() => {
  const m = config.value?.video_models?.find((x) => x.id === editForm.value.video_model);
  return m?.resolutions?.length ? m.resolutions : ["720p", "480p"];
});

watch(resolutionOptions, (opts) => {
  if (!opts.includes(editForm.value.resolution)) {
    editForm.value.resolution = opts[0] ?? "720p";
  }
});

const editable = computed(() => job.value && !INFLIGHT.includes(job.value.status));
const boardLocked = computed(() => !job.value || INFLIGHT.includes(job.value.status));
const live = computed(() => !!job.value && INFLIGHT.includes(job.value.status));
const hasBoard = computed(() => (job.value?.storyboard?.shots?.length || shots.value.length) > 0);
const queryableShotIndex = computed(() => {
  const hit = rows.value.find((row) => canQuery(row));
  return hit?.index ?? null;
});

let timer: ReturnType<typeof setInterval> | null = null;
let es: EventSource | null = null;

function applyJob(next: Job) {
  job.value = next;
  if (next.storyboard?.shots) {
    const incoming = structuredClone(next.storyboard.shots);
    const incomingSnap = JSON.stringify(incoming);
    if (!dirty.value || savedSnap.value === "") {
      shots.value = incoming;
      savedSnap.value = incomingSnap;
    }
  }
  if (!extrasDirty.value || extrasSnap.value === "") {
    storyboardSystemPrompt.value = next.storyboard_system_prompt || "";
    videoSystemPrompt.value = next.video_system_prompt || "";
    extrasSnap.value = JSON.stringify({
      s: storyboardSystemPrompt.value,
      v: videoSystemPrompt.value,
    });
  }
}

async function refresh() {
  try {
    const next = await getJob(id.value);
    applyJob(next);
    loadError.value = "";
  } catch (e) {
    loadError.value = (e as Error).message;
  }
}

function startWatch() {
  stopWatch();
  const url = job.value?.events_url || `/api/jobs/${id.value}/events`;
  try {
    es = new EventSource(url);
    es.addEventListener("snapshot", (ev) => {
      try {
        applyJob(JSON.parse((ev as MessageEvent).data) as Job);
      } catch {
        void refresh();
      }
    });
    for (const type of ["shot_done", "shot_failed", "concat_done", "concat_failed", "cancelled", "error", "storyboard_ready"]) {
      es.addEventListener(type, () => {
        void refresh();
      });
    }
    es.onerror = () => {
      /* poll fallback */
    };
  } catch {
    /* EventSource unavailable */
  }
  timer = setInterval(() => {
    if (job.value && INFLIGHT.includes(job.value.status)) void refresh();
  }, 3000);
}

function stopWatch() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (es) {
    es.close();
    es = null;
  }
}

async function act(fn: () => Promise<Job>, warnFeature = false) {
  if (warnFeature && !videoGen.value) {
    MessagePlugin.warning(VIDEO_GEN_HINT);
    return;
  }
  pending.value = true;
  try {
    applyJob(await fn());
  } catch (e) {
    const msg = (e as Error).message || "";
    if (msg.includes("FEATURE_VIDEO_GEN")) MessagePlugin.warning(VIDEO_GEN_HINT);
    else MessagePlugin.error(msg);
  } finally {
    pending.value = false;
  }
}

function onCancel() {
  void act(() => cancelJob(id.value));
}

async function persistExtras(): Promise<boolean> {
  if (!job.value || !extrasDirty.value) return true;
  try {
    const next = await updateJob(id.value, {
      storyboard_system_prompt: storyboardSystemPrompt.value,
      video_system_prompt: videoSystemPrompt.value,
    });
    extrasSnap.value = JSON.stringify({
      s: storyboardSystemPrompt.value,
      v: videoSystemPrompt.value,
    });
    applyJob(next);
    return true;
  } catch (e) {
    MessagePlugin.error((e as Error).message);
    return false;
  }
}

async function onGenerate() {
  if (!(await persistExtras())) return;
  if (dirty.value) {
    const ok = await save();
    if (!ok) return;
  }
  pane.value = "film";
  void act(() => generateJob(id.value), true);
}

function onConcat() {
  void act(() => concatJob(id.value));
}

async function onSmartColorMatch() {
  pending.value = true;
  try {
    applyJob(await smartColorMatchJob(id.value));
    MessagePlugin.success("已开始智能调色，完成后会自动更新成片");
  } catch (e) {
    MessagePlugin.error((e as Error).message);
  } finally {
    pending.value = false;
  }
}

async function runStoryboard() {
  pending.value = true;
  try {
    if (!(await persistExtras())) return;
    await requestStoryboard(id.value);
    await refresh();
    pane.value = "board";
  } catch (e) {
    MessagePlugin.error((e as Error).message);
  } finally {
    pending.value = false;
  }
}

function onStoryboard() {
  const hasVideos = (job.value?.shots || []).some((s) => s.status === "succeeded" || s.status === "failed");
  if (hasVideos) {
    const dlg = DialogPlugin.confirm({
      header: "重新生成分镜",
      body: "会覆盖当前分镜，已生成的视频段也会清掉。确定继续？",
      confirmBtn: { content: "重新生成", theme: "danger" },
      cancelBtn: "取消",
      onConfirm: () => {
        dlg.hide();
        void runStoryboard();
      },
    });
    return;
  }
  void runStoryboard();
}

async function save(): Promise<boolean> {
  if (!job.value || !shots.value.length) return false;
  saving.value = true;
  try {
    if (!(await persistExtras())) return false;
    const next = await saveStoryboard(job.value.id, shots.value);
    applyJob(next);
    if (next.storyboard?.shots) {
      shots.value = structuredClone(next.storyboard.shots);
      savedSnap.value = JSON.stringify(shots.value);
    }
    MessagePlugin.success("分镜和完整提示词已保存");
    return true;
  } catch (e) {
    MessagePlugin.error((e as Error).message);
    return false;
  } finally {
    saving.value = false;
  }
}

function canQuery(row: { run?: { status?: string; provider_request_id?: string | null } | null }) {
  return (
    !!job.value &&
    QUERYABLE_JOB.includes(job.value.status) &&
    QUERYABLE_RUN.includes(row.run?.status || "") &&
    !!row.run?.provider_request_id
  );
}

function onQuery(index: number) {
  void (async () => {
    pending.value = true;
    try {
      const next = await queryShot(id.value, index);
      applyJob(next);
      const run = next.shots?.find((s) => s.shot_index === index);
      if (run?.status === "succeeded") {
        pane.value = "film";
        MessagePlugin.success(next.status === "concatenating" ? "本段已取回，正在拼接成片" : "本段已从云端取回");
      } else if (run?.error?.includes("仍在生成")) {
        MessagePlugin.info(run.error);
      } else {
        MessagePlugin.warning(run?.error || "云端尚未成功");
      }
    } catch (e) {
      MessagePlugin.error((e as Error).message);
    } finally {
      pending.value = false;
    }
  })();
}

function onRetry(index: number) {
  const dlg = DialogPlugin.confirm({
    header: "重做本段",
    body: `只重做第 ${index} 段，其他段不受影响。确定继续？`,
    theme: "warning",
    confirmBtn: { content: "重做", theme: "danger" },
    cancelBtn: "取消",
    onConfirm: () => {
      dlg.hide();
      void (async () => {
        if (!(await persistExtras())) return;
        await act(() => retryShot(id.value, index), true);
      })();
    },
  });
}

function openEdit() {
  if (!job.value) return;
  editForm.value = {
    character_id: job.value.assets.character?.id ?? "",
    scene_id: job.value.assets.scene?.id ?? "",
    voice_id: job.value.assets.voice?.id ?? "",
    video_model: job.value.video_model,
    aspect_ratio: job.value.aspect_ratio,
    resolution: job.value.resolution,
    stance: job.value.stance === "坐" ? "坐" : "站",
    link_end_frame: Boolean(job.value.link_end_frame),
    storyboard_system_prompt: storyboardSystemPrompt.value,
    video_system_prompt: videoSystemPrompt.value,
  };
  editVisible.value = true;
}

async function submitEdit() {
  if (!editForm.value.video_model) {
    MessagePlugin.warning("请选择视频模型");
    return;
  }
  editing.value = true;
  try {
    const body: Record<string, unknown> = {
      video_model: editForm.value.video_model,
      aspect_ratio: editForm.value.aspect_ratio,
      resolution: editForm.value.resolution,
      stance: editForm.value.stance,
      link_end_frame: editForm.value.link_end_frame,
      storyboard_system_prompt: editForm.value.storyboard_system_prompt,
      video_system_prompt: editForm.value.video_system_prompt,
    };
    if (editForm.value.character_id) body.character_id = editForm.value.character_id;
    if (editForm.value.scene_id) body.scene_id = editForm.value.scene_id;
    if (editForm.value.voice_id) body.voice_id = editForm.value.voice_id;
    await updateJob(id.value, body);
    storyboardSystemPrompt.value = editForm.value.storyboard_system_prompt;
    videoSystemPrompt.value = editForm.value.video_system_prompt;
    extrasSnap.value = JSON.stringify({
      s: storyboardSystemPrompt.value,
      v: videoSystemPrompt.value,
    });
    editVisible.value = false;
    await refresh();
    if (hasBoard.value) afterEditVisible.value = true;
    else MessagePlugin.success("配置已更新");
  } catch (e) {
    MessagePlugin.error((e as Error).message);
  } finally {
    editing.value = false;
  }
}

function afterEditRegen() {
  afterEditVisible.value = false;
  void runStoryboard();
}

function afterEditContinue() {
  afterEditVisible.value = false;
  if (job.value && CAN_GENERATE.includes(job.value.status)) void onGenerate();
  else MessagePlugin.warning("当前还没有可用分镜，请先生成分镜");
}

onMounted(async () => {
  config.value = await getConfig();
  videoGen.value = config.value.features.video_gen;
  [characters.value, scenes.value, voices.value] = await Promise.all([
    listCharacters(),
    listScenes(),
    listVoices(),
  ]);
  await refresh();
  if (job.value && !["draft", "storyboarding", "storyboard_ready"].includes(job.value.status)) {
    pane.value = "film";
  }
  startWatch();
});

onUnmounted(stopWatch);
</script>

<template>
  <div class="page page--wide detail">
    <p class="back"><router-link to="/jobs">任务列表</router-link></p>
    <p v-if="loadError" class="err">{{ loadError }}</p>
    <template v-else-if="job">
      <ProductionSteps :current="step" />

      <header class="head">
        <div>
          <strong class="job-name">{{ job.title || job.id }}</strong>
          <p class="sub-line">
            <span v-if="live" class="tally" title="进行中" />
            <span class="status-badge" :class="`status-badge--${statusTone(job.status)}`">{{ statusLabel(job.status) }}</span>
            <span v-if="job.shots?.length" class="hint">{{ progress.done }}/{{ progress.total }} 段</span>
            <span v-if="shots.length" class="hint mono">{{ fmtTimecode(totalSec) }}</span>
            <span v-if="job.error" class="err">{{ job.error }}</span>
          </p>
        </div>
        <div class="toolbar">
          <t-button v-if="editable" variant="outline" @click="openEdit">
            <template #icon><EditIcon /></template>
            改配置
          </t-button>
          <t-button
            v-if="editable && CAN_STORYBOARD.includes(job.status)"
            variant="outline"
            :loading="pending"
            @click="onStoryboard"
          >
            <template #icon><PlayCircleIcon /></template>
            {{ hasBoard ? "重新生成分镜" : "生成分镜" }}
          </t-button>
          <t-button
            v-if="INFLIGHT.includes(job.status)"
            theme="danger"
            variant="outline"
            :loading="pending"
            @click="onCancel"
          >
            <template #icon><StopCircleIcon /></template>
            取消
          </t-button>
          <t-button
            v-if="queryableShotIndex != null"
            variant="outline"
            :loading="pending"
            @click="onQuery(queryableShotIndex)"
          >
            <template #icon><RefreshIcon /></template>
            查询状态
          </t-button>
          <t-button
            v-if="job.status === 'needs_retry' || job.status === 'cancelled'"
            theme="primary"
            :loading="pending"
            @click="onGenerate"
          >
            <template #icon><PlayCircleIcon /></template>
            继续制作视频
          </t-button>
          <t-button
            v-if="job.status === 'done' || job.status === 'concat_failed'"
            theme="primary"
            variant="outline"
            :loading="pending"
            @click="onConcat"
          >
            <template #icon><RefreshIcon /></template>
            重新拼接
          </t-button>
        </div>
      </header>

      <div class="cast-strip">
        <div class="chip">
          <img v-if="job.assets.character?.board_url" :src="job.assets.character.board_url" alt="" />
          <span>人物 {{ job.assets.character?.name || "—" }}</span>
        </div>
        <div class="chip">
          <img v-if="job.assets.scene?.board_url" :src="job.assets.scene.board_url" alt="" />
          <span>场景 {{ job.assets.scene?.name || "—" }}</span>
        </div>
        <div class="chip">
          <span>音色 {{ job.assets.voice?.name || "—" }}</span>
        </div>
        <div class="chip spec">{{ job.video_model }} · {{ job.aspect_ratio }} · {{ job.resolution }}</div>
        <div class="chip spec">口播姿势 {{ job.stance || "—" }}</div>
        <div class="chip spec">{{ job.link_end_frame ? "首尾帧衔接" : "分段独立" }}</div>
      </div>

      <div class="panes" role="tablist">
        <button type="button" class="pane-btn" :class="{ on: pane === 'board' }" role="tab" @click="pane = 'board'">
          分镜
        </button>
        <button type="button" class="pane-btn" :class="{ on: pane === 'film' }" role="tab" @click="pane = 'film'">
          成片
        </button>
      </div>

      <section v-if="pane === 'board'">
        <div v-if="job.status === 'storyboarding'" class="wait">
          <span class="tally" />
          <div>
            <div class="wait-title">正在按口播稿切段</div>
            <p class="hint">台词保持原文，按时长上限切开。好了就能改景别和动作。</p>
          </div>
        </div>
        <div v-else-if="job.status === 'draft' && job.error" class="wait fail">
          <div>
            <div class="wait-title">分镜没切成</div>
            <p class="err">{{ job.error }}</p>
            <t-button theme="primary" :loading="pending" @click="onStoryboard">再试一次</t-button>
          </div>
        </div>
        <div v-else-if="!shots.length" class="empty">
          <div class="empty-title">还没有分镜</div>
          <div class="empty-desc">生成分镜后，在这里改台词、时长和画面</div>
          <div class="prompt-box empty-prompts">
            <div class="prompt-col">
              <label>分镜系统提示词（可选）</label>
              <t-textarea
                v-model="storyboardSystemPrompt"
                placeholder="生成分镜时追加给大模型。例如：多留手势和停顿；语气更轻松。"
                :disabled="boardLocked"
                :autosize="{ minRows: 3, maxRows: 8 }"
              />
            </div>
            <div class="prompt-col">
              <label>视频系统提示词（可选）</label>
              <t-textarea
                v-model="videoSystemPrompt"
                placeholder="出片时追加进每段视频组。例如：始终看镜头；双手不要离开桌面。"
                :disabled="boardLocked"
                :autosize="{ minRows: 3, maxRows: 8 }"
              />
            </div>
          </div>
          <t-button theme="primary" :loading="pending" @click="onStoryboard">生成分镜</t-button>
        </div>
        <template v-else>
          <details class="script-fold">
            <summary>口播稿全文</summary>
            <div class="script-body">{{ job.script }}</div>
          </details>
          <div class="prompt-box">
            <div class="prompt-col">
              <label>分镜系统提示词（可选）</label>
              <t-textarea
                v-model="storyboardSystemPrompt"
                placeholder="重切分镜时追加给大模型。例如：多留手势和停顿；语气更轻松。"
                :disabled="boardLocked"
                :autosize="{ minRows: 3, maxRows: 8 }"
              />
            </div>
            <div class="prompt-col">
              <label>视频系统提示词（可选）</label>
              <t-textarea
                v-model="videoSystemPrompt"
                placeholder="出片时追加进每段视频组。例如：始终看镜头；双手不要离开桌面。"
                :disabled="boardLocked"
                :autosize="{ minRows: 3, maxRows: 8 }"
              />
            </div>
          </div>
          <ShotEditor v-model="shots" :readonly="boardLocked" :max-sec="maxSec" />
          <div class="dock">
            <span v-if="dirty || extrasDirty" class="hint">有未保存的修改</span>
            <t-button v-if="!boardLocked" variant="outline" :loading="saving" :disabled="!dirty && !extrasDirty" @click="save">
              <template #icon><SaveIcon /></template>
              保存分镜
            </t-button>
            <t-button
              v-if="job.status === 'storyboard_ready' || job.status === 'needs_retry' || job.status === 'cancelled'"
              theme="primary"
              :loading="pending"
              @click="onGenerate"
            >
              {{ job.status === "storyboard_ready" ? "开始出片" : "继续制作视频" }}
            </t-button>
          </div>
        </template>
      </section>

      <section v-else>
        <div v-if="job.final_video_url" class="final panel">
          <div class="final-head">
            <div>
              <div class="panel-title">{{ job.color_match_applied ? "色彩统一版" : "成片" }}</div>
              <p v-if="job.color_match_applied" class="hint">已以第 1 段为基准，为后续分段匹配亮度、白平衡和饱和度。</p>
              <p v-else-if="rows.length > 1" class="hint">片段存在明显色差时，可使用智能调色重新合成。</p>
            </div>
            <div class="final-actions">
              <t-button
                v-if="rows.length > 1 && job.status === 'done'"
                theme="primary"
                variant="outline"
                size="small"
                :loading="pending"
                @click="onSmartColorMatch"
              >
                <template #icon><RefreshIcon /></template>
                智能调色
              </t-button>
              <a
                v-if="job.original_video_url && job.color_match_applied"
                class="original-link"
                :href="job.original_video_url"
                target="_blank"
                rel="noopener"
              >
                查看原始拼接版
              </a>
            </div>
          </div>
          <video controls :src="job.final_video_url" />
        </div>
        <div v-if="!rows.length" class="empty">
          <div class="empty-title">还没有成片</div>
          <div class="empty-desc">先确认分镜，再逐段生成</div>
          <t-button
            v-if="job.status === 'storyboard_ready' || job.status === 'needs_retry' || job.status === 'cancelled'"
            theme="primary"
            :loading="pending"
            @click="onGenerate"
          >
            {{ job.status === "storyboard_ready" ? "开始出片" : "继续制作视频" }}
          </t-button>
        </div>
        <div v-else class="shots">
          <article v-for="row in rows" :key="row.index" class="shot" :class="{ live: row.run?.status === 'generating' }">
            <div class="shot-head">
              <span v-if="row.run?.status === 'generating'" class="tally" />
              <strong class="shot-num">第 {{ row.index }} 段</strong>
              <span class="status-badge" :class="`status-badge--${statusTone(row.run?.status)}`">
                {{ statusLabel(row.run?.status) }}
              </span>
              <span v-if="row.shot" class="hint mono">{{ row.shot.duration_sec }}s</span>
              <span v-if="row.run?.error" class="err shot-err">{{ row.run.error }}</span>
              <span v-if="canQuery(row)" class="hint">云端可能已完成，可先查询状态</span>
              <span class="shot-spacer" />
              <t-button
                v-if="canQuery(row)"
                size="small"
                variant="outline"
                :loading="pending"
                @click="onQuery(row.index)"
              >
                查询状态
              </t-button>
              <t-button
                v-if="RETRYABLE_RUN.includes(row.run?.status || '') && ['needs_retry', 'done', 'concat_failed', 'cancelled'].includes(job.status)"
                size="small"
                variant="outline"
                theme="danger"
                :loading="pending"
                @click="onRetry(row.index)"
              >
                重做本段
              </t-button>
            </div>
            <p v-if="row.shot?.dialogue" class="dialogue">{{ row.shot.dialogue }}</p>
            <div class="media">
              <video v-if="row.run?.video_url" controls :src="row.run.video_url" />
              <figure v-if="row.run?.end_frame_url">
                <img :src="row.run.end_frame_url" alt="尾帧" />
                <figcaption>尾帧</figcaption>
              </figure>
            </div>
          </article>
        </div>
      </section>
    </template>

    <t-dialog
      v-model:visible="editVisible"
      header="改配置"
      width="720px"
      confirm-btn="保存"
      cancel-btn="取消"
      :confirm-loading="editing"
      @confirm="submitEdit"
    >
      <CastPicker
        :characters="characters"
        :scenes="scenes"
        :voices="voices"
        :character-id="editForm.character_id"
        :scene-id="editForm.scene_id"
        :voice-id="editForm.voice_id"
        @update:character-id="editForm.character_id = $event"
        @update:scene-id="editForm.scene_id = $event"
        @update:voice-id="editForm.voice_id = $event"
      />
      <t-form label-align="top" class="edit-form">
        <t-form-item label="视频模型">
          <t-select v-model="editForm.video_model">
            <t-option v-for="m in modelOptions" :key="m.value" :value="m.value" :label="m.label" />
          </t-select>
        </t-form-item>
        <t-form-item label="画幅">
          <t-select v-model="editForm.aspect_ratio">
            <t-option value="16:9" label="16:9 横屏" />
            <t-option value="9:16" label="9:16 竖屏" />
          </t-select>
        </t-form-item>
        <t-form-item label="分辨率">
          <t-select v-model="editForm.resolution">
            <t-option v-for="r in resolutionOptions" :key="r" :value="r" :label="r" />
          </t-select>
        </t-form-item>
        <t-form-item label="口播姿势">
          <t-radio-group v-model="editForm.stance" variant="default-filled">
            <t-radio-button value="坐">坐</t-radio-button>
            <t-radio-button value="站">站</t-radio-button>
          </t-radio-group>
        </t-form-item>
        <t-form-item label="衔接">
          <t-checkbox v-model="editForm.link_end_frame">用上一段尾帧衔接后段</t-checkbox>
          <p class="hint">勾选后第 2 段起吃上一段尾帧。关掉则各段独立生成，后段画质更稳。</p>
        </t-form-item>
        <t-form-item label="分镜系统提示词">
          <t-textarea
            v-model="editForm.storyboard_system_prompt"
            placeholder="生成分镜时追加给大模型"
            :autosize="{ minRows: 3, maxRows: 8 }"
          />
        </t-form-item>
        <t-form-item label="视频系统提示词">
          <t-textarea
            v-model="editForm.video_system_prompt"
            placeholder="出片时追加进每段视频组"
            :autosize="{ minRows: 3, maxRows: 8 }"
          />
        </t-form-item>
      </t-form>
    </t-dialog>

    <t-dialog v-model:visible="afterEditVisible" header="配置已更新" width="480px" :footer="false">
      <p class="hint">现有分镜仍可使用。可以重新生成分镜，或用当前分镜继续制作视频。</p>
      <div class="after-edit-actions">
        <t-button variant="outline" @click="afterEditVisible = false">稍后再说</t-button>
        <t-button variant="outline" :loading="pending" @click="afterEditRegen">重新生成分镜</t-button>
        <t-button theme="primary" :loading="pending" @click="afterEditContinue">继续制作视频</t-button>
      </div>
    </t-dialog>

  </div>
</template>

<style scoped>
.back {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--muted);
}
.back a::before {
  content: "← ";
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.job-name {
  display: block;
  max-width: 720px;
  overflow: hidden;
  color: var(--tungsten);
  font-size: 15px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub-line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 4px 0 0;
}
.toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.cast-strip {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0 0 20px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
  background: var(--chrome);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 3px 12px 3px 4px;
}
.chip img {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
}
.chip.spec {
  padding: 6px 12px;
}
.panes {
  display: flex;
  gap: 4px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--line);
}
.pane-btn {
  background: none;
  border: 0;
  color: var(--muted);
  padding: 8px 14px 10px;
  cursor: pointer;
  font-size: 14px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.pane-btn.on {
  color: var(--tungsten);
  border-bottom-color: var(--cue);
}
.wait {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 28px 20px;
  border: 1px dashed var(--line);
  border-radius: var(--radius);
}
.wait-title {
  font-family: var(--display);
  font-size: 18px;
  margin-bottom: 4px;
}
.prompt-box {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin: 0 0 16px;
}
.prompt-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
}
.prompt-col label {
  font-size: 12px;
  color: var(--muted);
}
.empty-prompts {
  width: min(100%, 920px);
  margin: 16px auto;
}
@media (max-width: 800px) {
  .prompt-box {
    grid-template-columns: 1fr;
  }
}
.script-fold {
  margin-bottom: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--chrome);
  padding: 8px 14px;
}
.script-fold summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 13px;
}
.script-body {
  margin-top: 8px;
  white-space: pre-wrap;
  font-family: var(--display);
  line-height: 1.75;
  color: var(--tungsten);
}
.dock {
  position: sticky;
  bottom: 16px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding: 10px 14px;
  background: var(--desk);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow);
}
.final video {
  display: block;
  width: auto;
  height: auto;
  max-height: min(60vh, 560px);
  max-width: 720px;
  margin: 0 auto;
  background: #000;
}
.final {
  width: min(100%, 760px);
}
.final-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}
.final-head .hint {
  margin: 4px 0 0;
  font-size: 12px;
}
.final-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 0 auto;
}
.original-link {
  flex: 0 0 auto;
  color: var(--cue-2);
  border: 1px solid var(--cue-line);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
}
@media (max-width: 640px) {
  .final-head {
    flex-direction: column;
  }
  .final-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}
.shots {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.shot {
  border: 1px solid var(--line);
  background: var(--chrome);
  padding: 16px;
  border-radius: var(--radius);
}
.shot.live {
  border-color: var(--tally);
}
.shot-head {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.shot-num {
  font-family: var(--display);
  font-size: 16px;
}
.shot-spacer {
  flex: 1;
}
.shot-err {
  font-size: 12px;
}
.dialogue {
  margin: 10px 0 0;
  padding: 10px 12px;
  background: var(--paper);
  color: var(--paper-ink);
  border-radius: 6px;
  font-family: var(--display);
  line-height: 1.7;
}
.media {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.media video {
  width: auto;
  height: auto;
  max-height: min(55vh, 520px);
  max-width: 520px;
  background: #000;
}
@media (max-width: 760px) {
  .final video,
  .media video {
    max-width: 100%;
  }
}
.media figure {
  margin: 0;
}
.media img {
  max-width: 180px;
  max-height: 120px;
  object-fit: cover;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.media figcaption {
  font-size: 11px;
  color: var(--muted-2);
  margin-top: 4px;
}
.edit-form {
  margin-top: 16px;
}
.after-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
</style>
