import assert from "node:assert/strict";
import test from "node:test";
import { env } from "../src/env.js";
import { MINIMAX_VIDEO_MODEL, MinimaxH3Provider } from "../src/providers/videoMinimax.js";

test("MiniMax uses the stable app model while sending the configured upstream model", async () => {
  const previousFetch = globalThis.fetch;
  const previousApiKey = env.minimaxApiKey;
  const previousBaseUrl = env.minimaxBaseUrl;
  const previousModel = env.minimaxModel;
  let sentBody: Record<string, unknown> | undefined;

  env.minimaxApiKey = "test-key";
  env.minimaxBaseUrl = "https://minimax.example.test";
  env.minimaxModel = "MiniMax-H3-free";
  globalThis.fetch = async (_input, init) => {
    sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ task_id: "task-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const provider = new MinimaxH3Provider();
    assert.equal(provider.supports(MINIMAX_VIDEO_MODEL), true);
    assert.equal(provider.supports(env.minimaxModel), false);

    const taskId = await provider.submit({
      model: MINIMAX_VIDEO_MODEL,
      prompt: "test prompt",
      images: [],
      videos: [],
      audios: [],
      durationSec: 10,
      aspectRatio: "16:9",
      resolution: "768P",
      generateAudio: true,
    });

    assert.equal(taskId, "task-1");
    assert.equal(sentBody?.model, "MiniMax-H3-free");
    assert.equal(sentBody?.resolution, "768P");
  } finally {
    globalThis.fetch = previousFetch;
    env.minimaxApiKey = previousApiKey;
    env.minimaxBaseUrl = previousBaseUrl;
    env.minimaxModel = previousModel;
  }
});

test("MiniMax poll treats fetch failed as unavailable instead of generation failed", async () => {
  const previousFetch = globalThis.fetch;
  const previousApiKey = env.minimaxApiKey;
  const previousBaseUrl = env.minimaxBaseUrl;
  env.minimaxApiKey = "test-key";
  env.minimaxBaseUrl = "https://minimax.example.test";
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  try {
    const poll = await new MinimaxH3Provider().poll("task-1");
    assert.equal(poll.status, "unavailable");
    if (poll.status === "unavailable") assert.equal(poll.message, "fetch failed");
  } finally {
    globalThis.fetch = previousFetch;
    env.minimaxApiKey = previousApiKey;
    env.minimaxBaseUrl = previousBaseUrl;
  }
});

test("MiniMax poll treats 5xx as unavailable", async () => {
  const previousFetch = globalThis.fetch;
  const previousApiKey = env.minimaxApiKey;
  const previousBaseUrl = env.minimaxBaseUrl;
  env.minimaxApiKey = "test-key";
  env.minimaxBaseUrl = "https://minimax.example.test";
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ task: { error: { message: "upstream 502" } } }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  try {
    const poll = await new MinimaxH3Provider().poll("task-1");
    assert.equal(poll.status, "unavailable");
  } finally {
    globalThis.fetch = previousFetch;
    env.minimaxApiKey = previousApiKey;
    env.minimaxBaseUrl = previousBaseUrl;
  }
});
