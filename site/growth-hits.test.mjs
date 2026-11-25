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
