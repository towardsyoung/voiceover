<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { computed } from "vue";
import { PlayCircleIcon, LayersIcon, TaskIcon } from "tdesign-icons-vue-next";

const route = useRoute();
const router = useRouter();
const value = computed(() => {
  if (route.path.startsWith("/assets")) return "/assets";
  if (route.path.startsWith("/jobs")) return "/jobs";
  return "/produce";
});

const NAV = [
  { value: "/produce", label: "制作", icon: PlayCircleIcon },
  { value: "/assets", label: "资产", icon: LayersIcon },
  { value: "/jobs", label: "任务", icon: TaskIcon },
];
</script>

<template>
  <div class="app">
    <header class="top">
      <button class="brand" type="button" @click="router.push('/produce')">
        <span class="mark" aria-hidden="true">播</span>
        <span class="title">口播工作台</span>
      </button>
      <nav class="nav" aria-label="主导航">
        <router-link
          v-for="n in NAV"
          :key="n.value"
          :to="n.value"
          class="nav-item"
          :class="{ active: value === n.value }"
        >
          <component :is="n.icon" class="nav-icon" />
          {{ n.label }}
        </router-link>
      </nav>
      <div class="top-foot">
        <span>本机</span>
        <span class="dim">数据在 data/</span>
      </div>
    </header>
    <main class="main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.app {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
.top {
  display: flex;
  align-items: center;
  gap: 28px;
  padding: 0 28px;
  height: 60px;
  border-bottom: 1px solid var(--line);
  background: var(--desk);
  flex: none;
  position: sticky;
  top: 0;
  z-index: 20;
}
.brand {
  display: flex;
  gap: 10px;
  align-items: center;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: inherit;
  flex: none;
}
.mark {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  background: var(--hood);
  color: var(--paper);
  font-family: var(--display);
  font-weight: 700;
  font-size: 16px;
  line-height: 1;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px rgba(237, 230, 210, 0.18);
}
.title {
  font-family: var(--display);
  font-size: 16px;
  font-weight: 600;
  color: var(--tungsten);
  white-space: nowrap;
}
.nav {
  display: flex;
  gap: 4px;
  flex: 1;
}
.nav-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  color: var(--muted);
  font-size: 14px;
}
.nav-item:hover {
  color: var(--tungsten);
  background: rgba(255, 255, 255, 0.04);
}
.nav-item.active {
  color: var(--tungsten);
  background: var(--cue-soft);
}
.nav-icon {
  width: 16px;
  height: 16px;
}
.top-foot {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.35;
  flex: none;
}
.dim {
  color: var(--muted-2);
}
.main {
  flex: 1;
  padding: 28px 32px 72px;
}

@media (max-width: 720px) {
  .top {
    padding: 0 14px;
    gap: 12px;
  }
  .top-foot {
    display: none;
  }
  .main {
    padding: 18px 14px 80px;
  }
}
</style>
