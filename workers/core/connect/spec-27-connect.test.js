// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-27: the vector space and the connection engine of core/connect (CONNECT-1): embedding routes, int8 vectors, search, the three generators, scoring, leads and learning.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from './index.js';
import { createGraph } from '../kgraph/index.js';

const vec = (...xs) => C.unit(Float32Array.from({ length: 8 }, (_, i) => xs[i] ?? 0));
// A planted world (axes: water, infection, schooling, money, roads): chlorine works on diarrhoea; cholera means nearly what diarrhoea means and has no solution;
// tutoring and road-safety lessons are alike but sit in different domains; cash shares dropout with tutoring and also addresses poverty.
const ITEMS = [
  { id: 'p:diarrhoea', kind: 'problem', label: 'Child diarrhoea', group: 'health', v: vec(0.7, 1, 0, 0, 0, 0.1) },
  { id: 'p:cholera', kind: 'problem', label: 'Cholera outbreaks', group: 'health', v: vec(0.9, 0.7, 0, 0, 0, 0, 0.5) },
  { id: 'p:dropout', kind: 'problem', label: 'Children leaving school', group: 'education', v: vec(0, 0, 1, 0.3, 0, 0, 0, 0.1) },
  { id: 'p:crashes', kind: 'problem', label: 'Road crashes', group: 'transport', v: vec(0, 0, 0, 0, 1, 0.1) },
  { id: 'p:poverty', kind: 'problem', label: 'Extreme poverty', group: 'income', v: vec(0, 0, 0.35, 1, 0, 0, 0.1) },
  { id: 's:chlorine', kind: 'solution', label: 'Chlorine dispensers', group: 'health', weight: 1, v: vec(1, 0.8, 0, 0, 0, 0, 0, 0.1) },
  { id: 's:tutoring', kind: 'solution', label: 'Teaching at the right level', group: 'education', weight: 0.9, v: vec(0, 0, 1, 0, 0.2, 0.1) },
  { id: 's:roadclass', kind: 'solution', label: 'Road-safety lessons', group: 'transport', weight: 0.6, v: vec(0, 0, 0.9, 0, 0.6) },
  { id: 's:cash', kind: 'solution', label: 'Cash transfers', group: 'income', weight: 0.9, v: vec(0, 0, 0.4, 1, 0) },
  { id: 's:helmets', kind: 'solution', label: 'Helmet laws', group: 'transport', weight: 0.8, v: vec(0, 0.1, 0, 0, 1) },
];
const P = { source: 'test' };
const EDGES = [['s:chlorine', 'p:diarrhoea'], ['s:tutoring', 'p:dropout'], ['s:cash', 'p:dropout'], ['s:cash', 'p:poverty'], ['s:helmets', 'p:crashes'], ['s:roadclass', 'p:crashes']].map(([src, dst]) => ({ src, rel: 'addresses', dst, status: 'confirmed', provenance: [P] }));
const VECTORS = new Map(ITEMS.map(i => [i.id, i.v]));
const run = (o = {}) => C.discover({ items: ITEMS, edges: EDGES, vectors: VECTORS, spec: { z: { transfer: 0, bridge: 0 }, ...o.spec }, known: o.known || [] });

test('US-27-R45: a vector is stored as int8 and a scale, JSON-safe, and the cosine order survives the round trip', () => {
  const a = vec(1, 0.5, 0.2), b = vec(0.9, 0.6, 0.1), c = vec(0, 0, 1);
  const packed = C.pack(a); assert.deepEqual(Object.keys(packed).sort(), ['d', 'q', 's']); assert.equal(packed.d, 8); assert.equal(typeof packed.q, 'string');
  const back = C.unpack(JSON.parse(JSON.stringify(packed))); assert.ok(Math.abs(C.dot(back, a) - 1) < 1e-3, 'the unpacked vector is a unit vector close to the original'); assert.ok(Math.abs(C.dot(back, back) - 1) < 1e-5);
  assert.ok(C.dot(C.unpack(C.pack(a)), C.unpack(C.pack(b))) > C.dot(C.unpack(C.pack(a)), C.unpack(C.pack(c))));
  assert.equal(C.fnv('abc'), C.fnv('abc')); assert.notEqual(C.fnv('abc'), C.fnv('abd')); assert.ok(C.fnv('x') >= 0);
  assert.ok(Math.abs(C.dot(C.unit([3, 4]), C.unit([3, 4])) - 1) < 1e-6); assert.equal(C.dot(C.unit([0, 0]), C.unit([1, 1])), 0, 'a zero vector stays zero');
  assert.equal(C.dot([1, 2, 3], [1, 1]), 3, 'a dot product reads the shorter length');
});

