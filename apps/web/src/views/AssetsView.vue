<script setup lang="ts">
import { DialogPlugin, MessagePlugin } from "tdesign-vue-next";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { AddIcon, RefreshIcon } from "tdesign-icons-vue-next";
import VoiceRecorder from "../components/VoiceRecorder.vue";
import FileDrop from "../components/FileDrop.vue";
import BoardLightbox from "../components/BoardLightbox.vue";
import {
  type Character,
  type Config,
  type Scene,
  type Voice,
  createCharacter,
  createScene,
  createVoice,
  deleteCharacter,
  deleteScene,
  deleteVoice,
  generateCharacterBoard,
  generateSceneBoard,
  getAssetJob,
  getConfig,
  listCharacters,
  listScenes,
  listVoices,
  refreshCharacterVolcAsset,
  remakeCharacter,
  remakeScene,
  remakeVoice,
  submitCharacterVolcAsset,
  updateCharacter,
  updateScene,
  updateVoice,
} from "../api/client";

const router = useRouter();
const tab = ref("characters");
const lightbox = ref<string | null>(null);
const config = ref<Config | null>(null);
const characters = ref<Character[]>([]);
const scenes = ref<Scene[]>([]);
const voices = ref<Voice[]>([]);
const loading = ref(false);

const charVisible = ref(false);
const sceneVisible = ref(false);
const voiceVisible = ref(false);
const editingCharId = ref<string | null>(null);
const editingSceneId = ref<string | null>(null);
const editingVoiceId = ref<string | null>(null);

const charForm = ref({ name: "", bio: "", mode: "upload_board" });
const sceneForm = ref({ name: "", bio: "", mode: "upload", prompt: "" });
const voiceForm = ref({ name: "", bio: "", character_id: "" });
const charBoard = ref<File | null>(null);
const charSources = ref<File[]>([]);
const sceneBoard = ref<File | null>(null);
const sceneRef = ref<File | null>(null);
const voiceFile = ref<File | null>(null);
const recBlob = ref<Blob | null>(null);
const busy = ref<Record<string, string>>({});
const submitting = ref(false);
const mediaEpoch = ref(0);
const voiceFileEpoch = ref(0);
const voiceRecEpoch = ref(0);

const editingChar = computed(() => characters.value.find((c) => c.id === editingCharId.value) ?? null);
const editingScene = computed(() => scenes.value.find((s) => s.id === editingSceneId.value) ?? null);
const editingVoice = computed(() => voices.value.find((v) => v.id === editingVoiceId.value) ?? null);

