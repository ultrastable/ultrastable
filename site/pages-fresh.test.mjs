// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// PAGES-FRESH-1: a bundled page is stale when a merged change is more than an hour newer than the bundle it was built from.
import test from "node:test";
import assert from "node:assert/strict";
import { overlay } from "./live.js";

const NOW = Date.parse("2026-11-18T14:00:00Z");
const tick = (mergedAt) => ({ fetch: async () => new Response(JSON.stringify({ refreshed_at: "2026-11-18T13:50:00Z", changes: [{ n: 1, title: "t", by: "x", url: "u", merged_at: mergedAt }] })) });
const gen = "2026-11-18T03:00:00Z";

test("bundle built at the newest merge is fresh", async () => {
  const d = await overlay({}, { TICK: tick("2026-11-18T13:00:00Z") }, gen, NOW, "2026-11-18T13:00:05+00:00");
  assert.equal(d.freshness.pages.stale, false); assert.equal(d.freshness.ok, true);
});
test("a merge more than an hour newer than the bundle makes the pages stale", async () => {
  const d = await overlay({}, { TICK: tick("2026-11-18T13:00:00Z") }, gen, NOW, "2026-11-18T10:00:00+00:00");
  assert.equal(d.freshness.pages.stale, true); assert.equal(d.freshness.pages.behind_s, 10800); assert.equal(d.freshness.ok, false);
});
test("a bundle with no build time is stale, never assumed fresh", async () => {
  const d = await overlay({}, { TICK: tick("2026-11-18T13:00:00Z") }, gen, NOW, null);
  assert.equal(d.freshness.pages.stale, true);
});
