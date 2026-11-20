// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// PROGRESS-1: /progress, its digests and its feed show only what shipped, and say so plainly when the record cannot be read.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";
import { progressData } from "./progress.js";

const NOW = Date.now(), at = h => new Date(NOW - h * 3600e3).toISOString();
const base = { checked_at: at(0), systems: [
  { id: "ultrastable", name: "Ultrastable", url: "https://ultrastable.io", feed: "https://ultrastable.io/feed.xml", state: "moving", last_at: at(2), shipped_24h: 1, shipped_7d: 1 },
  { id: "tenant", name: "Tenant", url: "https://tenant.example", releases: "https://tenant.example/releases.json", state: "stalled", last_at: at(80), shipped_24h: 0, shipped_7d: 0 }],
  events: [{ id: "ultrastable#1", at: at(2), system: "ultrastable", system_name: "Ultrastable", title: "Add <progress> page", url: "https://gh/1", kind: "change" },
    { id: "ultrastable#2", at: at(3), system: "ultrastable", system_name: "Ultrastable", title: "lane: server-owned loops [skip ci]", url: "https://gh/2", kind: "change" }] };
const TICK = { fetch: async r => new URL(r.url).pathname === "/api/progress" ? Response.json(base) : new Response("no", { status: 404 }) };
const get = (p, env = { TICK }) => worker.fetch(new Request("https://ultrastable.io" + p), env, { waitUntil() {} });

test("the page lists merged changes with their time, marks nothing by itself and counts record-keeping apart", async () => {
  const r = await get("/progress"), t = await r.text();
  assert.equal(r.status, 200);
  assert.match(t, /Add &lt;progress&gt; page/);
  assert.match(t, /data-at="/);
  assert.match(t, /Plus 1 record-keeping merge/);
  assert.match(t, /Stalled; a repair item is open/);
  assert.match(t, /us-progress-visit/);
  assert.doesNotMatch(t, /class="[^"]*is-new/, "only the reader's own browser marks an item as new");
});

test("digests and the feed carry the same events; an unknown period is not served", async () => {
  const d = await (await get("/digest/daily.json")).json();
  assert.equal(d.period, "daily");
  assert.ok(d.items.some(e => e.id === "ultrastable#1"));
  assert.equal((await get("/digest/weekly")).status, 200);
  assert.equal((await get("/digest/hourly")).status, 404);
  const a = await get("/progress.atom"), x = await a.text();
  assert.match(a.headers.get("content-type"), /atom\+xml/);
  assert.match(x, /Add &lt;progress&gt; page/);
  assert.doesNotMatch(x, /server-owned loops/, "record-keeping merges stay out of the feed");
});

test("a tenant's releases and launched apps join from their own sources; an unreadable source adds nothing and is named", async () => {
  const rel = { releases: [{ version: "2026.11.20", date: at(5).slice(0, 10), counts: { solutions: 4, problems: 2 } }, { version: "bad", date: "soon" }] };
  const ok = await progressData({ TICK }, { fetchImpl: async () => Response.json(rel), spin: { live: [{ slug: "a", name: "A", tagline: "t", url: "https://a", launched: at(30) }, { slug: "b", name: "B" }] } });
  const r = ok.events.find(e => e.kind === "release");
  assert.equal(r.title, "Release 2026.11.20: 2 new problems, 4 new solutions");
  assert.equal(r.url, "https://tenant.example/releases#r-2026.11.20");
  assert.equal(ok.events.filter(e => e.kind === "release").length, 1);
  assert.equal(ok.apps.live, 1);
  assert.equal(ok.sources["releases:tenant"].ok, true);
  const bad = await progressData({ TICK }, { fetchImpl: async () => new Response("x", { status: 500 }), spin: { live: [] } });
  assert.equal(bad.sources["releases:tenant"].ok, false);
  assert.equal(bad.events.filter(e => e.kind === "release").length, 0);
});

test("without the live record the page and the feeds answer 503 and invent nothing", async () => {
  assert.equal((await get("/progress", {})).status, 503);
  const j = await get("/progress.json", {});
  assert.equal(j.status, 503);
  assert.equal((await j.json()).code, "progress_unavailable");
  assert.equal((await get("/progress.atom", {})).status, 503);
});