async function pollJob(jobId: string, key: string) {
  for (let i = 0; i < 90; i++) {
    const job = await getAssetJob(jobId);
    busy.value[key] = job.status;
    if (job.status === "succeeded") {
      await reload();
      MessagePlugin.success("制板完成，请人工确认四格");
      delete busy.value[key];
      return;
    }
    if (job.status === "failed") {
      MessagePlugin.error(job.error || "制板失败");
      delete busy.value[key];
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  MessagePlugin.warning("制板仍在排队或生成，请稍后刷新");
}

async function genChar(id: string) {
  try {
    const job = await generateCharacterBoard(id);
    busy.value[id] = job.status;
    await pollJob(job.id, id);
  } catch (e) {
    MessagePlugin.warning((e as Error).message);
  }
}

const volcBusy = ref<Record<string, boolean>>({});

const VOLC_STATUS_TEXT: Record<string, string> = {
  none: "未提交",
  submitting: "提交中",
  auditing: "审核中",
  approved: "已过审",
  rejected: "被驳回",
  failed: "失败",
  unknown: "未知",
};

async function submitVolc(c: Character) {
  volcBusy.value[c.id] = true;
  try {
    const st = await submitCharacterVolcAsset(c.id);
    const status = st.status || "unknown";
    if (status === "approved") MessagePlugin.success("火山审核通过，真人模型可直接使用该人物");
    else if (status === "auditing") MessagePlugin.info("已提交，审核中，可稍后点击「查询审核」刷新");
    else MessagePlugin.warning(`审核状态：${VOLC_STATUS_TEXT[status] || status}${st.reason ? `（${st.reason}）` : ""}`);
    await reload();
  } catch (e) {
    MessagePlugin.error((e as Error).message);
    await reload();
  } finally {
    delete volcBusy.value[c.id];
  }
}

async function refreshVolc(c: Character) {
  volcBusy.value[c.id] = true;
  try {
    const st = await refreshCharacterVolcAsset(c.id);
    const status = st.status || "unknown";
    if (status === "approved") MessagePlugin.success("审核已通过");
    else if (status === "rejected" || status === "failed") MessagePlugin.warning(`审核未通过：${st.reason || "-"}`);
    await reload();
  } catch (e) {
    MessagePlugin.error((e as Error).message);
  } finally {
    delete volcBusy.value[c.id];
  }
}

async function genScene(id: string) {
  try {
    const job = await generateSceneBoard(id);
    busy.value[id] = job.status;
    await pollJob(job.id, id);
  } catch (e) {
    MessagePlugin.warning((e as Error).message);
  }
}

async function reload() {
  loading.value = true;
  try {
    [characters.value, scenes.value, voices.value] = await Promise.all([
      listCharacters(),
      listScenes(),
      listVoices(),
    ]);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  config.value = await getConfig();
  await reload();
});

function produceWith(query: Record<string, string>) {
  void router.push({ path: "/produce", query });
}

function resetCharForm() {
  charForm.value = { name: "", bio: "", mode: "upload_board" };
  charBoard.value = null;
  charSources.value = [];
  editingCharId.value = null;
  mediaEpoch.value += 1;
}
function resetSceneForm() {
  sceneForm.value = { name: "", bio: "", mode: "upload", prompt: "" };
  sceneBoard.value = null;
  sceneRef.value = null;
  editingSceneId.value = null;
  mediaEpoch.value += 1;
}
function resetVoiceForm() {
  voiceForm.value = { name: "", bio: "", character_id: "" };
  voiceFile.value = null;
  recBlob.value = null;
  editingVoiceId.value = null;
  mediaEpoch.value += 1;
}

function openCreateChar() {
  resetCharForm();
  charVisible.value = true;
}
function openEditChar(c: Character) {
  resetCharForm();
  charForm.value.name = c.name;
  charForm.value.bio = c.bio;
  charForm.value.mode = c.source_kind === "generated" ? "generate" : "upload_board";
  editingCharId.value = c.id;
  charVisible.value = true;
}
function openCreateScene() {
  resetSceneForm();
  sceneVisible.value = true;
}
function openEditScene(s: Scene) {
  resetSceneForm();
  sceneForm.value.name = s.name;
  sceneForm.value.bio = s.bio;
  sceneForm.value.prompt = s.gen_prompt ?? "";
  sceneForm.value.mode = s.source_kind === "t2i" || s.source_kind === "i2i" ? s.source_kind : "upload";
  editingSceneId.value = s.id;
  sceneVisible.value = true;
}
function openCreateVoice() {
  resetVoiceForm();
  voiceVisible.value = true;
}
function openEditVoice(v: Voice) {
  resetVoiceForm();
  voiceForm.value.name = v.name;
  voiceForm.value.bio = v.bio;
  voiceForm.value.character_id = v.character_id ?? "";
  editingVoiceId.value = v.id;
  voiceVisible.value = true;
}

function charMediaFd() {
  const fd = new FormData();
  fd.append("mode", charForm.value.mode);
  if (charForm.value.mode === "upload_board" && charBoard.value) fd.append("board", charBoard.value);
  if (charForm.value.mode === "generate") {
    const roles = ["front", "side", "back", "mouth"];
    charSources.value.forEach((f, i) => {
      fd.append("sources", f);
      fd.append("source_roles", roles[i] || "other");
    });
  }
  return fd;
}

function shouldRemakeChar() {
  if (charForm.value.mode === "upload_board") return !!charBoard.value;
  return charSources.value.length > 0;
}

async function submitCharacter() {
  if (!charForm.value.name.trim()) {
    MessagePlugin.warning("请填写人物名称");
    return;
  }
  if (!editingCharId.value && charForm.value.mode === "upload_board" && !charBoard.value) {
    MessagePlugin.warning("请上传成品人物多视图");
    return;
  }
  if (!editingCharId.value && charForm.value.mode === "generate" && !charSources.value.length) {
    MessagePlugin.warning("请至少上传一张角度图");
    return;
  }
  const editing = editingCharId.value;
  submitting.value = true;
  try {
    let genId = "";
    const remaking = editing ? shouldRemakeChar() : false;
    if (editing) {
      await updateCharacter(editing, { name: charForm.value.name, bio: charForm.value.bio });
      if (remaking) {
        await remakeCharacter(editing, charMediaFd());
        if (charForm.value.mode === "generate") genId = editing;
      }
    } else {
      const fd = charMediaFd();
      fd.append("name", charForm.value.name);
      fd.append("bio", charForm.value.bio);
      const created = await createCharacter(fd);
      if (charForm.value.mode === "generate") genId = created.id;
    }
    charVisible.value = false;
    await reload();
    MessagePlugin.success(editing ? (remaking ? "人物画面已更新" : "人物已更新") : "人物已入库");
    if (genId) void genChar(genId);
  } catch (e) {
    MessagePlugin.error((e as Error).message);
  } finally {
    submitting.value = false;
  }
}

function sceneMediaFd() {
  const fd = new FormData();
  fd.append("mode", sceneForm.value.mode);
  if (sceneForm.value.prompt) fd.append("prompt", sceneForm.value.prompt);
  if (sceneForm.value.mode === "upload" && sceneBoard.value) fd.append("board", sceneBoard.value);
  if (sceneForm.value.mode === "i2i" && sceneRef.value) fd.append("ref", sceneRef.value);
  return fd;
}

function shouldRemakeScene() {
  if (sceneForm.value.mode === "upload") return !!sceneBoard.value;
  if (sceneForm.value.mode === "i2i") return !!sceneRef.value;
  const original = editingScene.value;
  return !!original && original.source_kind !== "t2i";
}

async function submitScene() {
  if (!sceneForm.value.name.trim()) {
    MessagePlugin.warning("请填写场景名称");
    return;
  }
  if (!editingSceneId.value && sceneForm.value.mode === "upload" && !sceneBoard.value) {
    MessagePlugin.warning("请上传场景多视图");
    return;
  }
  if (!editingSceneId.value && sceneForm.value.mode === "i2i" && !sceneRef.value) {
    MessagePlugin.warning("图生图需要参考图");
    return;
  }
  if (!editingSceneId.value && sceneForm.value.mode !== "upload" && !sceneForm.value.prompt.trim()) {
    MessagePlugin.warning("请填写场景提示词");
    return;
  }
  if (editingSceneId.value && shouldRemakeScene()) {
    if (sceneForm.value.mode === "upload" && !sceneBoard.value) {
      MessagePlugin.warning("请上传新的场景多视图");
      return;
    }
    if (sceneForm.value.mode === "i2i" && !sceneRef.value) {
      MessagePlugin.warning("请上传新的参考图");
      return;
    }
    if (sceneForm.value.mode !== "upload" && !sceneForm.value.prompt.trim()) {
      MessagePlugin.warning("请填写场景提示词");
      return;
    }
  }
  const editing = editingSceneId.value;
  submitting.value = true;
  try {
    let genId = "";
    const remaking = editing ? shouldRemakeScene() : false;
    if (editing) {
      await updateScene(editing, {
        name: sceneForm.value.name,
        bio: sceneForm.value.bio,
        gen_prompt: sceneForm.value.prompt,
      });
      if (remaking) {
        await remakeScene(editing, sceneMediaFd());
        if (sceneForm.value.mode !== "upload") genId = editing;
      }
    } else {
      const fd = sceneMediaFd();
      fd.append("name", sceneForm.value.name);
      fd.append("bio", sceneForm.value.bio);
      const created = await createScene(fd);
      if (sceneForm.value.mode !== "upload") genId = created.id;
    }
    sceneVisible.value = false;
    await reload();
    MessagePlugin.success(editing ? (remaking ? "场景画面已更新" : "场景已更新") : "场景已入库");
    if (genId) void genScene(genId);
  } catch (e) {
    MessagePlugin.error((e as Error).message);
  } finally {
    submitting.value = false;
  }
}

function voiceAudioFile(): File | null {
  if (recBlob.value) return new File([recBlob.value], "record.webm", { type: recBlob.value.type || "audio/webm" });
  return voiceFile.value;
}

function onVoiceFile(f: File | File[] | null) {
  const file = (Array.isArray(f) ? f[0] : f) || null;
  voiceFile.value = file;
  if (file) {
    recBlob.value = null;
    voiceRecEpoch.value += 1;
  }
}

function onVoiceBlob(blob: Blob) {
  recBlob.value = blob;
  voiceFile.value = null;
  voiceFileEpoch.value += 1;
}

async function submitVoice() {
  if (!voiceForm.value.name.trim()) {
    MessagePlugin.warning("请填写音色名称");
    return;
  }
  const audio = voiceAudioFile();
  if (!editingVoiceId.value && !audio) {
    MessagePlugin.warning("请上传或录入音频");
    return;
  }
  const editing = editingVoiceId.value;
  submitting.value = true;
  try {
    if (editing) {
      await updateVoice(editing, {
        name: voiceForm.value.name,
        bio: voiceForm.value.bio,
        character_id: voiceForm.value.character_id || null,
      });
      if (audio) {
        const fd = new FormData();
        fd.append("audio", audio);
        await remakeVoice(editing, fd);
      }
    } else {
      const fd = new FormData();
      fd.append("name", voiceForm.value.name);
      fd.append("bio", voiceForm.value.bio);
      if (voiceForm.value.character_id) fd.append("character_id", voiceForm.value.character_id);
      if (audio) fd.append("audio", audio);
      await createVoice(fd);
    }
    voiceVisible.value = false;
    recBlob.value = null;
    await reload();
    MessagePlugin.success(editing ? (audio ? "音色已重新录入" : "音色已更新") : "音色已入库");
  } catch (e) {
    MessagePlugin.error((e as Error).message);
  } finally {
    submitting.value = false;
  }
}

function confirmRemove(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = DialogPlugin.confirm({
      header: "确认删除",
      body: `确定删除「${name}」吗？该操作不可恢复。`,
      theme: "warning",
      confirmBtn: { content: "删除", theme: "danger" },
      cancelBtn: "取消",
      onConfirm: () => {
        dlg.hide();
        resolve(true);
      },
      onCancel: () => {
        dlg.hide();
        resolve(false);
      },
      onClose: () => resolve(false),
    });
  });
}

