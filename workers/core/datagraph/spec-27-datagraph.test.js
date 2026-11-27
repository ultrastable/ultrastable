// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-27 (knowledge graph, vector space and connection engine): the requirements of the data graph, proved through the public API of core/datagraph.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extract, analyze, predict, insights, settle, calibrate, neighborhood, DEFAULTS, SKIP_TABLE, SKIP_COL } from './index.js';

const N = ids => ids.map(id => ({ id, kind: 'k', label: id }));
const E = (src, dst, extra = {}) => ({ src, dst, rel: 'r', ...extra });

test('US-27-R01: every row becomes a node <table>:<key>, with the key, kind, label, props, hash and source the specification names', () => {
  const g = extract([
    { name: 'things', rows: [{ id: 'abc', title: 'T', name: 'N', gone: null, long: 'x'.repeat(300) }, { id: '', title: 'no key' }, { id: null }] },
    { name: 'byrid', rows: [{ _rid: 5, a: 'x' }] },
    { name: 'byfirst', rows: [{ foo: 'k1', bar: 2 }] },
    { name: 'declared', key: 'code', kind: 'widget', label: 'tag', rows: [{ id: 1, code: 'zz9', tag: 'Z nine' }] },
  ]);
  assert.deepEqual(g.nodes.map(n => n.id), ['things:abc', 'byrid:5', 'byfirst:k1', 'declared:zz9'], 'key: id, then _rid, then the first column, or the declared key; a row with no key is skipped');
  const t = g.nodes[0];
  assert.equal(t.kind, 'things'); assert.equal(t.label, 'T', 'the first label column present wins (title before name)'); assert.equal(t.source, 'd1:things');
  assert.ok(!('gone' in t.props), 'a null value is not kept'); assert.equal(t.props.long.length, 201, 'a long string is cut at 200 characters and marked');
  assert.match(t.hash, /^[0-9a-f]{8}$/);
  assert.equal(g.nodes[3].kind, 'widget'); assert.equal(g.nodes[3].label, 'Z nine');
  const same = extract([{ name: 'things', rows: [{ id: 'abc', title: 'T', name: 'N', long: 'x'.repeat(300) }] }]).nodes[0];
  assert.equal(same.hash, t.hash, 'the content hash is a function of the props only');
});

test('US-27-R02: secret-shaped and personal tables and columns are never read, and the graph says what it left out', () => {
  const g = extract([
    { name: 'oauth_tokens', rows: [{ id: 'gh', token: 'ghs_never' }] },
    { name: 'human_inbox', rows: [{ id: 'm1', body: 'a private reply' }] },
    { name: '_migrations', rows: [{ id: '1' }] },
    { name: 'kg_nodes', rows: [{ id: 'self' }] },
    { name: 'mine', rows: [{ id: 'm-1', title: 'ok', contact_email: 'a@b.c', api_key: 'sk-1', user_agent: 'x' }] },
    { name: 'skipme', rows: [{ id: 's-1' }] },
  ], { skip: ['skipme'] });
  assert.deepEqual(g.nodes.map(n => n.id), ['mine:m-1']);
  assert.deepEqual([...g.dropped.tables].sort(), ['_migrations', 'human_inbox', 'kg_nodes', 'oauth_tokens', 'skipme']);
  assert.deepEqual(g.dropped.columns, ['mine.api_key', 'mine.contact_email', 'mine.user_agent']);
  assert.ok(!JSON.stringify(g).includes('ghs_never') && !JSON.stringify(g).includes('a@b.c') && !JSON.stringify(g).includes('sk-1'));
  assert.ok(SKIP_TABLE.test('visitor_hits') && SKIP_TABLE.test('subscribers') && SKIP_COL.test('Password'));
  const e = extract([{ name: 'a', rows: [{ id: 'a-1', email: 'b-1' }] }, { name: 'b', rows: [{ id: 'b-1' }] }]);
  assert.equal(e.edges.length, 0, 'a skipped column never makes an edge either');
});

