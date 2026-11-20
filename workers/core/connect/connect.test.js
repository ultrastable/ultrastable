// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { unit, dot, pack, unpack, fnv, lexicalEmbedder, workersAiEmbedder, httpEmbedder, githubModelsEmbedder, embedAll, nearest, adjacency, hops, distanceNovelty,
  background, discover, calibrate, toProposals, questions } from './index.js';
import { createGraph } from '../kgraph/index.js';

// A planted world. Axis 0 = water, 1 = infection, 2 = schooling, 3 = money, 4 = roads, 5..7 = noise. The truth the engine should find:
// chlorine (water+infection) addresses diarrhoea; cholera means nearly what diarrhoea means and has no solution -> transfer chlorine -> cholera.
// tutoring (schooling) and road-safety-teaching (schooling, roads) are alike but in different domains -> bridge.
const vec = (...xs) => unit(Float32Array.from({ length: 8 }, (_, i) => xs[i] ?? 0));
const ITEMS = [
  { id: 'p:diarrhoea', kind: 'problem', label: 'Child diarrhoea', group: 'health', v: vec(0.7, 1, 0, 0, 0, 0.1) },
  { id: 'p:cholera', kind: 'problem', label: 'Cholera outbreaks', group: 'health', v: vec(0.9, 0.7, 0, 0, 0, 0, 0.5) },
  { id: 'p:dropout', kind: 'problem', label: 'Children leaving school', group: 'education', v: vec(0, 0, 1, 0.3, 0, 0, 0, 0.1) },
  { id: 'p:crashes', kind: 'problem', label: 'Road crashes', group: 'transport', v: vec(0, 0, 0, 0, 1, 0.1) },
  { id: 'p:poverty', kind: 'problem', label: 'Extreme poverty', group: 'income', v: vec(0, 0, 0.35, 1, 0, 0, 0.1) },
  { id: 's:chlorine', kind: 'solution', label: 'Chlorine dispensers at the water point', group: 'health', weight: 1, v: vec(1, 0.8, 0, 0, 0, 0, 0, 0.1) },
  { id: 's:tutoring', kind: 'solution', label: 'Teaching at the right level', group: 'education', weight: 0.9, v: vec(0, 0, 1, 0, 0.2, 0.1) },
  { id: 's:roadclass', kind: 'solution', label: 'Road-safety lessons in class', group: 'transport', weight: 0.6, v: vec(0, 0, 0.9, 0, 0.6) },
  { id: 's:cash', kind: 'solution', label: 'Cash transfers', group: 'income', weight: 0.9, v: vec(0, 0, 0.4, 1, 0) },
  { id: 's:helmets', kind: 'solution', label: 'Helmet laws', group: 'transport', weight: 0.8, v: vec(0, 0.1, 0, 0, 1) },
];
const P = { source: 'test' };
const EDGES = [
  { src: 's:chlorine', rel: 'addresses', dst: 'p:diarrhoea', status: 'confirmed', provenance: [P] },
  { src: 's:tutoring', rel: 'addresses', dst: 'p:dropout', status: 'confirmed', provenance: [P] },
  { src: 's:cash', rel: 'addresses', dst: 'p:dropout', status: 'confirmed', provenance: [P] },
  { src: 's:cash', rel: 'addresses', dst: 'p:poverty', status: 'confirmed', provenance: [P] },
  { src: 's:helmets', rel: 'addresses', dst: 'p:crashes', status: 'confirmed', provenance: [P] },
  { src: 's:roadclass', rel: 'addresses', dst: 'p:crashes', status: 'confirmed', provenance: [P] },
];
const VECTORS = new Map(ITEMS.map(i => [i.id, i.v]));
const run = (extra = {}) => discover({ items: ITEMS, edges: EDGES, vectors: VECTORS, spec: { z: { transfer: 0, bridge: 0 }, ...extra.spec }, known: extra.known || [] });

test('vectors: int8 packing keeps cosine order and is JSON-safe; fnv is stable', () => {
  const a = vec(1, 0.5, 0.2), b = vec(0.9, 0.6, 0.1), c = vec(0, 0, 1);
  const pa = unpack(JSON.parse(JSON.stringify(pack(a))));
  assert.ok(Math.abs(dot(pa, a) - 1) < 1e-3);
  assert.ok(dot(unpack(pack(a)), unpack(pack(b))) > dot(unpack(pack(a)), unpack(pack(c))));
  assert.equal(fnv('abc'), fnv('abc')); assert.notEqual(fnv('abc'), fnv('abd'));
});

