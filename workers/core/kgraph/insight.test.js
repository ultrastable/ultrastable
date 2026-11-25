// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, sync, adjacency, pagerank, communities, linkPredict, bridges, disagreements, gaps, analyze, track, VERSION } from './insight.js';

const P = [{ source: 'test', at: '2026-11-25' }];
const n = (id, kind, props = {}) => ({ id, kind, label: id.toUpperCase(), props, provenance: P });
const e = (src, rel, dst) => ({ src, rel, dst, provenance: P });
// Two clusters (programmes sharing an outcome and authors), joined by one shared author; p3 and p4 disagree on the same outcome.
function world() {
  return { version: VERSION, nodes: [n('p1', 'programme', { verdict: 'works' }), n('p2', 'programme', { verdict: 'works' }), n('p3', 'programme', { verdict: 'works' }),
    n('p4', 'programme', { verdict: 'harms' }), n('o1', 'outcome'), n('o2', 'outcome'), n('a1', 'author'), n('a2', 'author'), n('x', 'author'), n('lonely', 'programme')],
  edges: [e('p1', 'targets', 'o1'), e('p2', 'targets', 'o1'), e('p1', 'by', 'a1'), e('p2', 'by', 'a1'), e('p3', 'targets', 'o2'), e('p4', 'targets', 'o2'),
    e('p3', 'by', 'a2'), e('p4', 'by', 'a2'), e('p1', 'by', 'x'), e('p3', 'by', 'x'), e('p2', 'by', 'x')] };
}

test('validate flags dangling edges, missing provenance and duplicates', () => {
  const w = world(); assert.deepEqual(validate(w), []);
  w.edges.push({ src: 'p1', rel: 'by', dst: 'ghost', provenance: P }); w.nodes.push({ id: 'p1', kind: 'programme', provenance: [] });
  const k = validate(w).map(p => p.kind).sort();
  assert.deepEqual(k, ['dangling', 'duplicate', 'no_provenance']);
  assert.equal(validate({}).at(0).kind, 'shape');
});

test('sync is bitemporal: added, kept, changed, retired, revived; nothing deleted', () => {
  const w = world(), t0 = Date.parse('2026-11-25T00:00:00Z');
  const a = sync({}, w, t0); assert.equal(a.moved.added.length, w.nodes.length + w.edges.length);
  w.nodes[0].props.verdict = 'mixed'; const gone = w.edges.pop();
  const b = sync(a.state, w, t0 + 3600e3);
  assert.deepEqual(b.moved.changed, ['n:p1']); assert.equal(b.moved.retired.length, 1);
  assert.ok(b.state['e:' + `${gone.src}|${gone.rel}|${gone.dst}`].retired_at);
  w.edges.push(gone); const c = sync(b.state, w, t0 + 7200e3);
  assert.equal(c.moved.revived.length, 1); assert.equal(c.state['n:p2'].first_seen, a.state['n:p2'].first_seen);
});

test('pagerank sums to one and ranks the hub first; communities are deterministic', () => {
  const w = world(), adj = adjacency(w), pr = pagerank(adj);
  assert.ok(Math.abs([...pr.values()].reduce((x, y) => x + y, 0) - 1) < 1e-6);
  const c1 = communities(adj), c2 = communities(adjacency(world()));
  assert.deepEqual([...c1], [...c2]);
  assert.equal(c1.get('lonely'), 'lonely');
});

test('linkPredict proposes unlinked pairs by shared neighbours, never an existing link', () => {
  const w = world(), s = linkPredict(w, adjacency(w), { kinds: ['programme', 'programme'] });
  assert.ok(s.length); const top = s[0];
  assert.deepEqual([top.a, top.b], ['p1', 'p2']);  // share o1, a1 and x
  w.edges.push(e('p1', 'compared', 'p2'));
  assert.ok(!linkPredict(w, adjacency(w), { kinds: ['programme', 'programme'] }).some(x => x.a === 'p1' && x.b === 'p2'));
});

test('disagreements, gaps and bridges', () => {
  const w = world();
  assert.deepEqual(disagreements(w, { kind: 'programme', via: 'targets', prop: 'verdict', opposite: [['works', 'harms']] }), [{ a: 'p3', b: 'p4', shared: 'o2', values: ['works', 'harms'] }]);
  assert.deepEqual(gaps(w, [{ id: 'g', kind: 'programme', lacks: { rel: 'targets' } }]), [{ rule: 'g', node: 'lonely' }]);
  const adj = adjacency(w), br = bridges(adj, communities(adj), { minDegree: 2 });
  assert.ok(br.every(b => b.communities >= 2));
});

test('analyze ranks insights with stable ids, a prediction and a probe; track tells new from standing from gone', () => {
  const spec = { links: [{ id: 'pp', kinds: ['programme', 'programme'] }], disagreements: [{ id: 'd', kind: 'programme', via: 'targets', prop: 'verdict', opposite: [['works', 'harms']] }],
    gaps: [{ id: 'g', kind: 'programme', lacks: { rel: 'targets' }, ask: x => `${x.label} names no outcome` }] };
  const a = analyze(world(), spec), b = analyze(world(), spec);
  assert.ok(a.ok); assert.deepEqual(a.insights.map(i => i.id), b.insights.map(i => i.id));
  for (const i of a.insights) { assert.ok(i.prediction && i.probe && i.title); }
  assert.ok(a.insights.some(i => i.type === 'disagree')); assert.ok(a.insights.some(i => i.title === 'LONELY names no outcome'));
  assert.equal(a.stats.nodes, 10); assert.ok(a.central[0].pagerank > 0);
  const t1 = track({}, a.insights), t2 = track(t1.state, a.insights.slice(1));
  assert.equal(t1.moved.new.length, a.insights.length); assert.equal(t2.moved.gone.length, 1); assert.equal(t2.moved.standing.length, a.insights.length - 1);
  assert.equal(analyze({ nodes: 1 }).ok, false);
});

test('spec.extra adds tenant readings with stable ids', () => {
  const spec = { extra: (snap, { node }) => [{ type: 'carry', nodes: ['p1'], score: 9, title: node.get('p1').label + ' untested elsewhere', prediction: 'p', probe: 'q' }] };
  const a = analyze(world(), spec);
  assert.equal(a.insights[0].type, 'carry'); assert.equal(a.insights[0].title, 'P1 untested elsewhere'); assert.ok(a.insights[0].id.startsWith('carry:'));
});