test('US-27-R03: a value equal to another row\'s key is an edge named after its column, with the confidence the specification gives', () => {
  const g = extract([
    { name: 'a', rows: [{ id: 'a-1', parent: 'b-1', other: 'b-2', plain: 'b-1', self: 'a-1', ghost: 'zzz-missing' }, { id: 'a-2', link: 'q' }] },
    { name: 'b', rows: [{ id: 'b-1' }, { id: 'b-2' }] },
    { name: 'c', rows: [{ id: 'c-1', ref: 'tgt-9' }] },
    { name: 'd', rows: [{ id: 'tgt-9' }, { id: 'tgt-8' }] },
  ]);
  const at = (s, r, d) => g.edges.find(e => e.src === s && e.rel === r && e.dst === d);
  assert.equal(at('a:a-1', 'parent', 'b:b-1').confidence, 0.95, 'a reference-shaped column name');
  assert.equal(at('a:a-1', 'other', 'b:b-2').confidence, 0.85);
  assert.equal(at('a:a-1', 'plain', 'b:b-1').confidence, 0.85);
  assert.equal(at('a:a-1', 'plain', 'b:b-1').source, 'value:a.plain');
  assert.ok(!g.edges.some(e => e.src === e.dst) && !g.edges.some(e => e.dst.includes('missing')), 'no edge to itself or to a row that does not exist');
  // a declared reference wins, with confidence 1, and works for a value the key index would not match
  const d = extract([{ name: 'x', rows: [{ id: 'x-1', b: 'k' }] }, { name: 'b', rows: [{ id: 'k' }] }], { declared: { x: { refs: { b: 'b' } } } });
  assert.deepEqual(d.edges.map(e => [e.rel, e.confidence, e.source]), [['b', 1, 'declared:x.b']]);
  // the same edge found twice keeps the higher confidence
  const dup = extract([{ name: 'x', rows: [{ id: 'x-1', b: 'bbb' }] }, { name: 'b', rows: [{ id: 'bbb' }] }], { declared: { x: { refs: { b: 'b' } } } });
  assert.equal(dup.edges.length, 1); assert.equal(dup.edges[0].confidence, 1);
});

test('US-27-R04: an ambiguous value, a bare number and a short value never make a guessed edge', () => {
  const same = ['p', 'q', 'r', 's'].map(name => ({ name, rows: [{ id: 'aaa' }] }));
  const many = extract([...same, { name: 't', rows: [{ id: 'z9', ref: 'aaa' }] }]);
  assert.equal(many.edges.filter(e => e.src === 't:z9').length, 0); assert.equal(many.dropped.ambiguous, 1, 'a value that names more than three keys is counted, not linked');
  const three = extract([...same.slice(0, 3), { name: 't', rows: [{ id: 'z9', ref: 'aaa' }] }]);
  assert.equal(three.edges.filter(e => e.src === 't:z9').length, 3, 'up to three owners of a value are all linked');
  const num = extract([{ name: 'a', rows: [{ id: 'a-1', n: '123', site_id: '123', total: '456' }] }, { name: 'b', rows: [{ id: '123' }, { id: '456' }] }]);
  assert.deepEqual(num.edges.map(e => e.rel), ['site_id'], 'a number links only through a reference-shaped column');
  const short = extract([{ name: 'a', rows: [{ id: 'a-1', ref: 'zz' }] }, { name: 'b', rows: [{ id: 'zz' }] }]);
  assert.equal(short.edges.length, 0, 'a key shorter than three characters is not indexed');
  const rid = extract([{ name: 'a', rows: [{ _rid: 1000, title: 'x', n: '1000', other_id: '1000' }] }, { name: 'b', rows: [{ _rid: 2000, t: 'y' }] }]);
  assert.equal(rid.edges.length, 0, 'a rowid is a position, never an identity another row can point at');
});

