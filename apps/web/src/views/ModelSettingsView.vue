<script setup lang="ts">
import { MessagePlugin } from "tdesign-vue-next";
import { computed, onMounted, ref } from "vue";
import { type ArkModelSetting, type ModelSettings, getModelSettings, updateModelSettings } from "../api/client";

const settings = ref<ModelSettings | null>(null);
const arkModels = ref<ArkModelSetting[]>([]);
const loading = ref(true);
const saving = ref(false);

const llmEnabled = computed(() => Boolean(settings.value?.llm.baseUrl && settings.value.llm.apiKey && settings.value.llm.model));
const imageEnabled = computed(() => Boolean(settings.value?.image.baseUrl && settings.value.image.apiKey && settings.value.image.model));
const enabledArk = computed(() => {
  const value = settings.value;
  return value?.ark.apiKey && value.ark.baseUrl
    ? arkModels.value.filter((model) => value.ark.models[model.id]?.trim()).length
    : 0;
});
const minimaxEnabled = computed(() => Boolean(settings.value?.minimax.apiKey && settings.value.minimax.baseUrl && settings.value.minimax.model));
const videoOptions = computed(() => {
  const value = settings.value;
  if (!value) return [];
  const options = value.ark.apiKey && value.ark.baseUrl
    ? arkModels.value.filter((model) => value.ark.models[model.id]?.trim()).map((model) => ({ label: model.label, value: model.id }))
    : [];
  if (minimaxEnabled.value) options.push({ label: "MiniMax H3", value: "MiniMax-H3" });
  return options;
});

onMounted(async () => {
  try {
    const data = await getModelSettings();
    settings.value = data.settings;
    arkModels.value = data.ark_models;
  } catch (error) {
    MessagePlugin.error((error as Error).message);
  } finally {
    loading.value = false;
  }
});

