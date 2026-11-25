// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// KGRAPH-1: the ledger's knowledge graph is built from every finding, attempt and lead, kept in D1, and served at /api/graph.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import seed from "./data/findings.json" with { type: "json" };
import { authorsOf, graphTick, graphApi, graphView, records, TENANT } from "./graph.js";
import { graphPage } from "./site.js";

function d1() {
  const raw = new DatabaseSync(":memory:");
  const stmt = sql => { let a = []; const o = { bind(...x) { a = x; return o; },
    async all() { return { results: raw.prepare(sql).all(...a).map(r => ({ ...r })) }; },
    async first() { const r = raw.prepare(sql).get(...a); return r ? { ...r } : null; },
    async run() { const r = raw.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; };
  return { raw, prepare: stmt, async batch(l) { for (const s of l) await s.run(); } };
}
const T0 = Date.UTC(2026, 11, 1);

test("authors are split per person; et al. and consortia are handled", () => {
  assert.deepEqual(authorsOf("Hagger MS, Chatzisarantis NLD, Alberts H, et al."), ["Hagger MS", "Chatzisarantis NLD", "Alberts H"]);
  assert.deepEqual(authorsOf("Open Science Collaboration"), ["Open Science Collaboration"]);
});

test("the graph holds every finding, links findings through shared researchers, and is quiet when nothing changed", async () => {
  const db = d1();
  db.raw.exec("CREATE TABLE leads (doi TEXT, finding_id TEXT, body TEXT, found_at TEXT)");
  db.raw.prepare("INSERT INTO leads VALUES (?,?,?,?)").run("10.9/x", seed.findings[0].id, JSON.stringify({ cite: { title: "A new test", year: 2026, doi: "10.9/x" } }), "2026-11-30");
  const recs = await records(db, seed);
  assert.equal(recs.filter(r => r.type === "finding").length, seed.findings.length);
  const r1 = await graphTick(db, seed, T0);
  assert.ok(!r1.error, r1.error); assert.ok(r1.nodes > seed.findings.length);
  const n = db.raw.prepare("SELECT COUNT(DISTINCT id) AS n FROM kg_nodes WHERE tenant=? AND kind='finding' AND retired_at IS NULL").get(TENANT).n;
  assert.equal(n, seed.findings.length);
  assert.ok(db.raw.prepare("SELECT 1 FROM kg_edges WHERE tenant=? AND rel='may_test'").get(TENANT), "a lead joins as a fact");
  assert.equal((await graphTick(db, seed, T0 + 60e3)).skipped, "recent");
  const r2 = await graphTick(db, seed, T0 + 3600e3); assert.equal(r2.added, 0);
  const h = await graphApi(new Request("https://r.test/api/graph/health"), db, T0 + 3600e3); assert.equal(h.status, 200);
  const v = await graphView(db, T0 + 3600e3);
  assert.ok(v.health.nodes > 0 && Array.isArray(v.insights) && /Source:/.test(v.method));
  const page = graphPage(v);
  assert.match(page, /<h1>Connections<\/h1>/); assert.match(page, /How the graph is kept honest/);
  assert.match(graphPage(null), /not been measured yet/);
});

test("the vendored engine stays equal to the core's", () => {
  let up; try { up = readFileSync(new URL("../../../seed/worker/src/knowledge.js", import.meta.url), "utf8"); } catch { return; }
  assert.equal(readFileSync(new URL("./vendor/knowledge.js", import.meta.url), "utf8"), up);
});