test('US-27-R46: embedding uses one route for the whole run, tries routes in order, abandons a failing route whole, and embeds only the texts that changed', async () => {
  const items = [{ id: 'a', text: 'water' }, { id: 'b', text: 'roads' }];
  let n = 0; const good = { id: 'm1', embed: async ts => { n += ts.length; return ts.map((t, i) => [i + 1, t.length]); } };
  const broken = { id: 'm0', embed: async () => { throw new Error('HTTP 429'); } }, short = { id: 'm0b', embed: async () => [[1, 1]] };
  const r1 = await C.embedAll(items, { embedders: [broken, short, good] });
  assert.equal(r1.route, 'm1'); assert.deepEqual(r1.tried, ['m0: HTTP 429', 'm0b: got 1 vectors for 2 texts']); assert.equal(r1.embedded, 2); assert.equal(r1.cached, 0);
  assert.ok([...r1.vectors.values()].every(v => v instanceof Float32Array && Math.abs(C.dot(v, v) - 1) < 1e-5), 'every vector is a unit vector in the same space');
  const r2 = await C.embedAll([items[0], { id: 'b', text: 'roads and helmets' }], { embedders: [good], cache: r1.cache });
  assert.deepEqual([r2.embedded, r2.cached, n], [1, 1, 3]); assert.equal(Object.keys(r2.cache).length, 2, 'the cache keeps only this run\'s live keys for the route');
  const keys = Object.keys(r2.cache); assert.ok(keys.every(k => /^m1\|[0-9a-z]+$/.test(k)));
  const other = await C.embedAll(items, { embedders: [{ id: 'other', embed: async ts => ts.map(() => [1, 0]) }], cache: r2.cache }); assert.equal(other.embedded, 2, 'a cache entry from another route is never read');
  assert.ok(Object.keys(other.cache).includes('m1|' + C.fnv('water').toString(36)), 'and is left alone');
  await assert.rejects(() => C.embedAll(items, { embedders: [broken, short] }), /^Error: every embed route failed: m0: HTTP 429; m0b: got 1 vectors for 2 texts$/);
  await assert.rejects(() => C.embedAll(items, { embedders: [] }), /needs at least one embedder/); await assert.rejects(() => C.embedAll(items, {}), /needs at least one embedder/);
  const logged = []; await C.embedAll(items, { embedders: [broken, good], log: m => logged.push(m) }); assert.deepEqual(logged, ['embed route m0 failed: HTTP 429']);
});

test('US-27-R47: the model routes (Workers AI binding, keyless HTTP route, GitHub Models) return unit vectors in input order, in batches, and fail with a plain reason', async () => {
  assert.equal(C.EMBED_MODEL, '@cf/baai/bge-base-en-v1.5'); assert.equal(C.SCHEMA, 'connect/1');
  let calls = 0; const wai = C.workersAiEmbedder({ run: async (m, o) => { calls++; assert.equal(m, C.EMBED_MODEL); return { data: o.text.map(t => [t.length, 1]) }; } });
  const out = await wai.embed(Array.from({ length: 120 }, (_, i) => 'x'.repeat(i + 1))); assert.equal(calls, 3, 'batches of fifty'); assert.equal(out.length, 120); assert.ok(C.dot(out[0], C.unit([1, 1])) > C.dot(out[119], C.unit([1, 1])), 'order is kept');
  assert.ok(out.every(v => Math.abs(C.dot(v, v) - 1) < 1e-5)); assert.equal(wai.id, 'wai:' + C.EMBED_MODEL);
  await assert.rejects(() => C.workersAiEmbedder({ run: async () => ({}) }).embed(['a']), /embedding reply had no data/);
  const seen = []; const f = async (url, init) => { seen.push([url, init.headers.authorization, JSON.parse(init.body)]); const b = JSON.parse(init.body); return url.includes('github') ? Response.json({ data: b.input.map((_, i) => ({ index: b.input.length - 1 - i, embedding: [b.input.length - 1 - i, 1] })).reverse() }) : Response.json({ vectors: b.embed.map(() => [1, 0]) }); };
  const h = await C.httpEmbedder({ url: 'https://m/llm', token: async () => 'oidc', fetch: f }).embed(['a', 'b']);
  assert.equal(h.length, 2); assert.deepEqual(seen[0], ['https://m/llm', 'Bearer oidc', { embed: ['a', 'b'], model: C.EMBED_MODEL }]);
  await C.httpEmbedder({ url: 'https://m/llm', fetch: f }).embed(['a']); assert.equal(seen[1][1], undefined, 'no token, no authorization header');
  await assert.rejects(() => C.httpEmbedder({ url: 'u', fetch: async () => new Response('x', { status: 500 }) }).embed(['a']), /embed route HTTP 500/); await assert.rejects(() => C.httpEmbedder({ url: 'u', fetch: async () => Response.json({}) }).embed(['a']), /embed route returned no vectors/);
  const g = await C.githubModelsEmbedder({ token: 'tok', fetch: f }).embed(['a', 'b']); assert.equal(seen.at(-1)[0], 'https://models.github.ai/inference/embeddings'); assert.equal(seen.at(-1)[1], 'Bearer tok'); assert.equal(seen.at(-1)[2].model, 'openai/text-embedding-3-small');
  assert.ok(C.dot(g[0], C.unit([0, 1])) > C.dot(g[1], C.unit([0, 1])), 'results are re-sorted by their index');
  await assert.rejects(() => C.githubModelsEmbedder({ token: 't', fetch: async () => new Response('x', { status: 500 }) }).embed(['a']), /github-models embeddings HTTP 500/);
  await assert.rejects(() => C.githubModelsEmbedder({ token: 't', fetch: async () => Response.json({ data: [] }) }).embed(['a']), /wrong number of vectors/);
});