test('US-27-R05: an id written in a long text becomes a mentions edge, at most 12 per row, never from a number or a crowded name', () => {
  const targets = Array.from({ length: 20 }, (_, i) => ({ id: 'tgt-' + i }));
  const long = 'see ' + targets.map(t => t.id).join(' and ') + ' for the full story here';
  const g = extract([{ name: 'a', rows: [{ id: 'a-1', text: long }, { id: 'a-2', text: 'short tgt-1' }] }, { name: 'b', rows: targets }]);
  const from1 = g.edges.filter(e => e.src === 'a:a-1');
  assert.equal(from1.length, 12); assert.ok(from1.every(e => e.rel === 'mentions' && e.confidence === 0.6 && e.source === 'text:a.text'));
  assert.equal(g.edges.filter(e => e.src === 'a:a-2').length, 0, 'a text shorter than 24 characters is not scanned');
  const crowd = extract([...['p', 'q', 'r', 's'].map(name => ({ name, rows: [{ id: 'common-id' }] })), { name: 'a', rows: [{ id: 'a-1', text: 'this long sentence names common-id in the middle of it' }] }]);
  assert.equal(crowd.edges.length, 0, 'a token that names more than three rows is ignored');
});

test('US-27-R06: reads are bounded: rows per table, nodes in all, and what was dropped is counted', () => {
  assert.equal(DEFAULTS.maxRowsPerTable, 400); assert.equal(DEFAULTS.maxNodes, 20000); assert.equal(DEFAULTS.maxMentionsPerRow, 12); assert.equal(DEFAULTS.maxKeyFanout, 3);
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: 'id-' + i }));
  assert.equal(extract([{ name: 'a', rows }], { maxRowsPerTable: 6 }).nodes.length, 6);
  const g = extract([{ name: 'a', rows }], { maxNodes: 4, maxRowsPerTable: 8 });
  assert.equal(g.nodes.length, 4); assert.equal(g.dropped.nodes, 4, 'nodes beyond the cap are counted, not silently lost');
});

test('US-27-R07: analysis reads the undirected graph of confirmed edges and reports counts, components, orphans, hubs, communities and bridges', () => {
  const g = { nodes: N(['a', 'b', 'c', 'd']), edges: [E('a', 'b'), E('b', 'c', { status: 'proposed' }), E('c', 'd', { status: 'rejected' }), E('a', 'a'), E('c', 'a', { status: 'kept' })] };
  const a = analyze(g);
  assert.equal(a.nodes, 4); assert.equal(a.edges, 2, 'proposed and rejected edges and self edges are not structure; a kept edge is'); assert.equal(a.components, 2); assert.equal(a.orphans, 1);
  assert.equal(a.density, 0.333333); assert.deepEqual(a.by_kind.k, { nodes: 4, orphans: 1, edges: 4 });
  assert.deepEqual(a.hubs.map(h => h.id).slice(0, 1), ['a'], 'a has the most links'); assert.ok(a.hubs.length <= 10);
  assert.ok(a.communities.every(c => c.size > 1 && Array.isArray(c.kinds)));
  // a node whose neighbours sit in several communities is a bridge
  const clique = (p, n) => { const ids = Array.from({ length: n }, (_, i) => p + i), es = []; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) es.push(E(ids[i], ids[j])); return { ids, es }; };
  const A = clique('a', 5), B = clique('b', 5);
  const s = analyze({ nodes: N([...A.ids, ...B.ids, 'x']), edges: [...A.es, ...B.es, E('x', 'a0'), E('x', 'a1'), E('x', 'b0'), E('x', 'b1')] });
  assert.deepEqual(s.communities.map(c => c.size), [6, 5]);
  assert.ok(s.bridges.some(b => b.id === 'x' && b.communities === 2 && b.participation === 0.5 && b.degree === 4)); assert.ok(s.bridges.length <= 10);
  const empty = analyze({ nodes: [], edges: [] }); assert.equal(empty.nodes, 0); assert.equal(empty.density, 0);
});

