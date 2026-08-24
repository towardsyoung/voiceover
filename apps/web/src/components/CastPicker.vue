<script setup lang="ts">
import { computed, ref } from "vue";
import type { Character, Scene, Voice } from "../api/client";

const props = defineProps<{
  characters: Character[];
  scenes: Scene[];
  voices: Voice[];
  characterId: string;
  sceneId: string;
  voiceId: string;
}>();

const emit = defineEmits<{
  "update:characterId": [string];
  "update:sceneId": [string];
  "update:voiceId": [string];
}>();

type Kind = "character" | "scene" | "voice";
const open = ref(false);
const kind = ref<Kind>("character");

const character = computed(() => props.characters.find((x) => x.id === props.characterId));
const scene = computed(() => props.scenes.find((x) => x.id === props.sceneId));
const voice = computed(() => props.voices.find((x) => x.id === props.voiceId));

const title = computed(() => {
  if (kind.value === "character") return "选人物";
  if (kind.value === "scene") return "选场景";
  return "选音色";
});

function openKind(k: Kind) {
  kind.value = k;
  open.value = true;
}

function pick(id: string) {
  if (kind.value === "character") {
    emit("update:characterId", id);
    const c = props.characters.find((x) => x.id === id);
    if (c?.default_voice_id) emit("update:voiceId", c.default_voice_id);
  } else if (kind.value === "scene") {
    emit("update:sceneId", id);
  } else {
    emit("update:voiceId", id);
  }
  open.value = false;
}

function clear() {
  if (kind.value === "character") emit("update:characterId", "");
  else if (kind.value === "scene") emit("update:sceneId", "");
  else emit("update:voiceId", "");
  open.value = false;
}
</script>

<template>
  <div class="cast">
    <button type="button" class="slot" :class="{ empty: !character }" @click="openKind('character')">
      <img v-if="character?.board_url" class="thumb" :src="character.board_url" alt="" />
      <div v-else-if="character" class="ph">已选，无多视图</div>
      <div class="meta">
        <span class="k">人物</span>
        <span class="v">{{ character?.name || "点这里选" }}</span>
      </div>
    </button>
    <button type="button" class="slot" :class="{ empty: !scene }" @click="openKind('scene')">
      <img v-if="scene?.board_url" class="thumb" :src="scene.board_url" alt="" />
      <div v-else-if="scene" class="ph">已选，无多视图</div>
      <div class="meta">
        <span class="k">场景</span>
        <span class="v">{{ scene?.name || "点这里选" }}</span>
      </div>
    </button>
    <button type="button" class="slot" :class="{ empty: !voice }" @click="openKind('voice')">
      <div v-if="voice" class="ph voice-ph">
        <span class="wave" aria-hidden="true" />
        <span class="dur">{{ (voice.duration_ms / 1000).toFixed(1) }}s</span>
      </div>
      <div class="meta">
        <span class="k">音色</span>
        <span class="v">{{ voice?.name || "点这里选" }}</span>
      </div>
    </button>
  </div>

  <t-dialog v-model:visible="open" :header="title" width="720px" :footer="false">
    <div v-if="kind === 'character'">
      <div v-if="characters.length" class="grid">
        <button
          v-for="c in characters"
          :key="c.id"
          type="button"
          class="pick"
          :class="{ on: c.id === characterId }"
          @click="pick(c.id)"
        >
          <img v-if="c.board_url" :src="c.board_url" alt="" />
          <div v-else class="pick-ph">待制板</div>
          <strong>{{ c.name }}</strong>
          <span>{{ c.bio || "无简介" }}</span>
        </button>
      </div>
      <div v-else class="empty">
        <div class="empty-title">还没有人物</div>
        <div class="empty-desc">去资产库上传多视图，或用多角度原图制板</div>
        <router-link to="/assets" class="go">去资产库</router-link>
      </div>
    </div>
    <div v-else-if="kind === 'scene'">
      <div v-if="scenes.length" class="grid">
        <button
          v-for="s in scenes"
          :key="s.id"
          type="button"
          class="pick"
          :class="{ on: s.id === sceneId }"
          @click="pick(s.id)"
        >
          <img v-if="s.board_url" :src="s.board_url" alt="" />
          <div v-else class="pick-ph">待制板</div>
          <strong>{{ s.name }}</strong>
          <span>{{ s.bio || "无简介" }}</span>
        </button>
      </div>
      <div v-else class="empty">
        <div class="empty-title">还没有场景</div>
        <div class="empty-desc">画面里不要有人。上传或文生一张空场景板</div>
        <router-link to="/assets" class="go">去资产库</router-link>
      </div>
    </div>
    <div v-else>
      <div v-if="voices.length" class="voice-list">
        <button
          v-for="v in voices"
          :key="v.id"
          type="button"
          class="voice-row"
          :class="{ on: v.id === voiceId }"
          @click="pick(v.id)"
        >
          <div class="voice-copy">
            <strong>{{ v.name }}</strong>
            <span>{{ (v.duration_ms / 1000).toFixed(1) }} 秒{{ v.bio ? ` · ${v.bio}` : "" }}</span>
          </div>
          <audio :src="v.audio_url" controls @click.stop />
        </button>
      </div>
      <div v-else class="empty">
        <div class="empty-title">还没有音色</div>
        <div class="empty-desc">上传或录一段不超过 15 秒的参考音</div>
        <router-link to="/assets" class="go">去资产库</router-link>
      </div>
    </div>
    <p v-if="(kind === 'character' && characterId) || (kind === 'scene' && sceneId) || (kind === 'voice' && voiceId)" class="clear-row">
      <t-button variant="text" @click="clear">清除选择</t-button>
    </p>
  </t-dialog>