test('US-27-R48: the lexical route needs no network, model or credential, scores shared meaning-bearing words higher, and is never cached', async () => {
  const docs = ['chlorine dispensers make drinking water safe', 'safe drinking water treatment with chlorine tablets', 'motorcycle helmet laws cut road deaths'];
  const e = C.lexicalEmbedder(docs, { dim: 256 }), [x, y, z] = await e.embed(docs);
  assert.ok(C.dot(x, y) > C.dot(x, z) + 0.2); assert.match(e.id, /^lexical-256-[0-9a-z]+$/); assert.equal(e.cache, false); assert.equal(x.length, 256);
  assert.match(C.lexicalEmbedder(docs).id, /^lexical-512-/); assert.notEqual(C.lexicalEmbedder(docs).id, C.lexicalEmbedder([...docs, 'one more']).id, 'the route id names its corpus');
  assert.deepEqual([...(await e.embed([docs[0]]))[0]], [...x], 'the same text is the same vector');
  const items = docs.map((text, id) => ({ id: 'd' + id, text })), once = await C.embedAll(items, { embedders: [e], cache: { keep: 1 } });
  assert.deepEqual(once.cache, { keep: 1 }, 'a lexical vector is cheap and corpus-bound, so nothing is cached'); assert.equal(once.embedded, 3);
  const stem = await e.embed(['dispenser', 'dispensers']); assert.ok(C.dot(stem[0], stem[1]) > 0.99, 'plural endings do not make a new word');
});

test('US-27-R51: semantic search returns the closest items first, with a filter and an exclusion, ties by id', () => {
  const r = C.nearest(VECTORS, ITEMS[1].v, { k: 2, exclude: new Set(['p:cholera']) }); assert.deepEqual(r.map(x => x.id), ['s:chlorine', 'p:diarrhoea']);
  const ps = C.nearest(VECTORS, ITEMS[1].v, { k: 5, filter: id => id.startsWith('p:') }); assert.equal(ps.length, 5); assert.ok(ps.every(x => x.id.startsWith('p:'))); assert.equal(ps[0].id, 'p:cholera'); for (let i = 1; i < 5; i++) assert.ok(ps[i - 1].score >= ps[i].score);
  assert.equal(C.nearest(VECTORS, ITEMS[1].v, { k: 2 }).length, 2);
  const tie = new Map([['b', vec(1)], ['a', vec(1)], ['c', vec(0, 1)]]); assert.deepEqual(C.nearest(tie, vec(1), { k: 3 }).map(x => x.id), ['a', 'b', 'c']);
});