test('US-27-R07: at most the 20 largest communities are reported, largest first', () => {
  // 25 separate pairs and one triangle: 26 communities of more than one node, so the triangle and 19 pairs are reported
  const pairs = Array.from({ length: 25 }, (_, i) => ['p' + String(i).padStart(2, '0') + 'a', 'p' + String(i).padStart(2, '0') + 'b']);
  const g = { nodes: N([...pairs.flat(), 't1', 't2', 't3']), edges: [...pairs.map(([a, b]) => E(a, b)), E('t1', 't2'), E('t2', 't3'), E('t1', 't3')] };
  const a = analyze(g);
  assert.equal(a.components, 26); assert.equal(a.communities.length, 20);
  assert.deepEqual(a.communities.map(c => c.size), [3, ...Array(19).fill(2)]);
  assert.equal(a.communities[0].id, 't2', 'the largest first'); assert.equal(a.communities[19].id, 'p18b', 'equal sizes in label order');
});

test('US-27-R08: the same graph in the same order always gives the same analysis, and the communities do not depend on the order rows arrive in', () => {
  const nodes = N(Array.from({ length: 30 }, (_, i) => 'n' + i)), edges = [];
  for (let i = 0; i < 30; i++) edges.push(E('n' + i, 'n' + ((i * 7 + 3) % 30)), E('n' + i, 'n' + ((i + 1) % 30)));
  const a = analyze({ nodes, edges }), b = analyze({ nodes: [...nodes].reverse(), edges: [...edges].reverse() });
  const byId = m => [...m].sort((x, y) => (x[0] < y[0] ? -1 : 1));
  assert.equal(JSON.stringify(analyze({ nodes, edges }).hubs), JSON.stringify(a.hubs)); assert.equal(JSON.stringify(analyze({ nodes, edges }).communities), JSON.stringify(a.communities), 'a second run gives the same bytes');
  assert.deepEqual(byId(a._community), byId(b._community), 'label propagation visits ids in sorted order and breaks ties toward the smallest label');
  const total = [...a._pagerank.values()].reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(total - 1) < 1e-6, 'PageRank is a distribution');
});

test('US-27-R09: link leads are Adamic-Adar scores over two-hop pairs, capped, and never a pair already linked or already known', () => {
  const one = predict({ nodes: N(['z', 'x', 'y']), edges: [E('z', 'x'), E('z', 'y')] });
  assert.equal(one.length, 1); assert.equal(one[0].rel, 'related'); assert.equal(one[0].score, 1.4427, 'one shared neighbour of degree two scores 1 / ln 2, which is enough');
  const three = predict({ nodes: N(['z', 'a', 'b', 'c']), edges: [E('z', 'a'), E('z', 'b'), E('z', 'c')] });
  assert.equal(three.length, 0, 'one shared neighbour of higher degree scores under 1 and is not evidence');
  const ids = ['hub1', 'hub2', ...Array.from({ length: 6 }, (_, i) => 'n' + i)], edges = [];
  for (let i = 0; i < 6; i++) edges.push(E('hub1', 'n' + i), E('hub2', 'n' + i));
  const g = { nodes: N(ids), edges }, p = predict(g), per = {};
  for (const x of p) { per[x.src] = (per[x.src] || 0) + 1; per[x.dst] = (per[x.dst] || 0) + 1; }
  assert.ok(Object.values(per).every(n => n <= 2), 'no node is in more than two leads, so a hub cannot fill the list');
  assert.equal(predict(g, { candidates: 2 }).length, 2);
  assert.ok(!predict(g, { known: [{ src: 'hub2', dst: 'hub1' }] }).some(x => [x.src, x.dst].sort().join() === 'hub1,hub2'));
  const many = Array.from({ length: 205 }, (_, i) => 'm' + i);
  assert.equal(predict({ nodes: N(['H', ...many]), edges: many.map(m => E('H', m)) }).length, 0, 'a node linked to more than 200 others says nothing about any pair');
  assert.equal(predict({ nodes: N(['a', 'b', 'c']), edges: [E('a', 'b'), E('b', 'c'), E('a', 'c', { status: 'proposed' })] }).length, 1, 'a proposed edge is not a link: the pair is still a lead');
});

