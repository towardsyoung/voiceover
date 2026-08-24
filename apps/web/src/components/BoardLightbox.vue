<script setup lang="ts">
import { onUnmounted, watch } from "vue";

const props = defineProps<{ src: string | null; alt?: string }>();
const emit = defineEmits<{ close: [] }>();

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}

watch(
  () => props.src,
  (src) => {
    if (src) window.addEventListener("keydown", onKey);
    else window.removeEventListener("keydown", onKey);
  },
);
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <teleport to="body">
    <div
      v-if="props.src"
      class="lb"
      role="dialog"
      aria-modal="true"
      :aria-label="alt || '预览'"
      @click.self="emit('close')"
    >
      <img :src="props.src" :alt="alt || ''" />
      <button type="button" class="x" @click="emit('close')">关闭</button>
    </div>
  </teleport>
</template>

<style scoped>
.lb {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(6, 7, 10, 0.86);
  display: grid;
  place-items: center;
  padding: 32px;
}
.lb img {
  max-width: min(1100px, 100%);
  max-height: 90vh;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: var(--shadow);
}
.x {
  position: absolute;
  top: 16px;
  right: 16px;
  background: var(--chrome);
  color: var(--tungsten);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
}
</style>
