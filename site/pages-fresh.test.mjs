// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// PAGES-FRESH-1: a bundled page is stale when a merged change that altered behaviour is more than 26 h newer than the bundle (SUBSTANCE-1: data-only pushes no longer redeploy).
import test from "node:test";
import assert from "node:assert/strict";
import { overlay } from "./live.js";

const NOW = Date.parse("2026-11-18T14:00:00Z");
const tick = (mergedAt, substance = null) => ({ fetch: async () => new Response(JSON.stringify({ refreshed_at: "2026-11-18T13:50:00Z", changes: [{ n: 1, title: "t", by: "x", url: "u", merged_at: mergedAt, substance }] })) });
const gen = "2026-11-18T03:00:00Z";

test("bundle built at the newest merge is fresh", async () => {
  const d = await overlay({}, { TICK: tick("2026-11-18T13:00:00Z") }, gen, NOW, "2026-11-18T13:00:05+00:00");
  assert.equal(d.freshness.pages.stale, false); assert.equal(d.freshness.ok, true);
});
test("a behaviour change more than 26 h newer than the bundle makes the pages stale; trivial merges never do", async () => {
  const d = await overlay({}, { TICK: tick("2026-11-18T13:00:00Z") }, gen, NOW, "2026-11-17T10:00:00+00:00");
  assert.equal(d.freshness.pages.stale, true); assert.equal(d.freshness.pages.behind_s, 97200); assert.equal(d.freshness.ok, false);
  const t = await overlay({}, { TICK: tick("2026-11-18T13:00:00Z", "trivial") }, gen, NOW, "2026-11-17T10:00:00+00:00");
  assert.equal(t.freshness.pages.behind_s, null); assert.equal(t.freshness.pages.stale, false);
  const h = await overlay({}, { TICK: tick("2026-11-18T13:00:00Z") }, gen, NOW, "2026-11-18T10:00:00+00:00");
  assert.equal(h.freshness.pages.stale, false, "three hours behind is inside the daily data refresh");
});
test("a bundle with no build time is stale, never assumed fresh", async () => {
  const d = await overlay({}, { TICK: tick("2026-11-18T13:00:00Z") }, gen, NOW, null);
  assert.equal(d.freshness.pages.stale, true);
});

// LIVE-FRESH-2: the snapshot ingest writes parts into the site's own D1, part 0 last.
import { ingestTransparency } from "./deployer.js";
test("ingestTransparency writes part 0 last and rejects bad input", async () => {
  const calls = [];
  const db = { prepare: (q) => ({ bind: (...a) => ({ run: async () => calls.push([q.slice(0, 20), ...a]) }), run: async () => calls.push([q.slice(0, 20)]) }) };
  const mk = (b) => new Request("https://x/__internal/transparency", { method: "POST", body: JSON.stringify(b) });
  const ok = await ingestTransparency(mk({ generated: "2026-11-18T15:00:00Z", parts: ["a", "b", "c"] }), { DB: db });
  assert.equal(ok.status, 200);
  const inserts = calls.filter(c => c[0].startsWith("INSERT")).map(c => c[2]);
  assert.deepEqual(inserts, [1, 2, 0]);
  assert.equal((await ingestTransparency(mk({ generated: "nope", parts: ["a"] }), { DB: db })).status, 400);
});