async function remove(kind: "c" | "s" | "v", id: string, name: string) {
  if (!(await confirmRemove(name))) return;
  try {
    if (kind === "c") await deleteCharacter(id);
    if (kind === "s") await deleteScene(id);
    if (kind === "v") await deleteVoice(id);
    await reload();
  } catch (e) {
    MessagePlugin.error((e as Error).message);
  }
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>资产库</h1>
      <p>人物、空场景、音色全局复用。画面里不要有人。音色不超过 {{ config?.limits.voice_max_sec ?? 15 }} 秒。</p>
    </header>
    <BoardLightbox :src="lightbox" alt="多视图" @close="lightbox = null" />
    <t-tabs v-model="tab">
      <t-tab-panel value="characters" label="人物">
        <div class="bar">
          <t-button theme="primary" @click="openCreateChar">
            <template #icon><AddIcon /></template>
            新建人物
          </t-button>
          <t-button variant="outline" :loading="loading" @click="reload">
            <template #icon><RefreshIcon /></template>
            刷新
          </t-button>
        </div>
        <div v-if="characters.length" class="grid">
          <t-card v-for="c in characters" :key="c.id" class="asset-card">
            <button type="button" class="cover-wrap" :disabled="!c.board_url" @click="c.board_url && (lightbox = c.board_url)">
              <img v-if="c.board_url" class="cover" :src="c.board_url" alt="" />
              <div v-else class="ph">待制板</div>
            </button>
            <div class="asset-head">
              <span class="asset-name">{{ c.name }}</span>
              <span class="status-badge" :class="c.job_count ? 'status-badge--info' : 'status-badge--neutral'">
                {{ c.job_count ? `用过 ${c.job_count} 次` : "还没用过" }}
              </span>
            </div>
            <p class="bio">{{ c.bio || "无简介" }}</p>
            <div class="meta">
              {{ c.source_kind === "generated" ? "多图制板" : "成品板" }}
              <span v-if="busy[c.id]"> · {{ busy[c.id] }}</span>
              <span v-if="c.volc_asset && c.volc_asset.status !== 'none'" class="volc-badge" :class="`volc-badge--${c.volc_asset.status}`">
                火山{{ VOLC_STATUS_TEXT[c.volc_asset.status] || c.volc_asset.status }}
              </span>
            </div>
            <div class="card-actions">
              <t-button size="small" theme="primary" variant="outline" :disabled="!c.board_url" @click="produceWith({ character: c.id })">
                用来制作
              </t-button>
              <t-button size="small" variant="outline" @click="openEditChar(c)">编辑</t-button>
              <t-dropdown
                :options="[
                  ...(c.source_kind === 'generated' ? [{ content: '重新制板', value: 'board' }] : []),
                  { content: '提交火山审核', value: 'volc', disabled: !c.board_url },
                  ...(c.volc_asset && ['auditing', 'submitting'].includes(c.volc_asset.status)
                    ? [{ content: '查询审核', value: 'refresh' }]
                    : []),
                  { content: '删除', value: 'del', disabled: c.job_count > 0 },
                ]"
                @click="(o: { value: string }) => {
                  if (o.value === 'board') void genChar(c.id);
                  if (o.value === 'volc') void submitVolc(c);
                  if (o.value === 'refresh') void refreshVolc(c);
                  if (o.value === 'del') void remove('c', c.id, c.name);
                }"
              >
                <t-button size="small" variant="text">更多</t-button>
              </t-dropdown>
            </div>
          </t-card>
        </div>
        <div v-else class="empty">
          <div class="empty-icon">👤</div>
          <div class="empty-title">还没有人物</div>
          <div class="empty-desc">上传成品多视图，或用多角度原图生成人物板</div>
        </div>
      </t-tab-panel>

      <t-tab-panel value="scenes" label="场景">
        <div class="bar">
          <t-button theme="primary" @click="openCreateScene">
            <template #icon><AddIcon /></template>
            新建场景
          </t-button>
        </div>
        <div v-if="scenes.length" class="grid">
          <t-card v-for="s in scenes" :key="s.id" class="asset-card">
            <button type="button" class="cover-wrap" :disabled="!s.board_url" @click="s.board_url && (lightbox = s.board_url)">
              <img v-if="s.board_url" class="cover" :src="s.board_url" alt="" />
              <div v-else class="ph">待制板 · 须空场无人</div>
            </button>
            <div class="asset-head">
              <span class="asset-name">{{ s.name }}</span>
              <span class="status-badge" :class="s.job_count ? 'status-badge--info' : 'status-badge--neutral'">
                {{ s.job_count ? `用过 ${s.job_count} 次` : "还没用过" }}
              </span>
            </div>
            <p class="bio">{{ s.bio || "无简介" }}</p>
            <div class="meta">{{ s.source_kind === "upload" ? "上传" : s.source_kind === "t2i" ? "文生图" : "图生图" }}<span v-if="busy[s.id]"> · {{ busy[s.id] }}</span></div>
            <div class="card-actions">
              <t-button size="small" theme="primary" variant="outline" :disabled="!s.board_url" @click="produceWith({ scene: s.id })">
                用来制作
              </t-button>
              <t-button size="small" variant="outline" @click="openEditScene(s)">编辑</t-button>
              <t-dropdown
                :options="[
                  ...(s.source_kind !== 'upload' ? [{ content: '重新制板', value: 'board' }] : []),
                  { content: '删除', value: 'del', disabled: s.job_count > 0 },
                ]"
                @click="(o: { value: string }) => {
                  if (o.value === 'board') void genScene(s.id);
                  if (o.value === 'del') void remove('s', s.id, s.name);
                }"
              >
                <t-button size="small" variant="text">更多</t-button>
              </t-dropdown>
            </div>
          </t-card>
        </div>
        <div v-else class="empty">
          <div class="empty-icon">🏞️</div>
          <div class="empty-title">还没有场景</div>
          <div class="empty-desc">上传多视图，或文生图 / 图生图生成空场景板</div>
        </div>
      </t-tab-panel>

      <t-tab-panel value="voices" label="音色">
        <div class="bar">
          <t-button theme="primary" @click="openCreateVoice">
            <template #icon><AddIcon /></template>
            新建音色
          </t-button>
        </div>
        <div v-if="voices.length" class="grid">
          <t-card v-for="v in voices" :key="v.id" class="asset-card">
            <audio :src="v.audio_url" controls />
            <div class="asset-head">
              <span class="asset-name">{{ v.name }}</span>
              <span class="status-badge" :class="v.job_count ? 'status-badge--info' : 'status-badge--neutral'">
                {{ v.job_count ? `用过 ${v.job_count} 次` : "还没用过" }}
              </span>
            </div>
            <p class="bio">{{ v.bio || "无简介" }}</p>
            <div class="meta">{{ (v.duration_ms / 1000).toFixed(1) }} 秒</div>
            <div class="card-actions">
              <t-button size="small" theme="primary" variant="outline" @click="produceWith({ voice: v.id })">
                用来制作
              </t-button>
              <t-button size="small" variant="outline" @click="openEditVoice(v)">编辑</t-button>
              <t-button size="small" variant="text" theme="danger" :disabled="v.job_count > 0" @click="remove('v', v.id, v.name)">
                删除
              </t-button>
            </div>
          </t-card>
        </div>
        <div v-else class="empty">
          <div class="empty-icon">🎙️</div>
          <div class="empty-title">还没有音色</div>
          <div class="empty-desc">上传音频或在线录音，将转成 48k WAV 入库</div>
        </div>
      </t-tab-panel>
    </t-tabs>

    <t-dialog v-model:visible="charVisible" :header="editingCharId ? '编辑人物' : '新建人物'" width="560px" :confirm-loading="submitting" @confirm="submitCharacter">
      <t-form label-align="top">
        <t-form-item label="名称"><t-input v-model="charForm.name" placeholder="人物名称" /></t-form-item>
        <t-form-item label="简介"><t-textarea v-model="charForm.bio" :autosize="{ minRows: 2 }" /></t-form-item>
        <p v-if="editingChar?.job_count" class="remake-note">
          已有 {{ editingChar.job_count }} 个制作任务引用此人。替换画面后，再生成会用新图。
        </p>
        <t-form-item :label="editingCharId ? '重新制作画面（可选）' : '入库方式'">
          <t-radio-group v-model="charForm.mode">
            <t-radio value="upload_board">上传成品多视图</t-radio>
            <t-radio value="generate">多角度原图制作</t-radio>
          </t-radio-group>
        </t-form-item>
        <div v-if="editingChar?.board_url" class="current-media">
          <img :src="editingChar.board_url" alt="当前人物板" />
          <span>当前画面，选了新图才会替换</span>
        </div>
        <t-form-item v-if="charForm.mode === 'upload_board'" :label="editingCharId ? '新的成品板' : '成品板图片'">
          <FileDrop
            :key="`char-board-${mediaEpoch}`"
            accept="image/*"
            :label="editingCharId ? '重新上传人物多视图' : '上传人物多视图'"
            hint="一张四格板：正脸大图、正面、侧面、微张嘴"
            @change="charBoard = $event as File | null"
          />
        </t-form-item>
        <t-form-item v-else :label="editingCharId ? '新的角度图（会替换全部）' : '角度图（建议正脸、侧面、背面、微张嘴）'">
          <FileDrop
            :key="`char-src-${mediaEpoch}`"
            accept="image/*"
            multiple
            :label="editingCharId ? '重新上传多张角度图' : '上传多张角度图'"
            hint="按正脸、侧面、背面、微张嘴的顺序选"
            @change="charSources = ($event as File[]) || []"
          />
        </t-form-item>
      </t-form>
    </t-dialog>

    <t-dialog v-model:visible="sceneVisible" :header="editingSceneId ? '编辑场景' : '新建场景'" width="560px" :confirm-loading="submitting" @confirm="submitScene">
      <t-form label-align="top">
        <t-form-item label="名称"><t-input v-model="sceneForm.name" placeholder="场景名称" /></t-form-item>
        <t-form-item label="简介"><t-textarea v-model="sceneForm.bio" :autosize="{ minRows: 2 }" /></t-form-item>
        <p v-if="editingScene?.job_count" class="remake-note">
          已有 {{ editingScene.job_count }} 个制作任务引用此场景。替换画面后，再生成会用新图。
        </p>
        <t-form-item :label="editingSceneId ? '重新制作画面（可选）' : '来源'">
          <t-radio-group v-model="sceneForm.mode">
            <t-radio value="upload">上传多视图</t-radio>
            <t-radio value="t2i">文生图</t-radio>
            <t-radio value="i2i">图生图</t-radio>
          </t-radio-group>
        </t-form-item>
        <div v-if="editingScene?.board_url" class="current-media">
          <img :src="editingScene.board_url" alt="当前场景板" />
          <span>当前画面，选了新图或改成文生图才会替换</span>
        </div>
        <t-form-item v-if="sceneForm.mode === 'upload'" :label="editingSceneId ? '新的成品板' : '成品板图片'">
          <FileDrop
            :key="`scene-board-${mediaEpoch}`"
            accept="image/*"
            :label="editingSceneId ? '重新上传场景多视图' : '上传场景多视图'"
            hint="四格：正面主机位、斜侧 45°、远景、桌面特写。画面不能有人"
            @change="sceneBoard = $event as File | null"
          />
        </t-form-item>
        <t-form-item v-if="sceneForm.mode === 'i2i'" :label="editingSceneId ? '新的参考图' : '参考图'">
          <FileDrop
            :key="`scene-ref-${mediaEpoch}`"
            accept="image/*"
            :label="editingSceneId ? '重新上传参考图' : '上传参考图'"
            hint="空场景，不要有人"
            @change="sceneRef = $event as File | null"
          />
        </t-form-item>
        <t-form-item v-if="sceneForm.mode !== 'upload'" label="提示词">
          <t-textarea v-model="sceneForm.prompt" placeholder="画面不能有人" />
        </t-form-item>
      </t-form>
    </t-dialog>

    <t-dialog v-model:visible="voiceVisible" :header="editingVoiceId ? '编辑音色' : '新建音色'" width="560px" :confirm-loading="submitting" @confirm="submitVoice">
      <t-form label-align="top">
        <t-form-item label="名称"><t-input v-model="voiceForm.name" placeholder="音色名称" /></t-form-item>
        <t-form-item label="简介"><t-textarea v-model="voiceForm.bio" :autosize="{ minRows: 2 }" /></t-form-item>
        <t-form-item label="绑定人物（可选）">
          <t-select v-model="voiceForm.character_id" clearable placeholder="可不绑">
            <t-option v-for="c in characters" :key="c.id" :value="c.id" :label="c.name" />
          </t-select>
        </t-form-item>
        <p v-if="editingVoice?.job_count" class="remake-note">
          已有 {{ editingVoice.job_count }} 个制作任务引用此音色。替换音频后，再生成会用新音色。
        </p>
        <t-form-item v-if="editingVoice" label="当前音频">
          <audio :src="editingVoice.audio_url" controls />
        </t-form-item>
        <t-form-item :label="editingVoiceId ? '重新上传（可选）' : '本地上传'">
          <FileDrop
            :key="`voice-file-${mediaEpoch}-${voiceFileEpoch}`"
            accept="audio/*"
            :label="editingVoiceId ? '重新上传参考音' : '上传参考音'"
            hint="不超过 15 秒，会转成 48k WAV"
            @change="onVoiceFile"
          />
        </t-form-item>
        <t-form-item :label="editingVoiceId ? '重新录音（可选）' : '在线录入'">
          <VoiceRecorder :key="`voice-rec-${mediaEpoch}-${voiceRecEpoch}`" @blob="onVoiceBlob" />
          <span v-if="recBlob" class="ok">已录 {{ (recBlob.size / 1024).toFixed(0) }} KB</span>
        </t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>

