<script setup lang="ts">
import { computed, ref } from "vue";

const props = withDefaults(
  defineProps<{
    accept?: string;
    multiple?: boolean;
    label?: string;
    hint?: string;
  }>(),
  { accept: "*/*", multiple: false, label: "选择文件", hint: "" },
);

const emit = defineEmits<{
  change: [File | File[] | null];
}>();

const dragging = ref(false);
const files = ref<File[]>([]);
const inputEl = ref<HTMLInputElement | null>(null);

const names = computed(() => files.value.map((f) => f.name).join("、"));

function setFiles(list: FileList | File[] | null) {
  const next = list ? Array.from(list) : [];
  files.value = next;
  if (!next.length) emit("change", null);
  else if (props.multiple) emit("change", next);
  else emit("change", next[0] ?? null);
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  setFiles(e.dataTransfer?.files ?? null);
}
</script>

<template>
  <div
    class="drop"
    :class="{ dragging, has: files.length }"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
    @click="inputEl?.click()"
    @keydown.enter.prevent="inputEl?.click()"
    role="button"
    tabindex="0"
  >
    <input
      ref="inputEl"
      type="file"
      :accept="accept"
      :multiple="multiple"
      hidden
      @change="setFiles(($event.target as HTMLInputElement).files)"
    />
    <div class="drop-label">{{ files.length ? names : label }}</div>
    <div class="drop-hint">{{ files.length ? "再点一次可重选" : hint || "拖进来，或点这里选" }}</div>
  </div>
</template>

<style scoped>
.drop {
  border: 1px dashed var(--line-strong);
  border-radius: 10px;
  padding: 16px 14px;
  cursor: pointer;
  background: var(--input);
  transition: border-color 0.16s ease, background 0.16s ease;
}
.drop:hover,
.drop.dragging {
  border-color: var(--cue);
  background: var(--cue-soft);
}
.drop.has {
  border-style: solid;
  border-color: var(--cue-line);
}
.drop-label {
  font-size: 13px;
  color: var(--tungsten);
  word-break: break-all;
}
.drop-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted-2);
}
</style>
