<script setup lang="ts">
const props = defineProps<{
  current: 1 | 2 | 3;
}>();

const STEPS = [
  { n: 1 as const, label: "写稿选角", hint: "口播稿和人物场景" },
  { n: 2 as const, label: "分镜", hint: "按时长切段，可改" },
  { n: 3 as const, label: "出片", hint: "逐段生成再拼接" },
];
</script>

<template>
  <ol class="steps" aria-label="制作步骤">
    <li
      v-for="s in STEPS"
      :key="s.n"
      class="step"
      :class="{
        current: props.current === s.n,
        done: props.current > s.n,
      }"
    >
      <span class="dot" aria-hidden="true" />
      <span class="copy">
        <span class="label">{{ s.label }}</span>
        <span class="hint">{{ s.hint }}</span>
      </span>
    </li>
  </ol>
</template>

<style scoped>
.steps {
  list-style: none;
  margin: 0 0 24px;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
}
.step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  position: relative;
  padding-right: 16px;
}
.step:not(:last-child)::after {
  content: "";
  position: absolute;
  left: 11px;
  right: -8px;
  top: 7px;
  height: 1px;
  background: var(--line);
  z-index: 0;
}
.dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid var(--line-strong);
  background: var(--void);
  margin-top: 1px;
  flex: none;
  position: relative;
  z-index: 1;
}
.step.done .dot {
  background: var(--cue);
  border-color: var(--cue);
}
.step.current .dot {
  border-color: var(--cue);
  box-shadow: 0 0 0 3px var(--cue-soft);
}
.step.current .dot::after {
  content: "";
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: var(--cue);
}
.copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding-right: 12px;
  position: relative;
  z-index: 1;
  background: var(--void);
}
.label {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}
.step.current .label {
  color: var(--tungsten);
}
.hint {
  font-size: 12px;
  color: var(--muted-2);
}

@media (max-width: 640px) {
  .hint {
    display: none;
  }
}
</style>
