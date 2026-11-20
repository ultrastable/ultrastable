// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// PROGRESS-1: the public progress reading counts merged changes per window and says how many the system started by itself.
import test from "node:test";
import assert from "node:assert/strict";
import { progressReading, progressResponse } from "./live.js";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const ch = (n, at, by) => ({ n, title: "change " + n, by, merged_at: at, url: "https://example.test/" + n });
const tick = body => ({ fetch: async () => new Response(JSON.stringify(body)) });

test("windows count merged changes and split them by who started them", () => {
  const b = progressReading({ refreshed_at: "2026-11-20T11:55:00Z", changes: [ch(3, "2026-11-20T09:00:00Z", "agent session"), ch(2, "2026-11-17T09:00:00Z", "unattended executor"), ch(1, "2026-11-01T09:00:00Z", "agent session"), ch(0, "2026-09-01T09:00:00Z", "other")] }, NOW);
  assert.equal(b.ok, true);
  assert.deepEqual(b.windows.day, { changes: 1, by_system: 0, by_sessions: 1, status: "moving" });
  assert.deepEqual(b.windows.week, { changes: 2, by_system: 1, by_sessions: 1, status: "moving" });
  assert.equal(b.windows.month.changes, 3);
  assert.equal(b.self_driven, true);
  assert.equal(b.newest.n, 3);
});

test("a week with no merged change is not progress, and a missing cache is not a reading", async () => {
  const still = await progressResponse({ TICK: tick({ refreshed_at: "2026-11-20T11:55:00Z", changes: [ch(1, "2026-11-01T09:00:00Z", "agent session")] }) }, NOW);
  assert.equal(still.status, 503);
  const b = await still.json();
  assert.equal(b.code, "no_progress"); assert.equal(b.windows.week.status, "still"); assert.equal(b.windows.month.status, "moving");
  assert.equal((await progressResponse({}, NOW)).status, 503);
  assert.equal(progressReading(null, NOW).code, "no_reading");
  assert.equal((await progressResponse({ TICK: tick({ refreshed_at: "2026-11-20T11:55:00Z", changes: [ch(9, "2026-11-20T11:00:00Z", "unattended executor")] }) }, NOW)).status, 200);
});