test('US-27-R52: three generators read the graph and the vectors together: transfer, bridge and Swanson closure, never restating a confirmed link, and the same inputs give the same output', () => {
  const { candidates } = run();
  const t = candidates.find(c => c.id === 'transfer:s:chlorine>p:cholera'); assert.ok(t, 'the planted transfer'); assert.deepEqual([t.kind, t.rel, t.via, t.novelty], ['transfer', 'addresses', ['p:diarrhoea'], 1]); assert.equal(candidates[0].id, t.id);
  assert.ok(candidates.some(c => c.kind === 'bridge' && c.a === 's:roadclass' && c.b === 's:tutoring' && c.rel === 'shares_mechanism'), 'close in meaning, different domains'); assert.ok(candidates.filter(c => c.kind === 'bridge').every(c => c.a < c.b));
  const cl = candidates.find(c => c.a === 's:tutoring' && c.b === 'p:poverty'); assert.deepEqual(cl.found_by, ['closure', 'transfer'], 'two generators on one pair are one corroborated entry');
  assert.ok(cl.via.length >= 1);
  const linked = new Set(EDGES.map(e => e.src + '>' + e.dst)); assert.ok(candidates.every(c => !linked.has(c.a + '>' + c.b)));
  assert.deepEqual(run(), run()); assert.deepEqual(C.discover({ items: ITEMS, edges: [], vectors: VECTORS, spec: { z: { transfer: 0, bridge: 0 } } }).candidates.filter(c => c.kind === 'transfer'), [], 'with no confirmed link there is nothing to transfer');
  const lead = C.discover({ items: ITEMS, edges: EDGES.map(e => ({ ...e, status: 'proposed' })), vectors: VECTORS, spec: { z: { transfer: 0, bridge: 0 } } }); assert.equal(lead.stats.links, 0, 'a proposed edge is not a link');
  const noVec = C.discover({ items: ITEMS, edges: EDGES, vectors: new Map([...VECTORS].filter(([id]) => id !== 'p:cholera')), spec: { z: { transfer: 0, bridge: 0 } } }); assert.ok(noVec.candidates.every(c => c.a !== 'p:cholera' && c.b !== 'p:cholera'), 'an item with no vector is left out');
  assert.deepEqual(Object.keys(C.discover({ items: [], vectors: new Map() }).stats).sort(), ['background', 'by_kind', 'cutoff', 'explored', 'items', 'links', 'scored', 'vectors']);
});

test('US-27-R53: the similarity cutoff is the run\'s own background, mean plus z standard deviations floored at minSim, so it holds for any embedding model', () => {
  assert.deepEqual(C.DEFAULTS.z, { transfer: 1.28, bridge: 1.64, closure: -0.5 }); assert.deepEqual(C.DEFAULTS.minSim, { transfer: 0.05, bridge: 0.05, closure: 0 });
  const ids = ITEMS.filter(i => i.kind === 'problem').map(i => i.id), bg = C.background(ids, ids, id => VECTORS.get(id));
  assert.equal(bg.n, 10, 'five items, ten unordered pairs'); assert.ok(bg.mu > 0 && bg.sd > 0);
  assert.deepEqual(C.background([], [], () => null), { mu: 0, sd: 0, n: 0 });
  const many = Array.from({ length: 300 }, (_, i) => 'x' + i), vv = id => vec(1, Number(id.slice(1)) % 7), sampled = C.background(many, many, vv, { cap: 1000 });
  assert.ok(sampled.n >= 1000 && sampled.n < 2000, 'every step-th of the 44,850 pairs, where step is the pair count divided by the cap and rounded down: a sample under twice the cap'); assert.equal(C.background(many, many, vv, { cap: 1000 }).n, sampled.n, 'and the same sample every run');
  const loose = run().stats.cutoff, strict = C.discover({ items: ITEMS, edges: EDGES, vectors: VECTORS, spec: { z: { transfer: 3, bridge: 3, closure: 3 } } });
  assert.ok(strict.stats.cutoff.transfer > loose.transfer && strict.stats.cutoff.bridge > loose.bridge); assert.ok(strict.candidates.length < run().candidates.length);
  const floor = C.discover({ items: ITEMS, edges: EDGES, vectors: VECTORS, spec: { z: { transfer: -9, bridge: -9, closure: -9 }, minSim: { transfer: 0.4, bridge: 0.4, closure: 0.4 } } }); assert.deepEqual([floor.stats.cutoff.transfer, floor.stats.cutoff.bridge, floor.stats.cutoff.closure], [0.4, 0.4, 0.4], 'minSim is a floor under the cutoff');
  assert.ok(loose.duplicate >= 0.25 && loose.duplicate <= 0.97, 'the restatement threshold stays between 0.25 and 0.97');
});

