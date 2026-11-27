// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-27: the typed knowledge graph with provenance (core/kgraph/index.js) and its snapshot analytics (core/kgraph/insight.js, contract kg/1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraph } from './index.js';
import * as I from './insight.js';

const mem = () => { const m = new Map(); return { m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
const P = { source: 'test', url: 'https://example.org/a', at: '2026-11-17' };
const PV = [{ source: 'test' }];
const n = (id, kind, label, props) => ({ id, kind, label: label || id, props, provenance: PV });
const e = (src, rel, dst, weight) => ({ src, rel, dst, weight, provenance: PV });

test('US-27-R38: a node needs an id and a kind, an edge needs both ends, and a confirmed edge needs provenance while a lead does not', async () => {
  const g = createGraph({ store: mem() });
  await assert.rejects(() => g.addNode({ id: 'x' }), /node needs id and kind/); await assert.rejects(() => g.addNode({ kind: 'k' }), /node needs id and kind/);
  await g.addNode({ id: 'a', kind: 'k', label: 'A', props: { x: 1 }, provenance: P }); await g.addNode({ id: 'b', kind: 'k' });
  assert.equal((await g.node('b')).label, 'b', 'the label defaults to the id');
  const merged = await g.addNode({ id: 'a', kind: 'k', props: { y: 2 }, provenance: { source: 'second' } });
  assert.deepEqual([merged.label, merged.props, merged.provenance.length], ['A', { x: 1, y: 2 }, 2], 'a node merges props and provenance and keeps its label');
  await assert.rejects(() => g.addEdge({ src: 'a', rel: 'r', dst: 'nope', provenance: P }), /has a missing end/);
  await assert.rejects(() => g.addEdge({ src: 'a', rel: 'r', dst: 'b' }), /confirmed edge needs provenance; use propose\(\) for a lead/);
  const lead = await g.propose({ src: 'a', rel: 'r', dst: 'b', why: 'looks alike' }); assert.equal(lead.status, 'proposed');
  await assert.rejects(() => g.confirm({ src: 'a', rel: 'r', dst: 'b' }), /confirming needs provenance/); await assert.rejects(() => g.confirm({ src: 'a', rel: 'r', dst: 'zz', provenance: P }), /no such edge/);
  const c = await g.confirm({ src: 'a', rel: 'r', dst: 'b', provenance: P }); assert.deepEqual([c.status, c.why, c.provenance.length], ['confirmed', 'looks alike', 1]);
  const again = await g.propose({ src: 'a', rel: 'r', dst: 'b' }); assert.equal(again.status, 'confirmed', 'a lead never demotes a confirmed edge');
  assert.equal((await g.addEdge({ src: 'a', rel: 'r', dst: 'b' })).status, 'confirmed', 'an edge already confirmed may be restated without new provenance');
  assert.equal((await g.edges()).length, 1); assert.equal((await g.edges({ status: 'proposed' })).length, 0); assert.equal((await g.edges({ status: 'any' })).length, 1);
  const copy = await g.node('a'); copy.label = 'changed'; assert.equal((await g.node('a')).label, 'A', 'results are copies'); assert.equal(await g.node('nope'), null);
});

test('US-27-R39: gaps are the nodes of a kind that lack a confirmed relation, a lead never fills one, and each gap becomes a question in the tenant\'s wording in a stable order', async () => {
  const g = createGraph({ store: mem() });
  for (const [id, kind] of [['p:a', 'problem'], ['p:b', 'problem'], ['s:x', 'solution'], ['s:y', 'solution'], ['g:1', 'agency'], ['z:1', 'other']]) await g.addNode({ id, kind, label: id.toUpperCase(), provenance: P });
  await g.addEdge({ src: 's:x', rel: 'addresses', dst: 'p:a', provenance: P }); await g.addEdge({ src: 'z:1', rel: 'addresses', dst: 'p:b', provenance: P });
  const R = [{ id: 'unsolved', kind: 'problem', lacks: { rel: 'addresses', dir: 'in', to: 'solution' }, ask: x => `What works against ${x.label}?` },
    { id: 'unadopted', kind: 'solution', lacks: { rel: 'implementable_by', to: 'agency' }, ask: x => `Who can implement ${x.label}?` }];
  assert.deepEqual((await g.gaps(R)).map(x => `${x.rule}:${x.node}`).sort(), ['unadopted:s:x', 'unadopted:s:y', 'unsolved:p:b'], '`to` limits the kind at the other end: z:1 is not a solution');
  await g.propose({ src: 's:x', rel: 'implementable_by', dst: 'g:1' }); assert.equal((await g.gaps(R)).length, 3, 'a lead fills no gap');
  assert.deepEqual((await g.questions(R)).map(q => [q.id, q.subject, q.rule, q.text]), [['unadopted:s:x', 's:x', 'unadopted', 'Who can implement S:X?'], ['unadopted:s:y', 's:y', 'unadopted', 'Who can implement S:Y?'], ['unsolved:p:b', 'p:b', 'unsolved', 'What works against P:B?']]);
  await g.confirm({ src: 's:x', rel: 'implementable_by', dst: 'g:1', provenance: P });
  assert.equal((await g.gaps(R)).some(x => x.node === 's:x'), false);
  await assert.rejects(() => g.gaps([{ kind: 'problem', lacks: { rel: 'x' } }]), /a rule needs id, kind and lacks\.rel/); await assert.rejects(() => g.gaps([{ id: 'a', kind: 'problem' }]), /a rule needs id/);
  await assert.rejects(() => g.questions([{ id: 'a', kind: 'problem', lacks: { rel: 'x' } }]), /rule a needs ask\(node\)/);
});

test('US-27-R40: neighbours, backlinks and bounded reach follow confirmed edges, validate names what is broken, and the graph survives the store and an export', async () => {
  const store = mem(), g = createGraph({ store });
  for (let i = 1; i <= 5; i++) await g.addNode({ id: 'n' + i, kind: 'k' });
  for (let i = 1; i <= 4; i++) await g.addEdge({ src: 'n' + i, rel: 'r', dst: 'n' + (i + 1), provenance: P });
  await g.propose({ src: 'n1', rel: 'r', dst: 'n5' });
  assert.deepEqual((await g.neighbors('n2')).map(x => x.node.id), ['n3']); assert.deepEqual((await g.neighbors('n2', { dir: 'in' })).map(x => x.node.id), ['n1']);
  assert.deepEqual((await g.neighbors('n1', { status: 'any' })).map(x => x.node.id).sort(), ['n2', 'n5']);
  assert.deepEqual((await g.reach('n1')).map(x => [x.node.id, x.distance]), [['n2', 1], ['n3', 2], ['n4', 3]], 'three hops by default, over confirmed edges, outward');
  assert.deepEqual((await g.reach('n1', { depth: 4 })).map(x => x.node.id), ['n2', 'n3', 'n4', 'n5']); assert.equal((await g.reach('n1', { limit: 2 })).length, 2, 'the start node does not count towards the limit');
  assert.deepEqual((await g.reach('n1', { rels: ['other'] })), []);
  assert.deepEqual(await g.stats(), { nodes: { k: 5 }, edges: { 'r:confirmed': 4, 'r:proposed': 1 } });
  assert.deepEqual(await g.validate(), []);
  const raw = JSON.parse(store.m.get('kgraph:v1')); raw.edges['n1|bad|ghost'] = { src: 'n1', rel: 'bad', dst: 'ghost', status: 'confirmed', provenance: [] }; raw.edges['n2|bare|n3'] = { src: 'n2', rel: 'bare', dst: 'n3', status: 'confirmed', provenance: [] };
  store.m.set('kgraph:v1', JSON.stringify(raw));
  assert.deepEqual((await g.validate()).map(x => `${x.kind}:${x.edge}`).sort(), ['dangling:n1|bad|ghost', 'no_provenance:n1|bad|ghost', 'no_provenance:n2|bare|n3']);
  const other = createGraph({ store }); await g.addNode({ id: 'late', kind: 'k' }); assert.ok(await other.node('late'), 'two instances on one store see each other\'s writes');
  const clean = createGraph({ store: mem() }); await clean.addNode({ id: 'a', kind: 'k' }); await clean.addNode({ id: 'b', kind: 'k' }); await clean.addEdge({ src: 'a', rel: 'r', dst: 'b', provenance: P });
  const copy = createGraph({ store: mem() }); assert.deepEqual(await copy.import(await clean.export()), { nodes: { k: 2 }, edges: { 'r:confirmed': 1 } });
  const alt = createGraph({ store, key: 'mine' }); assert.equal((await alt.nodes()).length, 0, 'a graph lives under its own key in the store'); await alt.addNode({ id: 'z', kind: 'k' }); assert.equal((await g.nodes()).some(x => x.id === 'z'), false);
});

test('US-27-R41: a kg/1 snapshot is validated for its shape, duplicate ids, missing provenance and dangling edges, and a fact without provenance is a problem, never accepted silently', () => {
  assert.equal(I.VERSION, 'kg/1');
  assert.deepEqual(I.validate({ nodes: 'x', edges: [] }), [{ kind: 'shape', detail: 'nodes and edges must be arrays' }]); assert.equal(I.validate(null)[0].kind, 'shape');
  const snap = { nodes: [n('a', 'k'), n('a', 'k'), { id: 'b' }, { id: 'c', kind: 'k' }], edges: [e('a', 'r', 'zz'), { src: 'a', rel: 'r', dst: 'c' }] };
  assert.deepEqual(I.validate(snap), [{ kind: 'duplicate', id: 'a' }, { kind: 'node_shape', id: 'b' }, { kind: 'no_provenance', id: 'b' }, { kind: 'no_provenance', id: 'c' }, { kind: 'dangling', id: 'a|r|zz' }, { kind: 'no_provenance', id: 'a|r|c' }]);
  assert.deepEqual(I.validate({ nodes: [n('a', 'k'), n('b', 'k')], edges: [e('a', 'r', 'b')] }), []);
  const bad = I.analyze({ nodes: 1, edges: [] }); assert.deepEqual([bad.ok, bad.insights, bad.version], [false, [], 'kg/1']);
  assert.equal(I.analyze({ nodes: [n('a', 'k'), { id: 'b', kind: 'k' }], edges: [] }).ok, false, 'analysis runs, and reports ok: false while a problem stands');
  assert.equal(I.edgeKey({ src: 'a', rel: 'r', dst: 'b' }), 'a|r|b'); assert.equal(I.hash('abc'), I.hash('abc')); assert.notEqual(I.hash('abc'), I.hash('abd')); assert.match(I.hash('x'), /^[0-9a-f]{8}$/);
});

test('US-27-R42: bitemporal upkeep reports what is new, changed, kept, retired and revived, and a fact that vanishes is retired with a time, never deleted', () => {
  const s1 = { nodes: [n('a', 'k', 'A'), n('b', 'k', 'B')], edges: [e('a', 'r', 'b')] };
  const one = I.sync({}, s1, 1000); assert.deepEqual(one.moved, { added: ['n:a', 'n:b', 'e:a|r|b'], changed: [], retired: [], revived: [], kept: 0 });
  assert.equal(one.state['n:a'].first_seen, '1970-01-01T00:00:01.000Z'); assert.equal(one.state['n:a'].retired_at, null);
  const s2 = { nodes: [n('a', 'k', 'A2'), n('b', 'k', 'B')], edges: [] };
  const two = I.sync(one.state, s2, 2000); assert.deepEqual(two.moved, { added: [], changed: ['n:a'], retired: ['e:a|r|b'], revived: [], kept: 1 });
  assert.equal(two.state['e:a|r|b'].retired_at, '1970-01-01T00:00:02.000Z'); assert.equal(two.state['e:a|r|b'].first_seen, '1970-01-01T00:00:01.000Z', 'history stays readable');
  assert.equal(two.state['n:a'].first_seen, '1970-01-01T00:00:01.000Z', 'a changed fact keeps its first_seen');
  const three = I.sync(two.state, s2, 3000); assert.deepEqual(three.moved, { added: [], changed: [], retired: [], revived: [], kept: 2 }); assert.equal(three.state['e:a|r|b'].retired_at, '1970-01-01T00:00:02.000Z', 'a retired fact is not retired twice');
  const back = I.sync(three.state, { nodes: s2.nodes, edges: s1.edges }, 4000); assert.deepEqual(back.moved.revived, ['e:a|r|b']);
  assert.deepEqual([back.state['e:a|r|b'].first_seen, back.state['e:a|r|b'].retired_at], ['1970-01-01T00:00:04.000Z', null], 'a revived fact is new from the day it returned');
  assert.equal(Object.keys(back.state).length, 3, 'nothing was ever removed from the state');
});

const cliques = () => {
  const k = (p, c) => { const ids = Array.from({ length: c }, (_, i) => p + i), es = []; for (let i = 0; i < c; i++) for (let j = i + 1; j < c; j++) es.push(e(ids[i], 'rel', ids[j])); return { ids, es }; };
  const A = k('a', 4), B = k('b', 4);
  return { nodes: [...A.ids, ...B.ids, 'x'].map(id => n(id, id === 'x' ? 'hub' : id[0] === 'a' ? 'left' : 'right')), edges: [...A.es, ...B.es, e('x', 'rel', 'a0'), e('x', 'rel', 'a1'), e('x', 'rel', 'b0'), e('x', 'rel', 'b1')] };
};

test('US-27-R43: analysis ranks link, disagreement, bridge, gap and tenant-specific insights with stable ids, a prediction and a closing probe each', () => {
  const papers = { nodes: [n('p1', 'paper'), n('p2', 'paper'), n('p3', 'paper'), n('a1', 'author'), n('a2', 'author'), n('a3', 'author'), n('t1', 'topic')],
    edges: [e('p1', 'by', 'a1'), e('p2', 'by', 'a1'), e('p2', 'by', 'a2'), e('p3', 'by', 'a2'), e('p1', 'on', 't1'), e('p3', 'on', 't1')] };
  const spec = { links: [{ id: 'pp', kinds: ['paper', 'paper'] }], gaps: [{ id: 'g1', kind: 'author', lacks: { rel: 'by', dir: 'in' } }, { id: 'g2', kind: 'author', lacks: { rel: 'cites', dir: 'in' }, ask: x => `Who cites ${x.label}?` }] };
  const a = I.analyze(papers, spec, { now: 0 });
  assert.deepEqual([a.ok, a.version, a.at], [true, 'kg/1', '1970-01-01T00:00:00.000Z']); assert.deepEqual(a.stats, { nodes: 7, edges: 6, kinds: { paper: 3, author: 3, topic: 1 }, rels: { by: 4, on: 2 }, communities: 1 });
  const links = a.insights.filter(i => i.type === 'link'); assert.equal(links.length, 3);
  for (const i of links) { assert.match(i.id, /^link:[0-9a-f]{8}$/); assert.match(i.prediction, /^a link p\d ~ p\d is confirmed or rejected within 30 d$/); assert.match(i.probe, /^edge between p\d and p\d exists, or the lead is dismissed$/); assert.equal(i.score, 1.4427); }
  assert.ok(a.insights.some(i => i.type === 'gap' && i.title === 'Who cites a1?' && i.probe === 'a1 has a cites edge' && i.prediction === 'a1 gains a cites edge within 30 d'));
  assert.ok(a.insights.some(i => i.type === 'gap' && i.title === 'a3 lacks by'), 'a gap with no wording reads "<label> lacks <relation>"');
  for (let i = 1; i < a.insights.length; i++) assert.ok(a.insights[i - 1].score >= a.insights[i].score); assert.equal(JSON.stringify(I.analyze(papers, spec, { now: 0 })), JSON.stringify(a), 'the same snapshot gives the same insights and ids');
  assert.equal(I.analyze(papers, { ...spec, top: 2 }).insights.length, 2, 'top limits the list'); assert.ok(a.central.length <= 10 && a.central.every(c => c.id && c.label && c.kind && typeof c.pagerank === 'number'), 'the most central nodes by PageRank'); assert.ok(a.central[0].pagerank >= a.central.at(-1).pagerank);
  // a link across two communities is worth half as much again
  const c = cliques(), cross = I.analyze({ nodes: [...c.nodes, n('b9', 'right')], edges: [...c.edges, e('b9', 'rel', 'b2'), e('b9', 'rel', 'b3')] }, { links: [{ id: 'lr', kinds: ['left', 'right'], top: 5 }] });
  assert.ok(cross.insights.some(i => i.type === 'link' && i.why.includes('different communities')));
  // bridges: the node whose neighbours span the communities
  const br = I.analyze(c, { bridges: { top: 2, ask: (node, b) => `${node.label} spans ${b.communities}` } }).insights.filter(i => i.type === 'bridge');
  assert.ok(br.length >= 1 && br.length <= 2 && br[0].nodes[0] === 'x' && br[0].title === 'x spans 2' && /^Participation 0\.50 across 2 communities\.$/.test(br[0].why) && br[0].probe === 'participation of x >= 0.5');
  assert.equal(I.analyze(c, { bridges: { kinds: ['left'] } }).insights.filter(i => i.type === 'bridge').every(i => i.nodes[0][0] === 'a'), true);
  // disagreement: two studies on one subject with opposite recorded values
  const dis = I.analyze({ nodes: [n('s1', 'study', 's1', { verdict: 'supports' }), n('s2', 'study', 's2', { verdict: 'refutes' }), n('s3', 'study', 's3', { verdict: 'supports' }), n('topic', 'topic')], edges: ['s1', 's2', 's3'].map(s => e(s, 'tests', 'topic')) },
    { disagreements: [{ kind: 'study', via: 'tests', prop: 'verdict', opposite: [['supports', 'refutes']] }] }).insights.filter(i => i.type === 'disagree');
  assert.equal(dis.length, 2); assert.ok(dis.every(i => i.nodes.includes('topic') && i.nodes.includes('s2') && /explained by a recorded moderator within 30 d$/.test(i.prediction)));
  // tenant-specific readings are ranked with the rest
  let seen = null;
  const ex = I.analyze(papers, { extra: (snap, ctx) => { seen = Object.keys(ctx).sort(); return [{ type: 'custom', nodes: ['p1', 'a1'], score: 99, title: 'T', why: 'W', prediction: 'x', probe: 'y' }]; } }).insights;
  assert.deepEqual(seen, ['community', 'node', 'pagerank']); assert.deepEqual([ex[0].type, ex[0].title, ex[0].why, ex[0].prediction, ex[0].probe], ['custom', 'T', 'W', 'x', 'y']); assert.match(ex[0].id, /^custom:[0-9a-f]{8}$/);
});

test('US-27-R44: a ledger of insights over time says which are new, standing and gone, and an insight that returns is new again', () => {
  const ins = ids => ids.map(id => ({ id, title: 't-' + id }));
  const one = I.track({}, ins(['a', 'b']), 1000); assert.deepEqual(one.moved, { new: ['a', 'b'], standing: [], gone: [] });
  const two = I.track(one.state, ins(['b', 'c']), 2000); assert.deepEqual(two.moved, { new: ['c'], standing: ['b'], gone: ['a'] });
  assert.equal(two.state.a.gone_at, '1970-01-01T00:00:02.000Z'); assert.equal(two.state.b.first_seen, '1970-01-01T00:00:01.000Z'); assert.equal(two.state.b.last_seen, '1970-01-01T00:00:02.000Z');
  const three = I.track(two.state, ins(['b']), 3000); assert.deepEqual(three.moved.gone, ['c']); assert.equal(three.state.a.gone_at, '1970-01-01T00:00:02.000Z', 'an insight already gone is not marked gone again');
  const back = I.track(three.state, ins(['a']), 4000); assert.deepEqual(back.moved.new, ['a']); assert.deepEqual([back.state.a.first_seen, back.state.a.gone_at], ['1970-01-01T00:00:04.000Z', null]);
});

test('US-27-R43: a link across two communities scores half as much again, and a pair already linked by any relation is never a lead', () => {
  const c = cliques(), snap = { nodes: [...c.nodes, n('b9', 'right')], edges: [...c.edges, e('b9', 'rel', 'b2'), e('b9', 'rel', 'b3')] };
  const raw = I.linkPredict(snap, I.adjacency(snap), { kinds: ['left', 'right'], top: 5 });
  const links = I.analyze(snap, { links: [{ id: 'lr', kinds: ['left', 'right'], top: 5 }] }).insights.filter(i => i.type === 'link');
  assert.ok(links.length >= 1 && raw.length === links.length);
  const ratios = links.map(i => { const r = raw.find(x => [x.a, x.b].sort().join() === i.nodes.slice().sort().join()); return { ratio: +(i.score / r.score).toFixed(2), cross: i.why.includes('different communities') }; });
  assert.ok(ratios.every(x => x.ratio === (x.cross ? 1.5 : 1)), JSON.stringify(ratios));
  assert.ok(ratios.some(x => x.cross), 'the planted pair sits in two communities');
  // p1 and p2 share a1 and are already linked by another relation; p3 is not linked to either
  const papers = { nodes: [n('p1', 'paper'), n('p2', 'paper'), n('p3', 'paper'), n('a1', 'author')], edges: [e('p1', 'by', 'a1'), e('p2', 'by', 'a1'), e('p3', 'by', 'a1'), e('p1', 'cites', 'p2')] };
  const pairs = I.linkPredict(papers, I.adjacency(papers), { kinds: ['paper', 'paper'] }).map(x => [x.a, x.b].join('~')).sort();
  assert.deepEqual(pairs, ['p1~p3', 'p2~p3'], 'p1~p2 is already linked');
  assert.deepEqual(I.analyze(papers, { links: [{ id: 'pp', kinds: ['paper', 'paper'] }] }).insights.filter(i => i.type === 'link').map(i => i.nodes.join('~')).sort(), ['p1~p3', 'p2~p3']);
});

test('US-27-R43: a gap is worth one plus its PageRank share of the graph, a disagreement two plus the shared node\'s', () => {
  const papers = { nodes: [n('p1', 'paper'), n('p2', 'paper'), n('a1', 'author'), n('a2', 'author')], edges: [e('p1', 'by', 'a1'), e('p2', 'by', 'a1')] };
  const a = I.analyze(papers, { gaps: [{ id: 'g', kind: 'author', lacks: { rel: 'cites', dir: 'in' } }] }), pr = Object.fromEntries(a.central.map(c => [c.id, c.pagerank]));
  const gap = a.insights.filter(i => i.type === 'gap'); assert.equal(gap.length, 2);
  for (const g of gap) assert.ok(Math.abs(g.score - (1 + pr[g.nodes[0]] * 4)) < 1e-3, `${g.nodes[0]}: ${g.score}`);
  const s = [n('s1', 'study', 's1', { v: 'supports' }), n('s2', 'study', 's2', { v: 'refutes' }), n('topic', 'topic')];
  const d = I.analyze({ nodes: s, edges: ['s1', 's2'].map(x => e(x, 'tests', 'topic')) }, { disagreements: [{ kind: 'study', via: 'tests', prop: 'v', opposite: [['supports', 'refutes']] }] });
  const dis = d.insights.find(i => i.type === 'disagree'), p = d.central.find(c => c.id === 'topic').pagerank;
  assert.ok(Math.abs(dis.score - (2 + p * 3)) < 1e-3, String(dis.score));
});