</template>

<style scoped>
.cast {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.slot {
  display: flex;
  flex-direction: column;
  text-align: left;
  background: var(--chrome);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  padding: 0;
  cursor: pointer;
  color: inherit;
  transition: border-color 0.16s ease;
}
.slot:hover,
.slot:focus-visible {
  border-color: var(--cue-line);
}
.slot.empty {
  border-style: dashed;
}
.thumb,
.ph {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  background: var(--input);
  display: block;
}
.ph {
  display: grid;
  place-items: center;
  color: var(--muted-2);
  font-size: 13px;
}
.slot.empty .thumb,
.slot.empty .ph {
  display: none;
}
.slot.empty {
  justify-content: center;
  min-height: 108px;
}
.slot.empty .meta {
  padding: 18px 12px;
  align-items: center;
  text-align: center;
}
.voice-ph {
  gap: 6px;
}
.wave {
  width: 48px;
  height: 18px;
  background: repeating-linear-gradient(
    90deg,
    var(--cue) 0 2px,
    transparent 2px 5px
  );
  opacity: 0.55;
  mask-image: linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent);
}
.dur {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 8px 10px 10px;
}
.k {
  font-size: 11px;
  color: var(--muted-2);
}
.v {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
.pick {
  display: flex;
  flex-direction: column;
  text-align: left;
  background: var(--input);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  padding: 0 0 10px;
  cursor: pointer;
  color: inherit;
}
.pick.on {
  border-color: var(--cue);
  box-shadow: 0 0 0 1px var(--cue);
}
.pick img,
.pick-ph {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  background: var(--desk);
}
.pick-ph {
  display: grid;
  place-items: center;
  color: var(--muted-2);
  font-size: 12px;
}
.pick strong {
  padding: 8px 10px 0;
  font-size: 13px;
}
.pick span {
  padding: 2px 10px 0;
  font-size: 12px;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.voice-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.voice-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  background: var(--input);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  color: inherit;
}
.voice-row.on {
  border-color: var(--cue);
}
.voice-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.voice-copy span {
  font-size: 12px;
  color: var(--muted);
}
.voice-row audio {
  width: 220px;
  max-width: 42%;
}
.go {
  color: var(--cue-2);
  font-size: 13px;
}
.clear-row {
  margin: 12px 0 0;
  text-align: right;
}

@media (max-width: 720px) {
  .cast {
    grid-template-columns: 1fr;
  }
  .voice-row {
    flex-direction: column;
    align-items: stretch;
  }
  .voice-row audio {
    width: 100%;
    max-width: none;
  }
}
</style>
