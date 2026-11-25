// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { kgraphStep, readKgraph, judge, KGRAPH_DDL, _reset } from '../src/kgraph.js';
import { ensureItem } from '../src/tick.js';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const P = [{ source: 't' }];
const graph = (n = 12, lastRun = NOW - 3600e3) => ({ version: 'kg/1', nodes: Array.from({ length: n }, (_, i) => ({ id: 'n' + i, kind: i % 2 ? 'a' : 'b', label: 'N' + i, provenance: P })),
  edges: Array.from({ length: n - 1 }, (_, i) => ({ src: 'n' + i, rel: 'r', dst: 'n' + (i + 1), provenance: P })), upkeep: { last_run: lastRun ? new Date(lastRun).toISOString() : null } });
const fetchOf = body => async () => ({ ok: true, text: async () => JSON.stringify(body) });
const config = { progress: { systems: [{ id: 'a', name: 'A', knowledge_graph: { url: 'https://a/graph.json' } }, { id: 'b', name: 'B' }] } };

test('the Worker DDL equals the migration, and the migration is listed', () => {
  const sql = readFileSync(new URL('../migrations/0031_kgraph.sql', import.meta.url), 'utf8');
  for (const d of KGRAPH_DDL) assert.ok(sql.includes(d), d.slice(0, 50));
  assert.ok(JSON.parse(readFileSync(new URL('../migrations/index.json', import.meta.url), 'utf8')).includes('0031_kgraph.sql'));
});

test('judge: invalid, empty, stale and healthy', () => {
  assert.equal(judge({ version: 'x' }).state, 'invalid');
  const bad = graph(); bad.edges.push({ src: 'n0', rel: 'r', dst: 'ghost', provenance: P });
  assert.equal(judge(bad, { now: NOW }).state, 'invalid');
  assert.equal(judge(graph(3), { now: NOW }).state, 'empty');
  assert.equal(judge(graph(12, NOW - 10 * 3600e3), { now: NOW }).state, 'stale');
  assert.equal(judge(graph(12, null), { now: NOW }).state, 'stale');
  assert.equal(judge(graph(), { now: NOW }).state, 'healthy');
});

test('an undeclared or broken graph files KG-<id>; the same reading closes it when healthy; a healthy graph is not re-read inside every_hours', async () => {
  _reset(); const db = makeDb();
  let r = await kgraphStep({ db, config, ensureItem, fetchImpl: async () => ({ ok: false, status: 503 }), now: NOW });
  assert.equal(r.systems.a, 'unreadable'); assert.equal(r.systems.b, 'undeclared'); assert.deepEqual(r.filed.sort(), ['KG-a', 'KG-b']);
  const it = await db.prepare(`SELECT title, closing_probe FROM items WHERE id = ?`).bind('KG-b').first();
  assert.match(it.title, /no knowledge graph/); assert.equal(it.closing_probe, 'kgraph:b');
  r = await kgraphStep({ db, config, ensureItem, fetchImpl: fetchOf(graph()), now: NOW + 60e3 });
  assert.equal(r.systems.a, 'healthy'); assert.deepEqual(r.closed, ['KG-a']);
  let calls = 0;
  r = await kgraphStep({ db, config, ensureItem, fetchImpl: async () => { calls++; return { ok: true, text: async () => '{}' }; }, now: NOW + 120e3 });
  assert.deepEqual(r.skipped, ['a']); assert.equal(calls, 0);
  const k = await readKgraph(db);
  const a = k.systems.find(s => s.system === 'a'); assert.equal(a.nodes, 12); assert.equal(a.series.length, 1); assert.ok(a.summary.central.length);
  assert.equal(k.systems.find(s => s.system === 'b').state, 'undeclared');
});

test('config.kgraph (doctrine/knowledge-graph.json) lists every system; a row without a url is undeclared', async () => {
  _reset(); const db = makeDb();
  const doc = JSON.parse(readFileSync(new URL('../../../doctrine/knowledge-graph.json', import.meta.url), 'utf8'));
  const r = await kgraphStep({ db, config: { kgraph: doc }, ensureItem, fetchImpl: fetchOf(graph()), now: NOW });
  for (const s of doc.systems) assert.equal(r.systems[s.id], s.url ? 'healthy' : 'undeclared', s.id);
});