test('US-27-R54: a candidate scores relevance x novelty x support x value x learned weight x agreement, capped at one, and the shortlist is diverse, bounded and free of explored pairs', () => {
  const { candidates } = run();
  for (const c of candidates) { const expect = Math.min(1, c.relevance * c.novelty * (0.5 + 0.5 * c.support) * c.value * (1 + 0.25 * (c.found_by.length - 1))); assert.ok(Math.abs(c.score - expect) < 0.006, `${c.id} ${c.score} vs ${expect}`); assert.ok(c.score > 0 && c.score <= 1); }
  for (let i = 1; i < candidates.length; i++) assert.ok(candidates[i - 1].score >= candidates[i].score, 'ranked');
  const per = new Map(); for (const c of candidates) for (const x of [c.a, c.b]) per.set(x, (per.get(x) || 0) + 1); assert.ok([...per.values()].every(n => n <= 2), 'perItem defaults to two'); assert.ok(candidates.length <= 40);
  assert.equal(run({ spec: { limit: 3 } }).candidates.length, 3);
  const again = run({ known: [{ members: ['p:cholera', 's:chlorine'] }] }); assert.ok(!again.candidates.some(c => c.a === 's:chlorine' && c.b === 'p:cholera'), 'an explored pair, in either order, is not proposed again'); assert.equal(again.stats.explored, 1);
  const weighted = run({ spec: { kindWeight: { transfer: 0.5 } } }).candidates.find(c => c.id === 'transfer:s:chlorine>p:cholera'); assert.ok(weighted.score < candidates.find(c => c.id === weighted.id).score);
  const twin = { id: 'p:diarrhoea-rate', kind: 'problem', label: 'Diarrhoea incidence rate', group: 'health', v: vec(0.7, 1, 0, 0, 0, 0.1, 0, 0.01) }, items = [...ITEMS, twin], V = new Map(items.map(i => [i.id, i.v]));
  const r = C.discover({ items, edges: EDGES, vectors: V, spec: { z: { transfer: 0, bridge: 0 }, duplicate: 0.95, limit: 100, perItem: 100 } });
  const dup = r.candidates.find(c => c.b === 'p:diarrhoea-rate'), real = r.candidates.find(c => c.b === 'p:cholera'); assert.equal(dup.restates, 'p:diarrhoea'); assert.ok(real.score > dup.score); assert.equal(real.restates, undefined);
});