test('US-27-R10: insights carry a stable id, a score, a prediction in the scorer form and a probe, and fire only above their thresholds', () => {
  const analysis = { by_kind: { x: { nodes: 9, orphans: 9 }, y: { nodes: 10, orphans: 4 }, z: { nodes: 10, orphans: 5 } },
    bridges: [1, 2, 3, 4].map(i => ({ id: 'b' + i, label: 'B' + i, kind: 'k', participation: 0.5 + i / 10, communities: 2, degree: 4 })),
    hubs: Array.from({ length: 7 }, (_, i) => ({ id: 'h' + i, label: 'H' + i, kind: 'k', degree: 3 })), components: 20 };
  const cands = Array.from({ length: 7 }, (_, i) => ({ src: 's' + i, dst: 'd' + i, score: 2, why: '2 shared neighbours' }));
  const out = insights({ analysis, candidates: cands, previous: { hubs: [{ id: 'h0' }], components: 10 } });
  const by = k => out.filter(i => i.kind === k);
  assert.deepEqual(by('orphans').map(i => i.id), ['orphans:z'], 'only a kind with ten or more records, half of them orphans');
  assert.equal(by('bridge').length, 3); assert.equal(by('new-hub').length, 4, 'at most five of the top hubs, minus the ones already known'); assert.equal(by('link').length, 5);
  assert.equal(by('fragmenting').length, 1, '20 components against 10 before is more than 1.25 times plus 2');
  assert.equal(insights({ analysis: { ...analysis, components: 14 }, previous: { hubs: [], components: 10 } }).filter(i => i.kind === 'fragmenting').length, 0, '14 is not above 1.25 x 10 + 2');
  for (const i of out) { assert.ok(i.id && typeof i.score === 'number'); assert.match(i.prediction, /^[a-z_0-9A-Z|:]+( [a-z_0-9A-Z|:]+)? (<|<=|>=|==) \S+ within \d+ h$/); assert.match(i.probe, /^datagraph:/); }
  assert.equal(by('orphans')[0].prediction, 'graph_orphan_share_z < 0.5 within 168 h');
  assert.equal(by('link')[0].prediction.endsWith('within 336 h'), true, 'a link lead is judged after the 14 days it is kept for');
  for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].score >= out[i].score, 'sorted by score');
  assert.equal(JSON.stringify(insights({ analysis, candidates: cands, previous: { hubs: [{ id: 'h0' }], components: 10 } })), JSON.stringify(out), 'the same finding has the same id');
  assert.ok(insights({ analysis, weights: { orphans: 1.5 } }).find(i => i.kind === 'orphans').score > by('orphans')[0].score, 'learned weights scale the score');
});

test('US-27-R11: a proposed edge is kept when the data later links the pair and dropped after fourteen days without it', () => {
  const g = { nodes: N(['a', 'b', 'c', 'd']), edges: [E('a', 'b'), E('c', 'd', { status: 'proposed' })] };
  const now = Date.parse('2026-12-20T00:00:00Z');
  const out = settle([{ src: 'b', dst: 'a', first_seen: '2026-12-19T00:00:00Z' }, { src: 'c', dst: 'd', first_seen: '2026-12-19T00:00:00Z' }, { src: 'c', dst: 'd', first_seen: '2026-11-01T00:00:00Z' }, { src: 'a', dst: 'd', at: '2026-12-01T00:00:00Z' }], g, { now });
  assert.deepEqual(out.map(x => x.outcome), ['kept', 'open', 'dropped', 'dropped'], 'a pair linked in either direction is kept; its own proposal does not count; older than keepDays is dropped');
  assert.equal(DEFAULTS.keepDays, 14);
  assert.equal(settle([{ src: 'c', dst: 'd', first_seen: '2026-12-10T00:00:00Z' }], g, { now, keepDays: 5 })[0].outcome, 'dropped');
});