test('lexical route: shared meaning-bearing words score higher than unrelated text, with no network', async () => {
  const docs = ['chlorine dispensers make drinking water safe', 'safe drinking water treatment with chlorine tablets', 'motorcycle helmet laws cut road deaths'];
  const e = lexicalEmbedder(docs, { dim: 256 }), [x, y, z] = await e.embed(docs);
  assert.ok(dot(x, y) > dot(x, z) + 0.2);
  assert.match(e.id, /^lexical-256-/);
});

test('model routes: Workers AI binding, keyless HTTP route and GitHub Models all return unit vectors in order', async () => {
  const ai = { run: async (m, o) => ({ data: o.text.map(t => [t.length, 1]) }) };
  const [v] = await workersAiEmbedder(ai).embed(['abc']); assert.ok(Math.abs(dot(v, v) - 1) < 1e-6);
  const calls = [];
  const f = async (url, init) => { calls.push([url, JSON.parse(init.body), init.headers.authorization]); const b = JSON.parse(init.body);
    return url.includes('github') ? Response.json({ data: b.input.map((t, i) => ({ index: b.input.length - 1 - i, embedding: [b.input.length - 1 - i, 1] })).reverse() }) : Response.json({ vectors: b.embed.map(() => [1, 0]) }); };
  const h = await httpEmbedder({ url: 'https://m/llm', token: async () => 'oidc', fetch: f }).embed(['a', 'b']);
  assert.equal(h.length, 2); assert.equal(calls[0][2], 'Bearer oidc'); assert.deepEqual(calls[0][1].embed, ['a', 'b']);
  const g = await githubModelsEmbedder({ token: 't', fetch: f }).embed(['a', 'b']);
  assert.ok(dot(g[0], unit([0, 1])) > dot(g[1], unit([0, 1])));
});

test('embedAll: one space per run; a failing route is abandoned whole; only changed texts are re-embedded', async () => {
  const items = [{ id: 'a', text: 'water' }, { id: 'b', text: 'roads' }];
  let n = 0; const good = { id: 'm1', embed: async ts => { n += ts.length; return ts.map((t, i) => [i + 1, t.length]); } };
  const broken = { id: 'm0', embed: async () => { throw new Error('HTTP 429'); } };
  const r1 = await embedAll(items, { embedders: [broken, good] });
  assert.equal(r1.route, 'm1'); assert.match(r1.tried[0], /429/); assert.equal(r1.embedded, 2);
  const r2 = await embedAll([...items.slice(0, 1), { id: 'b', text: 'roads and helmets' }], { embedders: [good], cache: r1.cache });
  assert.equal(r2.embedded, 1); assert.equal(r2.cached, 1); assert.equal(n, 3);
  assert.equal(Object.keys(r2.cache).length, 2, 'stale keys are dropped');
  await assert.rejects(() => embedAll(items, { embedders: [broken] }), /every embed route failed/);
});

test('nearest: semantic search returns the closest items first', () => {
  const r = nearest(VECTORS, ITEMS[1].v, { k: 2, exclude: new Set(['p:cholera']) });
  assert.deepEqual(r.map(x => x.id), ['s:chlorine', 'p:diarrhoea']); // cholera's water axis is strongest; both water items come first
});

test('graph distance: linked is not novel, unreachable is fully novel', () => {
  const adj = adjacency(EDGES), d = hops(adj, 's:tutoring');
  assert.equal(d.get('p:dropout'), 1); assert.equal(d.get('s:cash'), 2); assert.equal(d.get('p:poverty'), 3); assert.equal(d.get('p:cholera'), undefined);
  assert.equal(distanceNovelty(1), 0); assert.equal(distanceNovelty(undefined), 1); assert.ok(distanceNovelty(3) > distanceNovelty(2));
});

test('transfer: finds the planted analogy (what works for diarrhoea, tried on cholera) and ranks it first', () => {
  const { candidates } = run();
  const t = candidates.find(c => c.id === 'transfer:s:chlorine>p:cholera');
  assert.ok(t, 'the planted transfer is found'); assert.deepEqual(t.via, ['p:diarrhoea']); assert.equal(t.novelty, 1);
  assert.equal(candidates[0].id, t.id);
});

test('bridge: close in meaning, different domains; closure: Swanson ABC through a shared problem', () => {
  const { candidates } = run();
  assert.ok(candidates.some(c => c.kind === 'bridge' && c.a === 's:roadclass' && c.b === 's:tutoring'));
  // tutoring shares dropout with cash, and cash addresses poverty (structure); poverty also means something like dropout (meaning)
  const cl = candidates.find(c => c.a === 's:tutoring' && c.b === 'p:poverty');
  assert.ok(cl); assert.deepEqual(cl.found_by, ['closure', 'transfer'], 'meaning and structure agree: one corroborated entry');
});

