// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { build, predict, insights, snapshot, run, resolve } from './index.js';
const R = (id, title, refs = [], extra = {}) => ({ id, kind: 'item', title, refs, source: 'test', at: '2026-01-01T00:00:00Z', ...extra });
const recs = [R('a', 'Clean cooking stoves'), R('a2', 'cooking stoves, clean'), R('b', 'Water chlorination', ['a']), R('c', 'Latrine subsidy', ['b']), R('d', 'Cash transfers', ['b'], { entities: ['World Bank'] }), R('e', 'Mobile money', ['d'], { entities: ['world bank'] }), R('z', 'Lonely item')];
test('entity resolution merges near-identical titles and keeps aliases', () => { const g = build({ records: recs }); assert.equal(resolve(recs).get('a2'), 'a'); assert.deepEqual(g.aliases.a, ['a2']); assert.equal(g.stats.merged, 1); });
test('entities from different spellings share one node; edges carry provenance', () => { const g = build({ records: recs }); assert.equal(g.stats.entities, 1); assert.ok(g.edges.every(e => e.source && e.at)); });
test('link prediction proposes unlinked pairs sharing neighbours, labelled lead', () => { const g = build({ records: recs }), L = predict(g); assert.ok(L.some(l => [l.a, l.b].sort().join() === 'c,d')); assert.ok(L.every(l => l.conf === 'lead')); });
test('incremental: second run reports only what changed', async () => {
  const mem = new Map(), store = { get: async k => mem.get(k) || null, put: async (k, v) => mem.set(k, v) };
  const first = await run({ records: recs, store, now: '2026-02-01T00:00:00Z' }); assert.ok(first.first);
  const again = await run({ records: recs, store, now: '2026-02-02T00:00:00Z' }); assert.ok(!again.insights.some(i => i.kind === 'graph_growth'));
  const more = await run({ records: [...recs, R('f', 'Graduation programmes', ['e'])], store, now: '2026-02-03T00:00:00Z' });
  assert.ok(more.insights.some(i => i.kind === 'graph_growth') && more.insights.some(i => i.kind === 'graph_new_links'));
});
test('orphans and hubs reported, every insight has kind, at and evidence', () => { const g = build({ records: recs }), ins = insights(g, null); assert.ok(ins.some(i => i.kind === 'graph_orphans')); assert.ok(ins.every(i => i.kind && i.at && Array.isArray(i.evidence))); });
test('snapshot is deterministic regardless of input order', () => assert.deepEqual(snapshot(build({ records: recs, now: 'x' })), snapshot(build({ records: [...recs].reverse(), now: 'x' }))));
