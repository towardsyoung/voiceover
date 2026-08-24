<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { listJobs } from "../api/client";
import { fmtTime, statusLabel, statusTone } from "../utils/status";

type Filter = "all" | "live" | "ready" | "done" | "stuck";

const LIVE = ["storyboarding", "queued", "generating", "concatenating"];
const READY = ["draft", "storyboard_ready"];
const STUCK = ["needs_retry", "concat_failed", "cancelled"];

const items = ref<
  {
    id: string;
    title: string;
    status: string;
    created_at: string;
    video_model?: string;
    character_name_snap?: string | null;
    scene_name_snap?: string | null;
  }[]
>([]);
const filter = ref<Filter>("all");

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "live", label: "进行中" },
  { id: "ready", label: "未出片" },
  { id: "stuck", label: "待处理" },
  { id: "done", label: "已完成" },
];

const shown = computed(() => {
  if (filter.value === "all") return items.value;
  if (filter.value === "live") return items.value.filter((i) => LIVE.includes(i.status));
  if (filter.value === "ready") return items.value.filter((i) => READY.includes(i.status));
  if (filter.value === "stuck") return items.value.filter((i) => STUCK.includes(i.status));
  return items.value.filter((i) => i.status === "done");
});

const counts = computed(() => ({
  all: items.value.length,
  live: items.value.filter((i) => LIVE.includes(i.status)).length,
  ready: items.value.filter((i) => READY.includes(i.status)).length,
  stuck: items.value.filter((i) => STUCK.includes(i.status)).length,
  done: items.value.filter((i) => i.status === "done").length,
}));

onMounted(async () => {
  items.value = await listJobs();
});
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>制作任务</h1>
      <p>一条任务就是一次成片。点进去改分镜、看出片，或把稿子再做一条。</p>
    </header>

    <div v-if="items.length" class="filters" role="tablist">
      <button
        v-for="f in FILTERS"
        :key="f.id"
        type="button"
        class="chip"
        :class="{ on: filter === f.id }"
        @click="filter = f.id"
      >
        {{ f.label }}
        <span class="n">{{ counts[f.id] }}</span>
      </button>
    </div>

    <ul v-if="shown.length" class="list">
      <li v-for="it in shown" :key="it.id">
        <router-link :to="`/jobs/${it.id}`" class="job-link">
          <span class="mark">{{ (it.character_name_snap || "稿").slice(0, 1) }}</span>
          <div class="job-main">
            <span class="job-title">{{ it.title || it.id }}</span>
            <span class="job-meta">
              {{ [it.character_name_snap, it.scene_name_snap].filter(Boolean).join(" · ") || "未选择资产" }}
              <template v-if="it.video_model"> · {{ it.video_model }}</template>
            </span>
          </div>
          <div class="job-side">
            <span v-if="LIVE.includes(it.status)" class="tally" />
            <span class="status-badge" :class="`status-badge--${statusTone(it.status)}`">{{ statusLabel(it.status) }}</span>
            <span class="job-time">{{ fmtTime(it.created_at) }}</span>
          </div>
        </router-link>
        <router-link :to="{ path: '/produce', query: { from: it.id } }" class="remake-btn">用此稿再做</router-link>
      </li>
    </ul>
    <div v-else-if="items.length" class="empty">
      <div class="empty-title">这一栏是空的</div>
      <div class="empty-desc">换一个筛选，或开一条新的制作</div>
    </div>
    <div v-else class="empty">
      <div class="empty-title">还没有成片任务</div>
      <div class="empty-desc">从一篇口播稿开始</div>
      <router-link to="/produce" class="go">去写稿</router-link>
    </div>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--chrome);
  border: 1px solid var(--line);
  color: var(--muted);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 13px;
  cursor: pointer;
}
.chip.on {
  color: var(--tungsten);
  border-color: var(--cue);
  background: var(--cue-soft);
}
.n {
  font-family: var(--mono);
  font-size: 11px;
  opacity: 0.7;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.list li {
  display: flex;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--chrome);
  margin-bottom: 10px;
}
.list li:hover {
  border-color: var(--cue-line);
}
.job-link {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  padding: 14px 16px;
  flex: 1;
  min-width: 0;
}
.mark {
  width: 36px;
  height: 36px;
  border-radius: 4px;
  background: var(--hood);
  color: var(--paper);
  display: grid;
  place-items: center;
  font-family: var(--display);
  font-size: 16px;
  flex: none;
}
.job-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.job-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--tungsten);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.job-meta {
  color: var(--muted);
  font-size: 12px;
}
.job-side {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}
.job-time {
  color: var(--muted-2);
  font-size: 12px;
}
.remake-btn {
  flex: none;
  margin-right: 14px;
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 13px;
  color: var(--muted);
  white-space: nowrap;
}
.remake-btn:hover {
  color: var(--cue-2);
  border-color: var(--cue-line);
  background: var(--cue-soft);
}
.go {
  color: var(--cue-2);
  font-size: 13px;
}

@media (max-width: 720px) {
  .list li {
    flex-direction: column;
    align-items: stretch;
  }
  .remake-btn {
    margin: 0 14px 12px;
    text-align: center;
  }
  .job-time {
    display: none;
  }
}
</style>
