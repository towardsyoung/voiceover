import assert from "node:assert/strict";
import test from "node:test";
import { ArkSeedanceProvider } from "../src/providers/videoArk.js";

test("Ark poll treats fetch failed as unavailable instead of generation failed", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  try {
    const poll = await new ArkSeedanceProvider().poll("cgt-1");
    assert.equal(poll.status, "unavailable");
    if (poll.status === "unavailable") assert.equal(poll.message, "fetch failed");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Ark poll returns succeeded video_url", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ status: "succeeded", content: { video_url: "https://cdn.example/v.mp4" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  try {
    const poll = await new ArkSeedanceProvider().poll("cgt-1");
    assert.equal(poll.status, "succeeded");
    if (poll.status === "succeeded") assert.equal(poll.url, "https://cdn.example/v.mp4");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