test('no candidate restates a confirmed link; explored pairs are suppressed; the shortlist is diverse', () => {
  const { candidates } = run();
  const linked = new Set(EDGES.map(e => e.src + '>' + e.dst));
  assert.ok(candidates.every(c => !linked.has(c.a + '>' + c.b)));
  const again = run({ known: [{ members: ['s:chlorine', 'p:cholera'] }] }).candidates;
  assert.ok(!again.some(c => c.a === 's:chlorine' && c.b === 'p:cholera'));
  const capped = run({ spec: { perItem: 1 } }).candidates, seen = new Map();
  for (const c of capped) for (const x of [c.a, c.b]) seen.set(x, (seen.get(x) || 0) + 1);
  assert.ok([...seen.values()].every(n => n <= 1));
});

test('the cutoff comes from the run\'s own background, so any embedding model works', () => {
  const ids = ITEMS.filter(i => i.kind === 'problem').map(i => i.id), bg = background(ids, ids, id => VECTORS.get(id));
  assert.equal(bg.n, 10); assert.ok(bg.mu > 0 && bg.sd > 0);
  const strict = discover({ items: ITEMS, edges: EDGES, vectors: VECTORS, spec: { z: { transfer: 3, bridge: 3, closure: 3 } } });
  assert.ok(strict.stats.cutoff.transfer > run().stats.cutoff.transfer);
  assert.ok(strict.candidates.length < run().candidates.length);
});

test('deterministic: equal inputs give equal output', () => {
  assert.deepEqual(run(), run());
});

test('calibrate: generators whose leads survive downstream checks gain weight, bounded; the new weights reorder the next run', () => {
  const out = [...Array(6)].map((_, i) => ({ id: `bridge:x${i}>y`, outcome: 'accepted' })).concat([...Array(6)].map((_, i) => ({ id: `transfer:x${i}>y`, outcome: 'rejected' })));
  const c = calibrate(out);
  assert.ok(c.kindWeight.bridge > 1 && c.kindWeight.bridge <= 1.5); assert.ok(c.kindWeight.transfer < 1 && c.kindWeight.transfer >= 0.5);
  assert.equal(c.kindWeight.closure, 1, 'too few outcomes: unchanged');
  assert.ok(calibrate([...Array(5)].map((_, i) => ({ id: `transfer:x${i}>y`, outcome: 'rejected' }))).kindWeight.transfer < 1, 'alone and always failing: still down-weighted');
  const before = run().candidates.find(x => x.kind === 'transfer').score, after = run({ spec: { kindWeight: c.kindWeight } }).candidates.find(x => x.kind === 'transfer').score;
  assert.ok(after < before);
});

test('outputs: candidates load into the knowledge graph as leads that never fill a gap; questions use the tenant wording', async () => {
  const mem = () => { const m = new Map(); return { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
  const g = createGraph({ store: mem() });
  for (const i of ITEMS) await g.addNode({ id: i.id, kind: i.kind, label: i.label, provenance: P });
  for (const e of EDGES) await g.addEdge(e);
  const { candidates } = run();
  for (const e of toProposals(candidates).filter(e => e.rel === 'addresses')) await g.propose(e);
  const rule = [{ id: 'unsolved', kind: 'problem', lacks: { rel: 'addresses', dir: 'in', to: 'solution' }, ask: n => n.label }];
  assert.ok((await g.gaps(rule)).some(x => x.node === 'p:cholera'), 'a lead does not count as a solution');
  assert.ok((await g.edges({ status: 'proposed' })).length > 0);
  const qs = questions(candidates, ITEMS, { transfer: x => `Would "${x.a}", which works for ${x.via[0]}, work for ${x.b}?` });
  assert.equal(qs[0].text, 'Would "Chlorine dispensers at the water point", which works for Child diarrhoea, work for Cholera outbreaks?');
});

test('a target that restates a solved problem (another indicator of the same thing) is flagged and ranked below a real transfer', () => {
  const twin = { id: 'p:diarrhoea-rate', kind: 'problem', label: 'Diarrhoea incidence rate', group: 'health', v: vec(0.7, 1, 0, 0, 0, 0.1, 0, 0.01) };
  const items = [...ITEMS, twin], vectors = new Map(items.map(i => [i.id, i.v]));
  const r = discover({ items, edges: EDGES, vectors, spec: { z: { transfer: 0, bridge: 0 }, duplicate: 0.95, limit: 100, perItem: 100 } });
  const dup = r.candidates.find(c => c.b === 'p:diarrhoea-rate'), real = r.candidates.find(c => c.b === 'p:cholera');
  assert.equal(dup.restates, 'p:diarrhoea'); assert.ok(real.score > dup.score); assert.equal(real.restates, undefined);
});
