// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// GROWTH-HITS-1: the public aggregate counts the growth loop reads without a Cloudflare token.
import test from "node:test";
import assert from "node:assert/strict";
import { growthHits } from "./worker.js";

test("GROWTH-HITS-1 serves the four aggregates", async () => {
  const rows = [{ pv: 10, v: 4 }, { n: 7 }, { n: 2 }]; let i = 0;
  const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => rows[i++] }) }) } };
  const j = await (await growthHits(env, 0)).json();
  assert.deepEqual(j, { pageviews_7d: 10, visitors_7d: 4, agent_hits_7d: 7, pilot_page_views_7d: 2, window_days: 7 });
});

test("GROWTH-HITS-1 answers 503 without a database", async () => {
  assert.equal((await growthHits({})).status, 503);
});

test("READ-BUDGET-12 the window is milliseconds and a cached answer costs no database read", async () => {
  const bound = []; let reads = 0; const store = new Map();
  const env = { DB: { prepare: () => ({ bind: (w) => ({ first: async () => { bound.push(w); reads++; return { pv: 1, v: 1, n: 1 }; } }) }) } };
  const cache = { match: async (k) => (store.get(k.url) ? store.get(k.url).clone() : undefined), put: async (k, r) => { store.set(k.url, r); } };
  const now = 1.8e12;
  await growthHits(env, now, cache);
  assert.deepEqual(bound, [now - 7 * 86400e3, now - 7 * 86400e3, now - 7 * 86400e3]);
  assert.equal(reads, 3);
  const j = await (await growthHits(env, now, cache)).json();
  assert.equal(reads, 3, "the second call is served from the cache");
  assert.equal(j.pageviews_7d, 1);
});
