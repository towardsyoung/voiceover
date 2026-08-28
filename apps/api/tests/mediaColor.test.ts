import assert from "node:assert/strict";
import test from "node:test";
import { buildLabCorrections, type VideoRegionStats } from "../src/services/media.js";

function regions(value: [number, number, number]): VideoRegionStats {
  return {
    neutral: [...value],
    skin: [...value],
    wall: [...value],
    global: [...value],
  };
}

test("buildLabCorrections is neutral for matching regional statistics", () => {
  const stats = regions([60, 5, 10]);
  assert.deepEqual(buildLabCorrections(stats, stats), regions([0, 0, 0]));
});

test("buildLabCorrections keeps regional corrections separate", () => {
  const reference = regions([60, 5, 10]);
  const target = regions([57, 6, 12]);
  target.skin = [55, 8, 14];

  const correction = buildLabCorrections(reference, target);
  assert.deepEqual(correction.neutral, [3, -1, -2]);
  assert.deepEqual(correction.skin, [5, -3, -4]);
});

test("buildLabCorrections clamps unsafe Lab shifts", () => {
  const correction = buildLabCorrections(regions([100, 50, 50]), regions([0, -50, -50]));
  assert.deepEqual(correction.neutral, [8, 6, 6]);
  assert.deepEqual(correction.global, [8, 6, 6]);
});
