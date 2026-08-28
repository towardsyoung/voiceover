<script setup lang="ts">
import { MessagePlugin } from "tdesign-vue-next";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { PlayCircleIcon } from "tdesign-icons-vue-next";
import {
  type Character,
  type Config,
  type Scene,
  type Voice,
  createJob,
  getConfig,
  getJob,
  listCharacters,
  listScenes,
  listVoices,
  requestStoryboard,
} from "../api/client";
import CastPicker from "../components/CastPicker.vue";
import ProductionSteps from "../components/ProductionSteps.vue";
import { estimateSpeakSec, fmtTimecode } from "../utils/time";

const router = useRouter();
const route = useRoute();

const config = ref<Config | null>(null);
const title = ref("");
const script = ref("");
const characterId = ref("");
const sceneId = ref("");
const voiceId = ref("");
const model = ref("seedance-2.0");
const aspect = ref("16:9");
const resolution = ref("720p");
const stance = ref<"坐" | "站">("站");
const characters = ref<Character[]>([]);
const scenes = ref<Scene[]>([]);
const voices = ref<Voice[]>([]);
const pending = ref(false);
const remakeFrom = ref<string | null>(null);
const linkEndFrame = ref(false);
const storyboardSystemPrompt = ref("");
const videoSystemPrompt = ref("");

const modelOptions = computed(() => {
  const list = config.value?.video_models ?? [];
  return list.map((m) => ({ value: m.id, label: `${m.label} · ${m.min_sec}-${m.max_sec}s`, max: m.max_sec }));
});

const selectedModel = computed(() => modelOptions.value.find((m) => m.value === model.value));
const maxSec = computed(() => selectedModel.value?.max ?? 15);

const resolutionOptions = computed(() => {
  const m = config.value?.video_models?.find((x) => x.id === model.value);
  return m?.resolutions?.length ? m.resolutions : ["720p", "480p"];
});

watch(resolutionOptions, (opts) => {
  if (!opts.includes(resolution.value)) {
    resolution.value = opts[0] ?? "720p";
  }
});

const charCount = computed(() => script.value.replace(/\s+/g, "").length);
const speakSec = computed(() => estimateSpeakSec(script.value));
const shotGuess = computed(() => {
  if (!speakSec.value) return 0;
  return Math.max(1, Math.ceil(speakSec.value / maxSec.value));
});

const missing = computed(() => {
  const m: string[] = [];
  if (!script.value.trim()) m.push("口播稿");
  if (!characterId.value) m.push("人物");
  if (!sceneId.value) m.push("场景");
  if (!voiceId.value) m.push("音色");
  if (!model.value || !modelOptions.value.some((item) => item.value === model.value)) m.push("视频模型");
  return m;
});
const canCreate = computed(() => missing.value.length === 0 && !pending.value);

const meter = computed(() => {
  if (!charCount.value) return "稿纸是空的";
  return `${charCount.value} 字 · 约 ${fmtTimecode(speakSec.value)} · 按 ${maxSec.value} 秒上限约 ${shotGuess.value} 段`;
});

function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    void makeStoryboard();
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKey);
  config.value = await getConfig();
  model.value = config.value.defaults.video_model;
  aspect.value = config.value.defaults.aspect_ratio;
  resolution.value = config.value.defaults.resolution;
  [characters.value, scenes.value, voices.value] = await Promise.all([
    listCharacters(),
    listScenes(),
    listVoices(),
  ]);
  await applyQuery();
});

onUnmounted(() => window.removeEventListener("keydown", onKey));

watch(
  () => route.query,
  () => {
    void applyQuery();
  },
);

async function applyQuery() {
  const from = route.query.from;
  if (typeof from === "string" && from) {
    await loadRemake(from);
    return;
  }
  if (typeof route.query.character === "string") characterId.value = route.query.character;
  if (typeof route.query.scene === "string") sceneId.value = route.query.scene;
  if (typeof route.query.voice === "string") voiceId.value = route.query.voice;
  if (characterId.value && !voiceId.value) {
    const c = characters.value.find((x) => x.id === characterId.value);
    if (c?.default_voice_id) voiceId.value = c.default_voice_id;
  }
}

