<script setup lang="ts">
import { computed, ref } from "vue";
import type { Shot } from "../api/client";
import { fmtTimecode } from "../utils/time";

const shots = defineModel<Shot[]>({ required: true });
const props = defineProps<{
  readonly?: boolean;
  maxSec?: number;
}>();

const openExtra = ref<Record<number, boolean>>({});

const ranges = computed(() => {
  let t = 0;
  return shots.value.map((s) => {
    const start = t;
    t += Number(s.duration_sec) || 0;
    return { start, end: t, dur: Number(s.duration_sec) || 0 };
  });
});

const totalSec = computed(() => ranges.value.at(-1)?.end ?? 0);
const maxDur = computed(() => Math.max(1, ...ranges.value.map((r) => r.dur)));
const stance = computed(() => shots.value[0]?.stance || "—");

function toggle(index: number) {
  openExtra.value[index] = !openExtra.value[index];
}

function scrollTo(index: number) {
  document.getElementById(`shot-${index}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
</script>

<template>
  <div class="editor">
    <div class="strip-head">
      <span>全片 {{ fmtTimecode(totalSec) }} · {{ shots.length }} 段 · 姿态 {{ stance }}</span>
      <span class="hint">台词须与口播稿逐字一致。改完后保存，提示词会按模板重写。</span>
    </div>
    <div class="strip" role="img" :aria-label="`共 ${shots.length} 段，${fmtTimecode(totalSec)}`">
      <button
        v-for="(r, i) in ranges"
        :key="shots[i].index"
        type="button"
        class="cell"
        :style="{ flex: Math.max(r.dur, 4) }"
        :title="`第 ${shots[i].index} 段 ${fmtTimecode(r.start)}–${fmtTimecode(r.end)}`"
        @click="scrollTo(shots[i].index)"
      >
        <span class="cell-bar" :style="{ width: `${(r.dur / maxDur) * 100}%` }" />
        <span class="cell-n">{{ shots[i].index }}</span>
      </button>
    </div>

    <article
      v-for="(s, i) in shots"
      :id="`shot-${s.index}`"
      :key="s.index"
      class="shot"
    >
      <header class="shot-head">
        <span class="idx">第 {{ s.index }} 段</span>
        <span class="tc mono">{{ fmtTimecode(ranges[i].start) }}–{{ fmtTimecode(ranges[i].end) }}</span>
        <label class="dur">
          <input
            v-model.number="s.duration_sec"
            type="number"
            step="0.5"
            min="4"
            :max="maxSec || undefined"
            :disabled="readonly"
          />
          <span>秒</span>
        </label>
      </header>

      <label class="dlg-label">台词</label>
      <textarea v-model="s.dialogue" rows="3" :disabled="readonly" class="dialogue" />

      <div class="chips">
        <label>
          景别
          <select v-model="s.shot_size" :disabled="readonly">
            <option>中近景</option>
            <option>近景</option>
            <option>中景</option>
          </select>
        </label>
        <label>
          运镜
          <select v-model="s.camera" :disabled="readonly">
            <option>固定</option>
            <option>固定，后段极轻 Dolly In</option>
          </select>
        </label>
        <span class="chip">姿态 {{ s.stance }}</span>
        <span class="chip">承接 {{ s.continuity }}</span>
        <button type="button" class="more" @click="toggle(s.index)">
          {{ openExtra[s.index] ? "收起画面" : "画面与动作" }}
        </button>
      </div>

      <div v-if="openExtra[s.index]" class="extra">
        <label>朝向<input v-model="s.facing" :disabled="readonly" /></label>
        <label>情绪<input v-model="s.emotion" :disabled="readonly" /></label>
        <label class="span2">动作<textarea v-model="s.action" rows="2" :disabled="readonly" /></label>
        <label class="span2">画面<textarea v-model="s.visual" rows="2" :disabled="readonly" /></label>
        <label class="span2">尾帧<textarea v-model="s.end_frame" rows="2" :disabled="readonly" /></label>
      </div>
    </article>
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.strip-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--muted);
}
.strip {
  display: flex;
  gap: 3px;
  height: 28px;
  background: var(--input);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 3px;
}
.cell {
  position: relative;
  min-width: 28px;
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: var(--muted);
}
.cell-bar {
  display: block;
  height: 100%;
  background: var(--cue-soft);
  border-radius: 3px;
}
.cell:hover .cell-bar {
  background: var(--cue-line);
}
.cell-n {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-family: var(--mono);
  font-size: 10px;
}
.shot {
  background: var(--chrome);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px 16px 16px;
}
.shot-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.idx {
  font-family: var(--display);
  font-size: 16px;
  font-weight: 600;
}
.tc {
  font-size: 12px;
  color: var(--muted);
}
.dur {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.dur input {
  width: 72px;
  background: var(--input);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 4px 8px;
  color: var(--tungsten);
  font-family: var(--mono);
}
.dlg-label {
  display: block;
  font-size: 11px;
  color: var(--muted-2);
  margin-bottom: 4px;
}
.dialogue {
  width: 100%;
  background: var(--paper);
  color: var(--paper-ink);
  border: 0;
  border-radius: 6px;
  padding: 10px 12px;
  font-family: var(--display);
  font-size: 16px;
  line-height: 1.7;
  resize: vertical;
}
.dialogue:disabled {
  opacity: 0.85;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}
.chips label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.chips select,
.extra input,
.extra textarea {
  background: var(--input);
  color: var(--tungsten);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 13px;
}
.extra textarea {
  width: 100%;
  resize: vertical;
}
.chip {
  font-size: 12px;
  color: var(--muted-2);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 3px 10px;
}
.more {
  margin-left: auto;
  background: none;
  border: 0;
  color: var(--cue-2);
  font-size: 12px;
  cursor: pointer;
}
.extra {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.extra label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.span2 {
  grid-column: 1 / -1;
}

@media (max-width: 640px) {
  .extra {
    grid-template-columns: 1fr;
  }
  .more {
    margin-left: 0;
  }
}
</style>
