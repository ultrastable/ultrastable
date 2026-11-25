// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extract, analyze, predict, insights, settle, calibrate, neighborhood, SKIP_TABLE } from './index.js';

// A small world: findings, studies that test them, replications that cite a study in free text, fields, plus a secret table and a secret column.
const world = () => [
  { name: 'fields', rows: [{ id: 'psych', name: 'Psychology' }, { id: 'med', name: 'Medicine' }] },
  { name: 'findings', rows: [
    { id: 'F-ego', title: 'Ego depletion', field_id: 'psych' },
    { id: 'F-prime', title: 'Elderly priming', field_id: 'psych' },
    { id: 'F-hrt', title: 'HRT protects the heart', field_id: 'med' },
    { id: 'F-lone', title: 'A finding nobody links', field_id: null },
  ] },
  { name: 'studies', rows: [
    { id: 'S-1998', title: 'Baumeister 1998', finding: 'F-ego', reviewer_email: 'x@y.z' },
    { id: 'S-1996', title: 'Bargh 1996', finding: 'F-prime' },
    { id: 'S-whi', title: 'WHI trial', finding: 'F-hrt' },
  ] },
  { name: 'replications', rows: [
    { id: 'R-1', notes: 'Registered report of S-1998 across 23 labs; effect near zero, see also S-1996.', verdict: 'failed' },
    { id: 'R-2', notes: 'Direct replication of S-1996 with automated timing; no effect.', verdict: 'failed' },
  ] },
  { name: 'credentials', rows: [{ id: 'gh', token: 'ghs_secret' }] },
];

test('every row becomes a node, references are found from the data, ids in text become mentions, secrets are never read', () => {
  const g = extract(world());
  const ids = new Set(g.nodes.map(n => n.id));
  assert.ok(ids.has('findings:F-ego') && ids.has('replications:R-2') && ids.has('fields:psych'));
  assert.ok(!g.nodes.some(n => n.id.startsWith('credentials:')), 'credential table skipped');
  assert.ok(g.dropped.tables.includes('credentials'));
  assert.ok(g.dropped.columns.includes('studies.reviewer_email'));
  assert.ok(!JSON.stringify(g.nodes).includes('x@y.z') && !JSON.stringify(g).includes('ghs_secret'));
  const has = (s, r, d) => g.edges.some(e => e.src === s && e.rel === r && e.dst === d);
  assert.ok(has('findings:F-ego', 'field_id', 'fields:psych'), 'foreign key found by value');
  assert.ok(has('studies:S-1998', 'finding', 'findings:F-ego'));
  assert.ok(has('replications:R-1', 'mentions', 'studies:S-1998') && has('replications:R-1', 'mentions', 'studies:S-1996'), 'mentions in text');
  assert.equal(g.nodes.find(n => n.id === 'studies:S-1998').label, 'Baumeister 1998');
  assert.ok(SKIP_TABLE.test('oauth_tokens') && SKIP_TABLE.test('hits') && !SKIP_TABLE.test('findings'));
});

test('declared refs win, and a value shared by too many keys is not guessed', () => {
  const g = extract([{ name: 'a', rows: [{ id: 'x1', b: 'k' }] }, { name: 'b', rows: [{ id: 'k' }] }], { declared: { a: { refs: { b: 'b' } } } });
  assert.equal(g.edges[0].confidence, 1);
  const many = extract([{ name: 'p', rows: [{ id: 'aaa' }] }, { name: 'q', rows: [{ id: 'aaa' }] }, { name: 'r', rows: [{ id: 'aaa' }] }, { name: 's', rows: [{ id: 'aaa' }] }, { name: 't', rows: [{ id: 'z9', ref: 'aaa' }] }]);
  assert.equal(many.edges.filter(e => e.src === 't:z9').length, 0); assert.equal(many.dropped.ambiguous, 1);
});

test('analysis finds the hub, orphans, communities and components', () => {
  const g = extract(world()), a = analyze(g);
  assert.equal(a.nodes, g.nodes.length);
  assert.ok(a.orphans >= 1 && a.by_kind.findings.orphans === 1, 'F-lone is an orphan');
  assert.equal(a.hubs[0].id, 'studies:S-1996', 'cited by a study and two replications');
  assert.ok(a.components >= 3);
  assert.ok(a.communities.length >= 2);
});

test('link prediction proposes pairs with shared neighbours, never pairs already linked, and honours known pairs', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, kind: 'k', label: id }));
  const E = (src, dst) => ({ src, dst, rel: 'r' });
  const g = { nodes, edges: [E('a', 'c'), E('a', 'd'), E('b', 'c'), E('b', 'd'), E('e', 'c')] };
  const c = predict(g);
  assert.deepEqual(c.map(x => x.src + x.dst).sort(), ['ab', 'cd'], 'a and b share c and d; c and d share a and b');
  assert.ok(!c.some(x => (x.src === 'a' && x.dst === 'c')));
  assert.ok(!predict(g, { known: [{ src: 'b', dst: 'a' }] }).some(x => x.src === 'a' && x.dst === 'b'));
});

test('insights carry an id, a prediction in the scorer form and a probe; settle and calibrate close the loop', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: 'note-' + i, title: 'n' + i }));
  const g = extract([...world(), { name: 'notes', rows }]), a = analyze(g);
  const ins = insights({ analysis: a, candidates: [{ src: 'x', dst: 'y', score: 2, why: '2 shared neighbours' }], previous: { hubs: [], components: 1 } });
  const orphan = ins.find(i => i.id === 'orphans:notes');
  assert.ok(orphan && /< 0.5 within 168 h$/.test(orphan.prediction) && orphan.probe === 'datagraph:orphans:notes');
  assert.ok(ins.some(i => i.kind === 'link') && ins.some(i => i.kind === 'new-hub') && ins.some(i => i.kind === 'fragmenting'));
  const now = Date.parse('2026-12-20T00:00:00Z');
  const s = settle([{ src: 'findings:F-ego', dst: 'fields:psych', first_seen: '2026-11-25T00:00:00Z' }, { src: 'a', dst: 'b', first_seen: '2026-11-25T00:00:00Z' }, { src: 'c', dst: 'd', first_seen: '2026-12-19T00:00:00Z' }], g, { now });
  assert.deepEqual(s.map(x => x.outcome), ['kept', 'dropped', 'open']);
  assert.deepEqual(calibrate([{ kind: 'link', outcome: 'kept' }, { kind: 'link', outcome: 'dropped' }]).weights, { link: 1 }, 'unchanged below 3 outcomes');
  const w = calibrate(Array.from({ length: 6 }, () => ({ kind: 'link', outcome: 'dropped' }))).weights.link;
  assert.ok(w >= 0.5 && w < 1);
});

test('neighbourhood retrieval is bounded and keeps relations', () => {
  const g = extract(world()), n = neighborhood(g, 'findings:F-ego', { depth: 2 });
  assert.ok(n.nodes.some(x => x.id === 'replications:R-1' && x.distance === 2));
  assert.ok(n.edges.every(e => e.rel));
  assert.ok(neighborhood(g, 'fields:psych', { depth: 3, limit: 3 }).nodes.length <= 3);
});