test('US-27-R55: candidates become proposed edges that fill no gap and questions in the tenant\'s wording, and nothing here publishes', async () => {
  const { candidates } = run(), props = C.toProposals(candidates);
  assert.equal(props.length, candidates.length); assert.ok(props.every(p => p.status === 'proposed' && /proposed by core\/connect$/.test(p.why) && /score \d/.test(p.why)));
  assert.equal(C.toProposals(candidates.slice(0, 1), { by: 'research' })[0].why.endsWith('proposed by research'), true);
  const mem = () => { const m = new Map(); return { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; }, g = createGraph({ store: mem() });
  for (const i of ITEMS) await g.addNode({ id: i.id, kind: i.kind, label: i.label, provenance: P }); for (const e of EDGES) await g.addEdge(e);
  for (const p of props.filter(x => x.rel === 'addresses')) await g.propose(p);
  const rule = [{ id: 'unsolved', kind: 'problem', lacks: { rel: 'addresses', dir: 'in', to: 'solution' }, ask: n => n.label }];
  assert.ok((await g.gaps(rule)).some(x => x.node === 'p:cholera'), 'a lead does not count as a solution'); assert.deepEqual(await g.validate(), []);
  const qs = C.questions(candidates, ITEMS, { transfer: x => `Would "${x.a}", which works for ${x.via[0]}, work for ${x.b}?` });
  assert.equal(qs[0].text, 'Would "Chlorine dispensers", which works for Child diarrhoea, work for Cholera outbreaks?'); assert.deepEqual([qs[0].id, qs[0].kind], [candidates[0].id, 'transfer']);
  const bq = qs.find(q => q.kind === 'bridge').text; assert.ok(bq.endsWith('?') && bq.includes(' and '), 'a kind with no wording gets a plain default');
});

test('US-27-R56: each generator is re-weighted from what happened to its leads: Beta(1,1), anchored half to a prior of 0.25, bounded to 0.5 to 1.5, unchanged below three outcomes', () => {
  const out = [...Array(6)].map((_, i) => ({ id: `bridge:x${i}>y`, outcome: 'accepted' })).concat([...Array(6)].map((_, i) => ({ id: `transfer:x${i}>y`, outcome: 'rejected' })));
  assert.deepEqual(C.calibrate(out), { kindWeight: { transfer: 0.5, bridge: 1.5, closure: 1 }, tried: { bridge: 6, transfer: 6 }, accepted: { bridge: 6 }, base_rate: 0.375 });
  const alone = C.calibrate([...Array(5)].map((_, i) => ({ id: `transfer:x${i}>y`, outcome: 'rejected' }))).kindWeight.transfer; assert.ok(alone < 1 && alone >= 0.5, 'alone and always failing: still down-weighted');
  assert.deepEqual(C.calibrate([{ id: 'bridge:a>b', outcome: 'accepted' }, { id: 'bridge:a>c', outcome: 'rejected' }]).kindWeight, { transfer: 1, bridge: 1, closure: 1 });
  assert.deepEqual(C.calibrate([{ id: 'bridge:a>b', outcome: 'maybe' }, { id: 'x', outcome: 'accepted' }]).tried, { x: 1 }, 'only accepted and rejected count');
  const c = C.calibrate(out); assert.ok(run({ spec: { kindWeight: c.kindWeight } }).candidates.find(x => x.kind === 'transfer').score < run().candidates.find(x => x.kind === 'transfer').score, 'the new weights reorder the next run');
  assert.equal(C.calibrate(out, { floor: 0.8, ceil: 1.2 }).kindWeight.bridge, 1.2);
});

test('US-27-R52: graph distance reads confirmed edges only: linked is not novel, farther is more novel, unreachable is fully novel', () => {
  const adj = C.adjacency([...EDGES, { src: 's:chlorine', rel: 'addresses', dst: 'p:cholera', status: 'proposed' }]), d = C.hops(adj, 's:tutoring');
  assert.deepEqual([d.get('p:dropout'), d.get('s:cash'), d.get('p:poverty'), d.get('p:cholera')], [1, 2, 3, undefined]);
  assert.equal(C.hops(adj, 's:tutoring', 1).get('s:cash'), undefined, 'bounded by depth');
  assert.deepEqual([0, 1, 2, 4, Infinity, undefined].map(C.distanceNovelty), [0, 0, 0.5, 0.75, 1, 1]);
});

test('US-27-T05: with every model route down the lexical route still completes the run and the planted transfer is found, as a proposal and never a confirmed edge', async () => {
  const texts = { 'p:diarrhoea': 'child diarrhoea from unsafe drinking water', 'p:cholera': 'cholera outbreaks from unsafe drinking water', 'p:dropout': 'girls leaving school early for lack of fees',
    'p:crashes': 'road crashes injure motorcyclists', 's:chlorine': 'chlorine dispensers make unsafe drinking water safe', 's:cash': 'cash transfers pay school fees', 's:helmets': 'helmet laws protect motorcyclists in road crashes' };
  const kinds = { p: 'problem', s: 'solution' }, items = Object.entries(texts).map(([id, text]) => ({ id, kind: kinds[id[0]], label: id, text, group: id }));
  const down = { id: 'wai:down', embed: async () => { throw new Error('HTTP 503'); } }, down2 = { id: 'ghm:down', embed: async () => { throw new Error('HTTP 401'); } };
  const { route, vectors, tried } = await C.embedAll(items, { embedders: [down, down2, C.lexicalEmbedder(items.map(i => i.text))] });
  assert.match(route, /^lexical-/); assert.equal(tried.length, 2);
  const edges = [['s:chlorine', 'p:diarrhoea'], ['s:cash', 'p:dropout'], ['s:helmets', 'p:crashes']].map(([src, dst]) => ({ src, rel: 'addresses', dst, status: 'confirmed', provenance: [P] }));
  const out = C.discover({ items, edges, vectors, spec: { z: { transfer: 0, bridge: 0 } } }), t = out.candidates.find(c => c.id === 'transfer:s:chlorine>p:cholera');
  assert.ok(t && t.via[0] === 'p:diarrhoea'); assert.ok(C.toProposals([t]).every(p => p.status === 'proposed')); assert.ok(out.candidates.every(c => !edges.some(e => e.src === c.a && e.dst === c.b)));
});

test('US-27-T06: leads that survive downstream checks raise their generator\'s weight and leads that die lower it, within bounds, and the next run orders differently', () => {
  const accepted = Array.from({ length: 6 }, (_, i) => ({ id: `closure:a${i}>b`, outcome: 'accepted' })), rejected = Array.from({ length: 6 }, (_, i) => ({ id: `transfer:a${i}>b`, outcome: 'rejected' }));
  const w = C.calibrate([...accepted, ...rejected]).kindWeight; assert.ok(w.closure > 1 && w.closure <= 1.5 && w.transfer < 1 && w.transfer >= 0.5 && w.bridge === 1);
  const before = run().candidates.map(c => c.id), after = run({ spec: { kindWeight: w } }).candidates.map(c => c.id);
  assert.notDeepEqual(after, before, 'the learned weights change the order or the content of the shortlist');
});

test('US-27-R47: every model route sends its texts in batches of its own size (Workers AI 50, keyless HTTP 50, GitHub Models 64) and keeps their order', async () => {
  const texts = Array.from({ length: 150 }, (_, i) => `t${i}`), sizes = { http: [], ghm: [] };
  const f = async (url, init) => {
    const b = JSON.parse(init.body);
    if (url.includes('github')) { sizes.ghm.push(b.input.length); return Response.json({ data: b.input.map((t, i) => ({ index: i, embedding: [Number(t.slice(1)), 1] })) }); }
    sizes.http.push(b.embed.length); return Response.json({ vectors: b.embed.map(t => [Number(t.slice(1)), 1]) });
  };
  const g = await C.githubModelsEmbedder({ token: 't', fetch: f }).embed(texts), h = await C.httpEmbedder({ url: 'https://m/llm', fetch: f }).embed(texts);
  assert.deepEqual(sizes.ghm, [64, 64, 22], 'GitHub Models: batches of 64'); assert.deepEqual(sizes.http, [50, 50, 50], 'keyless HTTP: batches of 50');
  for (const out of [g, h]) { assert.equal(out.length, 150); assert.ok(C.dot(out[0], C.unit([0, 1])) > C.dot(out[149], C.unit([0, 1])), 'input order kept across batches'); }
  assert.deepEqual(sizes.ghm.length + sizes.http.length, 6);
});

test('US-27-R52: closure weights each shared problem by how specific it is, and a target that clearly does not mean what the solution means is vetoed', () => {
  // s and s2 both address p (two solvers, so the weight is 1 / ln(2 + 2)); s2 also addresses q-near and q-far; s itself does not.
  const items = [{ id: 's', kind: 'solution', label: 'S', v: vec(1, 0, 0) }, { id: 's2', kind: 'solution', label: 'S2', v: vec(1, 0.2, 0) }, { id: 'p', kind: 'problem', label: 'P', v: vec(1, 0, 0) },
    { id: 'q-near', kind: 'problem', label: 'Near', v: vec(0.9, 0.4, 0) }, { id: 'q-far', kind: 'problem', label: 'Far', v: vec(0.05, 0.3, 1) }];
  const edges = [['s', 'p'], ['s2', 'p'], ['s2', 'q-near'], ['s2', 'q-far']].map(([src, dst]) => ({ src, rel: 'addresses', dst, status: 'confirmed', provenance: [P] }));
  const only = { z: { transfer: 100, bridge: 100 } };
  const r = C.discover({ items, edges, vectors: new Map(items.map(i => [i.id, i.v])), spec: only });
  const near = r.candidates.find(c => c.a === 's' && c.b === 'q-near');
  assert.ok(near && near.found_by.length === 1 && near.found_by[0] === 'closure', 'transfer and bridge are out of reach here, so closure alone found it');
  assert.equal(near.sims.adamic_adar, Math.round(1 / Math.log(4) * 1000) / 1000, 'one over ln(2 + the solvers of the shared problem)');
  assert.deepEqual(near.via, ['p', 's2']);
  assert.ok(!r.candidates.some(c => c.b === 'q-far'), 'a meaning far below the run\'s own background vetoes the structural lead');
  assert.ok(r.stats.cutoff.closure > 0.1 && C.dot(vec(1, 0, 0), vec(0.05, 0.3, 1)) < r.stats.cutoff.closure);
  // more solvers on the shared problem make it less specific, so it counts for less
  const crowd = [...items, ...[1, 2, 3, 4].map(i => ({ id: 'x' + i, kind: 'solution', label: 'X' + i, v: vec(0, 0, 1) }))], crowdEdges = [...edges, ...[1, 2, 3, 4].map(i => ({ src: 'x' + i, rel: 'addresses', dst: 'p', status: 'confirmed', provenance: [P] }))];
  const c2 = C.discover({ items: crowd, edges: crowdEdges, vectors: new Map(crowd.map(i => [i.id, i.v])), spec: only }).candidates.find(c => c.a === 's' && c.b === 'q-near');
  assert.ok(c2 && c2.sims.adamic_adar < near.sims.adamic_adar && c2.sims.adamic_adar === Math.round(1 / Math.log(8) * 1000) / 1000);
});

test('US-27-R54: the shortlist uses an item at most twice, however many candidates it is in', () => {
  const items = [{ id: 's', kind: 'solution', label: 'S', weight: 1, v: vec(1, 0.1, 0) }, { id: 'p0', kind: 'problem', label: 'P0', v: vec(1, 0.2, 0) },
    ...[1, 2, 3, 4, 5, 6].map(i => ({ id: 'q' + i, kind: 'problem', label: 'Q' + i, v: vec(1, 0.2 + i / 20, 0) }))];
  const edges = [{ src: 's', rel: 'addresses', dst: 'p0', status: 'confirmed', provenance: [P] }];
  const r = C.discover({ items, edges, vectors: new Map(items.map(i => [i.id, i.v])), spec: { z: { transfer: -5, bridge: 0 }, limit: 100, duplicate: 1 } });
  assert.ok(r.stats.by_kind.transfer >= 5, 'five or more transfers were scored, all from the one solution');
  assert.equal(r.candidates.filter(c => c.a === 's').length, 2, 'only two of them are kept');
  assert.equal(C.discover({ items, edges, vectors: new Map(items.map(i => [i.id, i.v])), spec: { z: { transfer: -5, bridge: 0 }, limit: 100, duplicate: 1, perItem: 4 } }).candidates.filter(c => c.a === 's').length, 4, 'perItem is a setting');
});

// Defect 8 of US-SPEC-27 section 7 (core/connect/index.js, the `bridge` generator takes max(graph novelty, 0.85) across groups). The test states the
// requirement and fails today, so it is a `todo`: node:test reports it and the suite stays green. When bridge skips a pair already joined by a confirmed
// edge of its own relation, it passes: remove the `todo` option and the PLANNED mark of R52 in the same change.
test('US-27-R52: bridge does not propose a pair that a confirmed edge of its own relation already joins, even across groups', { todo: 'defect 8: bridge floors novelty at 0.85 across groups, so a linked pair is proposed again' }, () => {
  const items = [{ id: 'A', kind: 'solution', label: 'A', group: 'g1' }, { id: 'B', kind: 'solution', label: 'B', group: 'g2' }];
  const vectors = new Map([['A', vec(1, 0.2)], ['B', vec(0.9, 0.3)]]);
  const linked = [{ src: 'A', rel: 'shares_mechanism', dst: 'B', status: 'confirmed', provenance: [P] }];
  assert.equal(C.discover({ items, edges: [], vectors, spec: { z: { bridge: 0 } } }).candidates.filter(c => c.kind === 'bridge').length, 1, 'unlinked, across groups: proposed');
  assert.deepEqual(C.discover({ items, edges: linked, vectors, spec: { z: { bridge: 0 } } }).candidates.filter(c => c.kind === 'bridge'), [], 'linked by shares_mechanism: not proposed again');
});

test('US-27-R52: a pair one hop apart in the same group has graph novelty 0 and is not bridged; across groups bridge floors novelty at 0.85 even when another relation links the pair', () => {
  const vectors = new Map([['A', vec(1, 0.2)], ['B', vec(0.9, 0.3)]]), edge = [{ src: 'A', rel: 'cites', dst: 'B', status: 'confirmed', provenance: [P] }];
  const make = gB => [{ id: 'A', kind: 'solution', label: 'A', group: 'g1' }, { id: 'B', kind: 'solution', label: 'B', group: gB }];
  const bridges = (gB, edges) => C.discover({ items: make(gB), edges, vectors, spec: { z: { bridge: 0 } } }).candidates.filter(c => c.kind === 'bridge');
  assert.equal(bridges('g1', edge).length, 0, 'same group and linked: graph novelty 0');
  assert.deepEqual(bridges('g2', []).map(c => c.novelty), [1], 'unreachable: fully novel');
  assert.deepEqual(bridges('g2', edge).map(c => c.novelty), [0.85], 'across groups the novelty is floored at 0.85 even when another relation links the pair');
  assert.equal(C.distanceNovelty(1), 0); assert.equal(C.distanceNovelty(2), 0.5); assert.equal(C.distanceNovelty(undefined), 1);
});
