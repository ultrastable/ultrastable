// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SITE-UPKEEP-1: free pass, weekly cadence, model cap, version keeping and restore.
import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL, fileURLToPath } from "node:url";
const U = await import(pathToFileURL(fileURLToPath(new URL("./upkeep.js", import.meta.url))).href);
const kv = () => { const m = new Map(); return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, String(v)); }, delete: async (k) => { m.delete(k); } }; };
const ID = "abcdef0123", T0 = new Date("2026-11-20T00:00:00Z"), DAY = 86400e3;
const bare = "<!doctype html><html><head><title>Club</title></head><body><h1>Chess club</h1></body></html>";
const full = '<!doctype html><html lang="en"><head><title>Club</title><meta name="description" content="x"><meta property="og:title" content="Club"><meta name="theme-color" content="#fff"></head><body>ok</body></html>';
const env = (html) => { const e = { ASSETS: kv() }; e.ASSETS.m.set("site:" + ID, html); e.ASSETS.m.set("state:" + ID, "ready"); e.ASSETS.m.set("brief:" + ID, JSON.stringify({ brief: "club site" })); return e; };

test("tidy adds what is missing and leaves a complete page alone", () => {
  const t = U.tidy(bare); assert.ok(t.fixed.includes("page description") && t.fixed.includes("social preview") && t.fixed.includes("page language"));
  assert.match(t.html, /name="description" content="Chess club"/);
  assert.deepEqual(U.tidy(full), { html: full, fixed: [] });
});
test("free pass keeps the old page as a version and spends no model call", async () => {
  const e = env(bare); let calls = 0;
  const r = await U.upkeepSite(e, ID, { now: T0, lint: () => [], improve: async () => { calls++; return full; } });
  assert.equal(r.kind, "free"); assert.equal(calls, 0);
  assert.equal((await U.versions(e, ID)).list.length, 1); assert.equal(e.ASSETS.m.get("ver:" + ID + ":1"), bare);
});
test("runs once a week, then a model pass on a rotating theme", async () => {
  const e = env(full), seen = [];
  const deps = (d) => ({ now: new Date(T0.getTime() + d * DAY), lint: () => [], improve: async (b, h, ins) => { seen.push(ins); return h + "<!--x-->"; } });
  assert.equal((await U.upkeepSite(e, ID, deps(0))).kind, "model");
  assert.equal((await U.upkeepSite(e, ID, deps(3))).skipped, "done this week");
  assert.equal((await U.upkeepSite(e, ID, deps(8))).kind, "model");
  assert.notEqual(seen[0], seen[1]);
});
test("a model answer that adds lint defects is not applied", async () => {
  const e = env(full);
  const r = await U.upkeepSite(e, ID, { now: T0, lint: (h) => (h.includes("BAD") ? ["x"] : []), improve: async () => full + "BAD" });
  assert.equal(r.kind, "none"); assert.equal(e.ASSETS.m.get("site:" + ID), full);
});
test("a failing model is recorded, not thrown", async () => {
  const e = env(full); const r = await U.upkeepSite(e, ID, { now: T0, lint: () => [], improve: async () => { throw new Error("down"); } });
  assert.equal(r.kind, "failed");
});
test("round caps model passes per tick", async () => {
  const e = { ASSETS: kv() }, ids = ["a000000001", "a000000002", "a000000003"];
  for (const i of ids) { e.ASSETS.m.set("site:" + i, full); e.ASSETS.m.set("state:" + i, "ready"); }
  const out = await U.upkeepRound(e, ids.map((i) => "state:" + i), { now: T0, lint: () => [], improve: async (b, h) => h + "<!--y-->" }, 2);
  assert.equal(out.filter((r) => r.kind === "model").length, 2);
});
test("only ten versions are kept and restore is itself undoable", async () => {
  const e = env("v0");
  for (let i = 1; i <= 12; i++) await U.recordVersion(e, ID, "page" + i, "change " + i, T0);
  const idx = await U.versions(e, ID); assert.equal(idx.list.length, 10); assert.equal(e.ASSETS.m.has("ver:" + ID + ":1"), false);
  const r = await U.restore(e, ID, 5, T0); assert.equal(r.ok, true); assert.equal(e.ASSETS.m.get("site:" + ID), "page5");
  assert.equal((await U.restore(e, ID, 999, T0)).ok, false);
  assert.match(U.historyBody(ID, await U.versions(e, ID), null), /Go back to this/);
});
test("insights count only human hits on the site's own path and the model pass follows visits", async () => {
  const { DatabaseSync } = await import("node:sqlite"); const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE hits(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, host TEXT, path TEXT, ref TEXT DEFAULT '', country TEXT DEFAULT '', device TEXT DEFAULT '', bot INTEGER DEFAULT 0, vid TEXT, name TEXT)");
  const ins = db.prepare("INSERT INTO hits(at,host,path,ref,country,device,bot,vid,name) VALUES(?,?,?,?,?,?,?,?,?)"), p = "/s/" + ID;
  ins.run(T0.getTime() - DAY, "h", p, "news.example", "NL", "mobile", 0, "a", "v"); ins.run(T0.getTime() - DAY, "h", p, "", "NL", "mobile", 1, "b", "v"); ins.run(T0.getTime() - DAY, "h", "/s/ffffffffff", "", "", "", 0, "c", "v");
  const d1 = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st; }, all: async () => ({ results: db.prepare(sql).all(...a) }) }; return st; } };
  const r = await U.insights(d1, ID, T0); assert.equal(r.views7, 1); assert.equal(r.refs[0].k, "news.example");
  assert.equal(await U.viewedRecently(d1, "ffffffffff", new Date(T0.getTime() + 40 * DAY)), false);
  const e = env(full); const out = await U.upkeepSite(e, ID, { now: T0, lint: () => [], improve: async (b, h) => h + "x", visited: async () => false }); assert.equal(out.kind, "none");
  assert.match(U.insightsBody(ID, r), /Where they came from/);
});
test("feed and badge describe what the system changed", async () => {
  const e = env("v0"); await U.recordVersion(e, ID, "a", "upkeep: added page description", T0);
  const idx = await U.versions(e, ID), f = U.siteFeed(ID, idx, "https://ultrastable.io", "Club <1>");
  assert.match(f, /<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/); assert.match(f, /After version 1: upkeep: added page description/); assert.match(f, /Club &lt;1&gt;/);
  assert.match(U.siteBadge(idx), /kept up: 1 change"/); assert.match(U.siteBadge({ list: [] }), /newly built/);
});
