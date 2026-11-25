// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { graphStep, readGraph, readLead, exportGraph, GRAPH_DDL, terms, mentions, _reset } from '../src/graph.js';
import { ensureItem } from '../src/tick.js';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const item = (db, id, title, o = 'staff') => db.prepare(`INSERT INTO items (id, title, owner_role, done_check) VALUES (?,?,?,?)`).bind(id, title, o, 'x').run();

test('the Worker DDL equals the migration, and the migration is listed', () => {
  const sql = readFileSync(new URL('../migrations/0031_graph.sql', import.meta.url), 'utf8');
  for (const d of GRAPH_DDL) assert.ok(sql.includes(d), d.slice(0, 50));
  assert.ok(JSON.parse(readFileSync(new URL('../migrations/index.json', import.meta.url), 'utf8')).includes('0031_graph.sql'));
});

test('extraction is deterministic: tags, paths and top terms', () => {
  assert.deepEqual(mentions('fix KGRAPH-1 in seed/worker/src/graph.js after Q-AUDIT-x'), ['tag:KGRAPH-1', 'tag:Q-AUDIT-x', 'file:seed/worker/src/graph.js']);
  assert.deepEqual(terms('cache cache misses on the cache path'), ['cache', 'misses', 'path']);
});

test('ingest is incremental: a second pass reads only new rows, and mentions join items', async () => {
  _reset(); const db = makeDb();
  await item(db, 'A-1', 'Cut D1 reads on the audit table by adding an index');
  await item(db, 'B-2', 'Follow up on A-1 with a probe for seed/worker/src/audit.js');
  let r = await graphStep({ db, now: NOW });
  assert.equal(r.ingested.items, 2);
  const e = await db.prepare(`SELECT 1 x FROM kg_edges WHERE src = 'tag:B-2' AND rel = 'mentions' AND dst = 'tag:A-1'`).first();
  assert.ok(e, 'mention edge joins the two items');
  assert.equal((await db.prepare(`SELECT kind FROM kg_nodes WHERE id = 'tag:A-1'`).first()).kind, 'item');
  r = await graphStep({ db, now: NOW + 60e3 });
  assert.equal(r.ingested.items, 0, 'nothing re-read');
  const g = await readGraph(db, { now: NOW + 60e3 });
  assert.equal(g.fresh, true); assert.equal(g.lag, 0); assert.ok(g.nodes >= 4);
});

test('look-alikes with no link become a lead, at most the daily cap are filed, and a later real link keeps the lead', async () => {
  _reset(); const db = makeDb();
  await item(db, 'X-1', 'Cloudflare D1 read scans cost money on the graph table');
  await item(db, 'Y-1', 'Graph table D1 read scans on Cloudflare cost too much money');
  const r = await graphStep({ db, ensureItem, config: { graph: { max_filed_per_day: 1 } }, now: NOW });
  assert.equal(r.leads.length, 1); assert.equal(r.filed.length, 1);
  const id = r.leads[0].id;
  assert.equal((await db.prepare(`SELECT kind FROM items WHERE id = ?`).bind(id).first()).kind, 'plus');
  assert.equal((await readLead(db, id)).status, 'open');
  await item(db, 'Z-1', 'Merge X-1 into Y-1');  // a real reference does not link X-1 and Y-1 directly
  await db.prepare(`INSERT INTO kg_edges (src, rel, dst, status, at) VALUES ('tag:X-1','duplicates','tag:Y-1','confirmed',?)`).bind(NOW).run();
  const r2 = await graphStep({ db, ensureItem, config: { graph: { max_filed_per_day: 1 } }, now: NOW + 3600e3 });
  assert.deepEqual(r2.kept, [id]);
  const g = await readGraph(db, { now: NOW + 3600e3 });
  assert.equal(g.yield, 1); assert.equal(g.kept, 1);
});

test('a pair that already shares a neighbour is not a lead', async () => {
  _reset(); const db = makeDb();
  await item(db, 'P-1', 'Rotate the social posting queue for KGRAPH-9 tenants');
  await item(db, 'P-2', 'Rotate social posting queue tenants for KGRAPH-9');
  const r = await graphStep({ db, ensureItem, now: NOW });
  assert.equal(r.leads.length, 0);
});

test('a missing source table is skipped, the export is bounded and an embedding failure never stops the pass', async () => {
  _reset(); const db = makeDb();
  await db.prepare('DROP TABLE IF EXISTS decision_log').run();
  await item(db, 'E-1', 'One two three four words here');
  const r = await graphStep({ db, ai: { run: async () => { throw new Error('quota'); } }, config: { graph: { embed: true } }, now: NOW });
  assert.ok(r.skipped.includes('decisions')); assert.match(r.embed_error, /quota/);
  const ex = await exportGraph(db, { limit: 2 });
  assert.equal(ex.nodes.length, 2); assert.ok(ex.truncated);
});