async function loadRemake(jobId: string) {
  try {
    const src = await getJob(jobId);
    title.value = src.title || "";
    script.value = src.script || "";
    characterId.value = src.assets.character?.id ?? "";
    sceneId.value = src.assets.scene?.id ?? "";
    voiceId.value = src.assets.voice?.id ?? "";
    if (src.video_model) model.value = src.video_model;
    if (src.aspect_ratio) aspect.value = src.aspect_ratio;
    if (src.resolution) resolution.value = src.resolution;
    if (src.stance === "坐" || src.stance === "站") stance.value = src.stance;
    linkEndFrame.value = Boolean(src.link_end_frame);
    storyboardSystemPrompt.value = src.storyboard_system_prompt || "";
    videoSystemPrompt.value = src.video_system_prompt || "";
    remakeFrom.value = src.title || jobId;
  } catch (e) {
    MessagePlugin.warning("无法载入原任务：" + (e as Error).message);
  }
}

async function makeStoryboard() {
  if (missing.value.length) {
    MessagePlugin.warning(`还缺：${missing.value.join("、")}`);
    return;
  }
  pending.value = true;
  try {
    const created = await createJob({
      title: title.value.trim() || undefined,
      script: script.value,
      character_id: characterId.value,
      scene_id: sceneId.value,
      voice_id: voiceId.value,
      video_model: model.value,
      aspect_ratio: aspect.value,
      resolution: resolution.value,
      stance: stance.value,
      link_end_frame: linkEndFrame.value,
      storyboard_system_prompt: storyboardSystemPrompt.value,
      video_system_prompt: videoSystemPrompt.value,
    });
    await requestStoryboard(created.id);
    MessagePlugin.success("任务已建，正在切分镜");
    await router.push(`/jobs/${created.id}`);
  } catch (e) {
    MessagePlugin.error((e as Error).message);
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="page produce">
    <ProductionSteps :current="1" />

    <div v-if="remakeFrom" class="remake-tip">
      已载入任务「{{ remakeFrom }}」的稿子和配置。生成分镜会开一条新任务，不改原来那条。
    </div>

    <div class="task-name">
      <label for="task-title">任务名称</label>
      <t-input
        id="task-title"
        v-model="title"
        maxlength="50"
        clearable
        placeholder="选填，留空后自动取口播稿开头"
      />
    </div>

    <section class="prompter" aria-label="口播稿">
      <div class="hood">
        <span>口播稿</span>
        <span class="meter mono">{{ meter }}</span>
      </div>
      <t-textarea
        v-model="script"
        placeholder="把要说的话写在这里。按原文切段，模型按音色参考逐字说。"
        :autosize="{ minRows: 4, maxRows: 10 }"
      />
    </section>

    <section class="below">
      <div class="below-head">
        <h2>出镜配置</h2>
        <span v-if="missing.length" class="hint">还缺 {{ missing.join("、") }}</span>
      </div>
      <CastPicker
        :characters="characters"
        :scenes="scenes"
        :voices="voices"
        :character-id="characterId"
        :scene-id="sceneId"
        :voice-id="voiceId"
        @update:character-id="characterId = $event"
        @update:scene-id="sceneId = $event"
        @update:voice-id="voiceId = $event"
      />

      <div class="specs">
        <div class="field">
          <label>视频模型</label>
          <t-select v-model="model">
            <t-option v-for="m in modelOptions" :key="m.value" :value="m.value" :label="m.label" />
          </t-select>
        </div>
        <div class="field">
          <label>画幅</label>
          <t-select v-model="aspect">
            <t-option value="16:9" label="16:9 横屏" />
            <t-option value="9:16" label="9:16 竖屏" />
          </t-select>
        </div>
        <div class="field">
          <label>分辨率</label>
          <t-select v-model="resolution">
            <t-option v-for="r in resolutionOptions" :key="r" :value="r" :label="r" />
          </t-select>
        </div>
        <div class="field stance-field">
          <label>口播姿势</label>
          <t-radio-group v-model="stance" variant="default-filled">
            <t-radio-button value="坐">坐</t-radio-button>
            <t-radio-button value="站">站</t-radio-button>
          </t-radio-group>
        </div>
        <div class="cta">
          <t-button theme="primary" size="large" :loading="pending" :disabled="!canCreate" @click="makeStoryboard">
            <template #icon><PlayCircleIcon /></template>
            生成分镜
          </t-button>
        </div>
      </div>
      <div class="link-opt">
        <t-checkbox v-model="linkEndFrame">用上一段尾帧衔接后段</t-checkbox>
        <span class="hint">勾选后第 2 段起会吃上一段尾帧，画面更连贯，但后段画质可能下降。默认不勾选，各段独立生成。</span>
      </div>
      <div class="prompt-box">
        <div class="prompt-col">
          <label>分镜系统提示词（可选）</label>
          <t-textarea
            v-model="storyboardSystemPrompt"
            placeholder="生成分镜时追加给大模型。例如：多留手势和停顿；语气更轻松；不要大特写。"
            :autosize="{ minRows: 3, maxRows: 8 }"
          />
        </div>
        <div class="prompt-col">
          <label>视频系统提示词（可选）</label>
          <t-textarea
            v-model="videoSystemPrompt"
            placeholder="每段出片时追加进视频组。例如：始终看镜头；双手不要离开桌面；不要晃头。"
            :autosize="{ minRows: 3, maxRows: 8 }"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.remake-tip {
  margin: 0 0 16px;
  padding: 10px 14px;
  border: 1px solid var(--cue-line);
  background: var(--cue-soft);
  color: var(--cue-2);
  border-radius: 8px;
  font-size: 13px;
}
.task-name {
  display: grid;
  grid-template-columns: auto minmax(0, 360px);
  align-items: center;
  justify-content: start;
  gap: 12px;
  margin-bottom: 12px;
}
.task-name label {
  color: var(--muted);
  font-size: 12px;
}
.prompter {
  background: var(--paper);
  color: var(--paper-ink);
  border-radius: 0 0 10px 10px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.hood {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  background: var(--hood);
  color: var(--paper);
  padding: 8px 16px;
  font-size: 12px;
  letter-spacing: 0.06em;
}
.meter {
  color: rgba(237, 230, 210, 0.72);
  font-size: 11px;
  letter-spacing: 0;
}
.prompter :deep(.t-textarea) {
  border: 0;
}
.prompter :deep(.t-textarea__inner) {
  background: transparent !important;
  color: var(--paper-ink) !important;
  border: 0 !important;
  box-shadow: none !important;
  font-family: var(--display) !important;
  font-size: 17px !important;
  line-height: 1.7 !important;
  padding: 14px 18px 16px !important;
  border-radius: 0 !important;
}
.prompter :deep(.t-textarea__inner::placeholder) {
  color: var(--paper-muted) !important;
}
.below {
  margin-top: 20px;
}
.below-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.below-head h2 {
  margin: 0;
  font-size: 16px;
}
.specs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(150px, 0.7fr) auto;
  gap: 14px;
  align-items: end;
  margin-top: 18px;
}
.stance-field :deep(.t-radio-group) {
  width: 100%;
}
.stance-field :deep(.t-radio-button) {
  flex: 1;
  justify-content: center;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field label {
  font-size: 12px;
  color: var(--muted);
}
.cta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.link-opt {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--chrome);
}
.link-opt .hint {
  flex: 1 1 240px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
}
.prompt-box {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 14px;
}
.prompt-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.prompt-col label {
  font-size: 12px;
  color: var(--muted);
}
.kbd {
  font-size: 11px;
}

@media (max-width: 800px) {
  .task-name {
    grid-template-columns: 1fr;
    gap: 6px;
  }
  .specs {
    grid-template-columns: 1fr;
  }
  .prompt-box {
    grid-template-columns: 1fr;
  }
  .cta {
    align-items: stretch;
  }
  .below-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
