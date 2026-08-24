<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";

const emit = defineEmits<{ blob: [Blob] }>();
const recording = ref(false);
const seconds = ref(0);
const error = ref("");
const done = ref(false);
let rec: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let timer: number | null = null;
let chunks: Blob[] = [];

const bar = computed(() => Math.min(100, (seconds.value / 15) * 100));

async function start() {
  error.value = "";
  done.value = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    error.value = "浏览器没拿到麦克风权限";
    return;
  }
  chunks = [];
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  try {
    rec = new MediaRecorder(stream, { mimeType: mime });
  } catch {
    rec = new MediaRecorder(stream);
  }
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.onstop = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    const blob = new Blob(chunks, { type: rec?.mimeType || "audio/webm" });
    done.value = true;
    emit("blob", blob);
  };
  rec.start();
  recording.value = true;
  seconds.value = 0;
  timer = window.setInterval(() => {
    seconds.value += 1;
    if (seconds.value >= 15) stop();
  }, 1000);
}

function stop() {
  if (timer) window.clearInterval(timer);
  timer = null;
  recording.value = false;
  const current = rec;
  rec = null;
  try {
    if (current && current.state !== "inactive") current.stop();
    else stream?.getTracks().forEach((t) => t.stop());
  } catch {
    /* 忽略 stop 异常 */
  }
}

onUnmounted(() => {
  if (recording.value) stop();
});
</script>

<template>
  <div class="rec">
    <t-button :theme="recording ? 'danger' : 'default'" variant="outline" @click="recording ? stop() : start()">
      {{ recording ? "停" : "开始录音" }}
    </t-button>
    <div class="meter">
      <div class="track" aria-hidden="true">
        <div class="fill" :class="{ live: recording }" :style="{ width: `${bar}%` }" />
      </div>
      <span class="sec mono">{{ seconds }}s / 15s</span>
    </div>
    <span v-if="done && !recording" class="ok">这段已录好，保存时会入库</span>
    <span v-if="error" class="err">{{ error }}</span>
  </div>
</template>

<style scoped>
.rec {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.meter {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 180px;
  flex: 1;
}
.track {
  flex: 1;
  height: 6px;
  background: var(--input);
  border-radius: 99px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--cue);
  border-radius: 99px;
}
.fill.live {
  background: var(--tally);
}
.sec {
  font-size: 12px;
  color: var(--muted);
  flex: none;
}
.hint,
.err,
.ok {
  font-size: 12px;
}
.err {
  color: var(--danger);
}
.ok {
  color: var(--ok);
}
</style>