<style scoped>
.bar {
  margin: 14px 0 18px;
  display: flex;
  gap: 12px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 18px;
}
.asset-card:hover {
  border-color: var(--line-strong) !important;
  transform: translateY(-2px);
  box-shadow: var(--shadow) !important;
}
.cover-wrap {
  overflow: hidden;
  border-radius: 10px;
  margin-bottom: 12px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  cursor: zoom-in;
  display: block;
}
.cover-wrap:disabled {
  cursor: default;
}
.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.cover {
  width: 100%;
  aspect-ratio: 3/2;
  object-fit: cover;
  background: var(--input);
  display: block;
}
.ph {
  aspect-ratio: 3/2;
  display: grid;
  place-items: center;
  background: var(--input);
  color: var(--muted);
  border: 1px dashed var(--line);
  font-size: 13px;
  border-radius: 10px;
}
.asset-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.asset-name {
  font-weight: 600;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bio {
  min-height: 2.4em;
  color: var(--muted);
  font-size: 13px;
  margin: 4px 0 8px;
}
.meta {
  font-size: 12px;
  color: var(--muted-2);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.volc-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid var(--line);
  color: var(--muted);
}
.volc-badge--approved {
  color: var(--ok, #2ba471);
  border-color: var(--ok, #2ba471);
}
.volc-badge--rejected,
.volc-badge--failed {
  color: var(--warn, #d54941);
  border-color: var(--warn, #d54941);
}
.volc-badge--auditing,
.volc-badge--submitting {
  color: var(--brand, #0052d9);
  border-color: var(--brand, #0052d9);
}
.ok {
  margin-left: 8px;
  color: var(--ok);
  font-size: 12px;
}
.remake-note {
  margin: 0 0 12px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--muted);
  background: var(--input);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.current-media {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 14px;
}
.current-media img {
  width: 120px;
  height: 80px;
  object-fit: cover;
  border-radius: 8px;
  background: var(--input);
  flex: none;
}
.current-media span {
  font-size: 12px;
  color: var(--muted-2);
}
audio {
  width: 100%;
  margin-bottom: 10px;
}
</style>