async function save() {
  if (!settings.value) return;
  saving.value = true;
  try {
    const data = await updateModelSettings(settings.value);
    settings.value = data.settings;
    arkModels.value = data.ark_models;
    MessagePlugin.success("模型设置已保存并立即生效");
  } catch (error) {
    MessagePlugin.error((error as Error).message);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page settings-page">
    <div class="page-head">
      <div>
        <p class="eyebrow">SETTINGS</p>
        <h1>模型设置</h1>
        <p class="intro">只有配置完整的模型才会启用，并出现在制作页的选择列表中。清空 API Key 或模型名称即可停用。</p>
      </div>
      <t-button theme="primary" :loading="saving" :disabled="!settings" @click="save">保存设置</t-button>
    </div>

    <t-loading :loading="loading" text="读取设置中">
      <div v-if="settings" class="settings-grid">
        <section class="settings-card">
          <div class="card-head"><div><h2>分镜 LLM</h2><p>OpenAI 兼容的 Chat Completions 接口</p></div><span class="state" :class="{ on: llmEnabled }">{{ llmEnabled ? "已启用" : "未启用" }}</span></div>
          <div class="form-grid">
            <label class="wide">API 地址<t-input v-model="settings.llm.baseUrl" placeholder="https://example.com/v1" /></label>
            <label>API Key<t-input v-model="settings.llm.apiKey" type="password" placeholder="sk-..." /></label>
            <label>模型名称<t-input v-model="settings.llm.model" placeholder="模型 ID" /></label>
            <label>JSON 模式<t-select v-model="settings.llm.jsonMode"><t-option value="json_schema" label="JSON Schema（优先）" /><t-option value="json_object" label="JSON Object" /></t-select></label>
          </div>
        </section>

        <section class="settings-card">
          <div class="card-head"><div><h2>图片模型</h2><p>用于生成人物板和场景板</p></div><span class="state" :class="{ on: imageEnabled }">{{ imageEnabled ? "已启用" : "未启用" }}</span></div>
          <div class="form-grid">
            <label class="wide">API 地址<t-input v-model="settings.image.baseUrl" placeholder="https://example.com/v1" /></label>
            <label>API Key<t-input v-model="settings.image.apiKey" type="password" placeholder="sk-..." /></label>
            <label>模型名称<t-input v-model="settings.image.model" placeholder="gpt-image-1" /></label>
            <label>默认尺寸<t-input v-model="settings.image.size" placeholder="1024x1024" /></label>
            <label>Quality（可选）<t-input v-model="settings.image.quality" placeholder="high" /></label>
          </div>
        </section>

        <section class="settings-card wide-card">
          <div class="card-head"><div><h2>火山方舟 · Seedance</h2><p>公共连接配置完整后，清空单个模型 ID 可独立停用</p></div><span class="state" :class="{ on: enabledArk > 0 }">{{ enabledArk ? `已启用 ${enabledArk} 个` : "未启用" }}</span></div>
          <div class="form-grid">
            <label class="wide">API 地址<t-input v-model="settings.ark.baseUrl" placeholder="https://ark.cn-beijing.volces.com/api/v3" /></label>
            <label class="wide">API Key<t-input v-model="settings.ark.apiKey" type="password" placeholder="方舟 API Key" /></label>
          </div>
          <div class="model-list">
            <label v-for="model in arkModels" :key="model.id">
              <span>{{ model.label }} <small>{{ model.minSec }}–{{ model.maxSec }}s</small></span>
              <t-input v-model="settings.ark.models[model.id]" placeholder="留空即停用" />
            </label>
          </div>
        </section>

        <section class="settings-card">
          <div class="card-head"><div><h2>MiniMax H3</h2><p>MiniMax 视频生成接口</p></div><span class="state" :class="{ on: minimaxEnabled }">{{ minimaxEnabled ? "已启用" : "未启用" }}</span></div>
          <div class="form-grid">
            <label class="wide">API 地址<t-input v-model="settings.minimax.baseUrl" placeholder="https://api.minimaxi.com" /></label>
            <label>API Key<t-input v-model="settings.minimax.apiKey" type="password" placeholder="API Key" /></label>
            <label>上游模型 ID<t-input v-model="settings.minimax.model" placeholder="MiniMax-H3" /></label>
          </div>
        </section>

        <section class="settings-card">
          <div class="card-head"><div><h2>视频默认项</h2><p>这里只显示已经配置完整的模型</p></div></div>
          <div class="form-grid">
            <label class="wide">默认视频模型<t-select v-model="settings.defaultVideoModel" clearable placeholder="暂无可用模型"><t-option v-for="option in videoOptions" :key="option.value" :value="option.value" :label="option.label" /></t-select></label>
            <label class="wide check"><t-checkbox v-model="settings.attachPrevVideo">衔接模式同时附带上一段视频</t-checkbox></label>
          </div>
        </section>
      </div>
    </t-loading>
  </div>
</template>

<style scoped>
.settings-page { max-width: 1180px; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 24px; }
.eyebrow { margin: 0 0 2px; color: var(--cue); font: 11px var(--mono); letter-spacing: .16em; }
h1 { margin: 0; font-size: 30px; }
.intro, .card-head p { margin: 5px 0 0; color: var(--muted); }
.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.settings-card { padding: 22px; background: var(--chrome); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow-soft); }
.wide-card { grid-column: 1 / -1; }
.card-head { display: flex; justify-content: space-between; gap: 18px; margin-bottom: 20px; }
.card-head h2 { margin: 0; font-size: 19px; }
.card-head p { font-size: 12px; }
.state { flex: none; align-self: flex-start; padding: 3px 9px; border-radius: 20px; color: var(--muted); background: rgba(255,255,255,.05); font-size: 11px; }
.state.on { color: var(--ok); background: var(--ok-soft); }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; }
.wide { grid-column: 1 / -1; }
.model-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 20px; margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--line); }
.model-list label span { display: flex; justify-content: space-between; }
small { color: var(--muted-2); }
.check { display: flex; align-items: center; min-height: 32px; }
@media (max-width: 800px) { .settings-grid, .model-list { grid-template-columns: 1fr; } .wide-card { grid-column: auto; } }
</style>