test('US-27-R12: kind weights learn from kept and dropped outcomes, unchanged below three outcomes, bounded to 0.5 to 1.5', () => {
  assert.deepEqual(calibrate([{ kind: 'link', outcome: 'kept' }, { kind: 'link', outcome: 'dropped' }, { kind: 'link', outcome: 'open' }]).weights, { link: 1 });
  const lo = calibrate(Array.from({ length: 6 }, () => ({ kind: 'link', outcome: 'dropped' })));
  assert.equal(lo.weights.link, 0.5); assert.deepEqual(lo.tally.link, { kept: 0, dropped: 6 });
  assert.equal(calibrate(Array.from({ length: 6 }, () => ({ kind: 'link', outcome: 'kept' }))).weights.link, 1.5);
  assert.equal(calibrate([{ kind: 'l', outcome: 'kept' }, { kind: 'l', outcome: 'kept' }, { kind: 'l', outcome: 'dropped' }]).weights.l, 1.2, '2 x (kept + 1) / (n + 2)');
  assert.deepEqual(calibrate(undefined).weights, {});
});

test('US-27-R13: the neighbourhood of a node is a bounded breadth-first subgraph that keeps relations and leaves out rejected edges', () => {
  const g = { nodes: N(['a', 'b', 'c', 'd', 'e']), edges: [E('a', 'b'), E('b', 'c'), E('c', 'd'), E('a', 'e', { status: 'rejected' })] };
  const one = neighborhood(g, 'a', { depth: 1 });
  assert.deepEqual(one.nodes.map(n => [n.id, n.distance]), [['a', 0], ['b', 1]]); assert.ok(one.edges.every(e => e.rel === 'r'));
  assert.deepEqual(neighborhood(g, 'a').nodes.map(n => n.id), ['a', 'b', 'c'], 'depth two by default');
  assert.equal(neighborhood(g, 'b', { depth: 3, limit: 2 }).nodes.length, 2, 'the limit bounds the nodes');
  assert.equal(neighborhood(g, 'a', { depth: 3 }).nodes.some(n => n.id === 'e'), false);
});

test('US-27-R08: a tie between neighbouring labels goes to the smallest label, so the community is named by its smallest member', () => {
  // d-b-e-c: b hears d and e once each, and the tie must go to d, never to e.
  const g = { nodes: N(['a', 'b', 'c', 'd', 'e']), edges: [E('b', 'd'), E('b', 'e'), E('c', 'e')] };
  const a = analyze(g), big = a.communities[0];
  assert.equal(big.size, 4); assert.equal(big.id, 'd', 'the smallest label of the tie');
  assert.deepEqual(['b', 'c', 'd', 'e'].map(i => a._community.get(i)), ['d', 'd', 'd', 'd']);
  assert.equal(a._community.get('a'), 'a', 'an isolated node keeps its own label');
});

test('US-27-R09: a node linked to more than 200 others says nothing about any pair, one linked to exactly 200 still does', () => {
  const lead = n => {
    const leaves = Array.from({ length: n }, (_, i) => `l${String(i).padStart(3, '0')}`), edges = [];
    // every leaf is linked to both hubs, so every pair of leaves shares two neighbours and passes the evidence rule unless the hubs are ignored
    for (const l of leaves) { edges.push(E(l, 'h1')); edges.push(E(l, 'h2')); }
    return predict({ nodes: N([...leaves, 'h1', 'h2']), edges });
  };
  const leafPair = p => p.src.startsWith('l') && p.dst.startsWith('l');
  const at200 = lead(200).filter(leafPair), at201 = lead(201).filter(leafPair);
  assert.ok(at200.length > 0 && at200.every(p => p.via.length === 2), 'two hubs of exactly 200 neighbours each count: leaves that share both are led');
  assert.deepEqual(at201, [], 'two hubs of 201 neighbours each count for nothing: no pair of leaves is led');
});
