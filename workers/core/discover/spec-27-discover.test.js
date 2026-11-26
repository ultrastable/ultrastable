// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-27: the vector index and the discovery loop of core/discover (marker DISCOVER-1 in the code; not the public-directory rule of the same id): packed int8 vectors, ports,
// incremental embedding, the four candidate types, the novelty screen, the ledger and the self-tuning knob.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from './index.js';

const DIM = 16;
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) - 0.5;
const vec = mix => { const v = new Array(DIM).fill(0); for (const [axis, w] of Object.entries(mix)) v[Number(axis)] += w; return v.map(x => x + 0.05 * rnd()); };
const WATER = 0, CHILD = 1, SCHOOL = 2, MONEY = 3, MALARIA = 4;
const NODES = [
  { id: 'p:diarrhoea', kind: 'problem', domain: 'health', label: 'Child diarrhoea deaths', mix: { [WATER]: 1, [CHILD]: 1 } },
  { id: 'p:cholera', kind: 'problem', domain: 'water', label: 'Cholera outbreaks', mix: { [WATER]: 1.2, [CHILD]: 0.3 } },
  { id: 'p:dropout', kind: 'problem', domain: 'education', label: 'Girls leaving school', mix: { [SCHOOL]: 1, [MONEY]: 0.6 } },
  { id: 'p:absent', kind: 'problem', domain: 'health', label: 'Pupils absent from illness', mix: { [SCHOOL]: 1, [CHILD]: 0.5 } },
  { id: 'p:malaria', kind: 'problem', domain: 'health', label: 'Malaria in children', mix: { [MALARIA]: 1.3, [CHILD]: 0.5 } },
  { id: 's:chlorine', kind: 'solution', domain: 'water', label: 'Chlorine dispensers at the water point', mix: { [WATER]: 1.1, [CHILD]: 0.4 } },
  { id: 's:cash', kind: 'solution', domain: 'economy', label: 'Cash transfers to families', mix: { [MONEY]: 1, [SCHOOL]: 0.5 } },
  { id: 's:deworm', kind: 'solution', domain: 'health', label: 'School deworming', mix: { [SCHOOL]: 0.8, [CHILD]: 0.8 } },
  { id: 's:nets', kind: 'solution', domain: 'health', label: 'Bed nets', mix: { [MALARIA]: 1.2, [CHILD]: 0.2 } },
];
const EDGES = [['s:chlorine', 'p:diarrhoea'], ['s:cash', 'p:dropout'], ['s:deworm', 'p:absent'], ['s:nets', 'p:malaria']].map(([src, dst]) => ({ src, rel: 'addresses', dst }));
const P = { pct: 0.5, minSim: 0.3, comboLow: 0.2 };
const cacheFor = (nodes = NODES) => { const by = new Map(nodes.map(n => [`${n.label}. ${n.text || ''}`.slice(0, 2000), n])); return D.refreshEmbeddings({ nodes, embed: async ts => ts.map(t => vec(by.get(t).mix)), model: 'axes' }); };
const indexFor = async nodes => D.unpack(D.packCache((await cacheFor(nodes)).cache));
const find = (r, type, a, b) => r.candidates.find(c => c.type === type && c.members[0] === a && (b === undefined || c.members[1] === b));

test('US-27-R45: a vector is quantized to int8 with its scale and survives JSON and a packed index with its cosine similarity', () => {
  const q = D.quantize([0.5, -1, 0.25, 0]); assert.deepEqual([...q.q], [64, -127, 32, 0]); assert.equal(q.scale, 1 / 127); assert.ok(q.q instanceof Int8Array);
  assert.deepEqual([...D.quantize([0, 0]).q], [0, 0], 'a zero vector quantizes to zeros'); assert.deepEqual([...D.quantize([1000, -1000]).q], [127, -127]);
  const enc = D.encodeVec([0.5, -1, 0.25]); assert.deepEqual(Object.keys(enc).sort(), ['q', 's']); assert.deepEqual([...D.decodeVec(JSON.parse(JSON.stringify(enc)))], [64, -127, 32]);
  const a = vec({ 0: 1, 1: 0.5 }), b = vec({ 0: 1, 1: 0.4 }), c = vec({ 2: 1 });
  const p = D.pack([{ id: 'a', q: D.quantize(a).q }, { id: 'b', q: D.quantize(b).q }, { id: 'c', q: D.quantize(c).q }]); assert.deepEqual([p.v, p.dim, p.ids], [1, DIM, ['a', 'b', 'c']]);
  const M = D.unpack(JSON.parse(JSON.stringify(p))); assert.ok(D.sim(M, 'a', 'b') > 0.9 && D.sim(M, 'a', 'c') < D.sim(M, 'a', 'b') - 0.4, 'close in meaning scores near one, unrelated far below'); assert.equal(D.sim(M, 'a', 'missing'), 0); assert.ok(Math.abs(D.sim(M, 'a', 'a') - 1) < 1e-6);
  assert.throws(() => D.pack([{ id: 'x', q: new Int8Array(3) }, { id: 'y', q: new Int8Array(4) }]), /mixed dimensions in pack/); assert.deepEqual(D.pack([]).ids, []);
  assert.deepEqual([...D.fromB64(D.toB64(new Uint8Array([0, 1, 254, 255])))], [0, 1, 254, 255]); assert.equal(D.hash('abc'), D.hash('abc')); assert.match(D.hash('abc'), /^[0-9a-f]{8}$/);
});

test('US-27-R49: embeddings are refreshed only for texts whose hash changed, a bounded number a run, and a failed batch is recorded and never erases a good vector', async () => {
  assert.deepEqual([D.DEFAULTS.k, D.DEFAULTS.promoteAt], [8, 20000]);
  const first = await cacheFor(); assert.deepEqual([first.embedded, first.reused, first.pending, first.removed, first.errors], [9, 0, 0, 0, []]); assert.equal(first.cache.model, 'axes'); assert.equal(first.cache.dim, DIM);
  let calls = 0; const count = async ts => { calls++; return ts.map(() => vec({ 0: 1 })); };
  const same = await D.refreshEmbeddings({ nodes: NODES, cache: first.cache, model: 'axes', embed: count }); assert.deepEqual([calls, same.reused, same.embedded], [0, 9, 0]);
  const changed = NODES.map(n => (n.id === 's:nets' ? { ...n, text: 'long-lasting insecticidal' } : n));
  const broken = await D.refreshEmbeddings({ nodes: changed, cache: first.cache, model: 'axes', embed: async () => { throw new Error('model down'); } });
  assert.deepEqual([broken.errors.length, broken.errors[0].error, broken.embedded], [1, 'model down', 0]); assert.equal(broken.cache.rows['s:nets'].q, first.cache.rows['s:nets'].q, 'the old vector stays');
  const capped = await D.refreshEmbeddings({ nodes: NODES, cache: {}, model: 'axes', max: 3, batch: 2, embed: async ts => ts.map(() => vec({ 0: 1 })) }); assert.deepEqual([capped.embedded, capped.pending], [3, 6]);
  const wrong = await D.refreshEmbeddings({ nodes: NODES.slice(0, 2), cache: {}, model: 'axes', embed: async () => [vec({ 0: 1 })] }); assert.match(wrong.errors[0].error, /embed returned 1 vectors for 2/); assert.equal(Object.keys(wrong.cache.rows).length, 0);
  const grown = await D.refreshEmbeddings({ nodes: NODES.slice(0, 2), cache: first.cache, model: 'axes', embed: async ts => ts.map(() => [1, 2, 3]), }); assert.deepEqual([grown.reused, grown.embedded, grown.removed], [2, 0, 7], 'rows of nodes that left are dropped');
  const dim = await D.refreshEmbeddings({ nodes: [{ id: 'x', label: 'x' }, { id: 'y', label: 'y' }], cache: { model: 'axes', dim: 4, rows: {} }, model: 'axes', embed: async ts => ts.map(() => [1, 2, 3]) }); assert.match(dim.errors[0].error, /dimension changed/);
  const otherModel = await D.refreshEmbeddings({ nodes: NODES, cache: first.cache, model: 'newer', embed: async ts => ts.map(() => vec({ 0: 1 })) }); assert.equal(otherModel.embedded, 9, 'a different model re-embeds everything: vectors of two models are not comparable');
  const seen = []; await D.refreshEmbeddings({ nodes: [{ id: 'a', label: 'L', text: 'T'.repeat(5000) }], cache: {}, model: 'm', embed: async ts => { seen.push(...ts); return ts.map(() => [1]); } }); assert.equal(seen[0].length, 2000); assert.ok(seen[0].startsWith('L. T'));
});

test('US-27-R50: a packed index answers exactly in memory up to 20,000 vectors and a Vectorize-shaped port takes over above that, behind one query shape', async () => {
  const M = D.unpack(D.pack([{ id: 'a', q: D.quantize(vec({ 0: 1 })).q }, { id: 'b', q: D.quantize(vec({ 1: 1 })).q }, { id: 'c', q: D.quantize(vec({ 1: 0.9, 2: 0.3 })).q }]));
  const packed = D.packedPort(M); assert.deepEqual([packed.kind, packed.size], ['packed', 3]); assert.deepEqual((await packed.query(vec({ 1: 1 }), { topK: 2 })).map(x => x.id), ['b', 'c']); assert.deepEqual((await packed.query(vec({ 1: 1 }), { filter: id => id !== 'b' })).map(x => x.id), ['c', 'a']);
  assert.equal(D.choosePort(M, null).kind, 'packed', 'with no binding the packed index always answers'); const calls = [], fake = { upsert: async r => calls.push(r), query: async (v, o) => { calls.push(o); return { matches: [{ id: 'z', score: 0.9 }] }; } };
  assert.equal(D.choosePort(M, fake).kind, 'packed', 'under promoteAt'); assert.equal(D.choosePort(M, fake, { promoteAt: 2 }).kind, 'vectorize'); assert.equal(D.choosePort(M, fake, { promoteAt: 3 }).kind, 'packed');
  const vz = D.vectorizePort(fake, { namespace: 'tenant-1' }); assert.deepEqual(await vz.query(new Float32Array([1, 0]), { topK: 4 }), [{ id: 'z', score: 0.9 }]); assert.deepEqual(calls.at(-1), { topK: 4, namespace: 'tenant-1' });
  await vz.upsert([{ id: 'a', values: new Float32Array([1, 2]), meta: { k: 1 } }]); assert.deepEqual(calls.at(-1), [{ id: 'a', values: [1, 2], namespace: 'tenant-1', metadata: { k: 1 } }]);
  assert.equal((await D.vectorizePort({ query: async () => ({}) }).query([1])).length, 0, 'a reply with no matches is an empty answer');
});

test('US-27-R51: nearest neighbours are exact over the index, with a filter and an excluded id, and reciprocal rank fusion merges keyword and vector lists', () => {
  const M = D.unpack(D.pack([{ id: 'a', q: D.quantize(vec({ 0: 1 })).q }, { id: 'b', q: D.quantize(vec({ 1: 1 })).q }, { id: 'c', q: D.quantize(vec({ 1: 0.9, 2: 0.3 })).q }]));
  assert.deepEqual(D.nearest(M, vec({ 1: 1 }), { k: 3 }).map(x => x.id), ['b', 'c', 'a']); assert.deepEqual(D.nearest(M, vec({ 1: 1 }), { k: 3, exclude: 'b' }).map(x => x.id), ['c', 'a']); assert.equal(D.nearest(M, vec({ 1: 1 }), { k: 1 }).length, 1);
  const f = D.rrf([['a', 'b', 'c'], ['c', 'a', 'd']]); assert.deepEqual(f.map(x => x.id), ['a', 'c', 'b', 'd']); assert.ok(Math.abs(f[0].score - (1 / 61 + 1 / 62)) < 1e-12, '1 / (k + rank + 1), summed over the lists, k = 60');
  assert.equal(D.rrf([['a', 'b', 'c', 'd']], { limit: 2 }).length, 2); assert.deepEqual(D.rrf([['b'], ['a']]).map(x => x.id), ['a', 'b'], 'equal scores fall back to the id'); assert.deepEqual(D.rrf([]), []);
});

test('US-27-R57: discovery proposes transfer, combination, bridge and frontier candidates, screens each for novelty, caps each type, and leaves out what is already linked or combined', async () => {
  const M = await indexFor(), r = D.discover({ nodes: NODES, edges: EDGES, M, params: P });
  assert.ok(find(r, 'transfer', 's:chlorine', 'p:cholera').via === 'p:diarrhoea', 'a solution proven on one problem, for a similar problem never linked to it'); assert.ok(find(r, 'combination', 's:cash', 's:deworm'), 'two solutions on related problems from different angles');
  assert.ok(r.candidates.some(c => c.type === 'bridge' && c.cross === true && c.members[0] < c.members[1]));
  assert.deepEqual(Object.keys(r.stats).sort(), ['communities', 'known_edges', 'nodes', 'problems', 'semantic_links', 'solutions', 'unembedded']); assert.deepEqual([r.stats.nodes, r.stats.problems, r.stats.solutions, r.stats.known_edges, r.stats.unembedded], [9, 5, 4, 4, 0]);
  assert.ok(r.candidates.every(c => ['none', 'partial'].includes(c.novelty) && c.id.startsWith(c.type + ':') && typeof c.cross === 'boolean'));
  // novelty: no path is "none"; a path of two steps is "partial"; a direct link or a combination already made is a duplicate and is not proposed
  const two = D.discover({ nodes: NODES, edges: [...EDGES, { src: 'p:diarrhoea', rel: 'related_to', dst: 'p:cholera' }], M, params: P }); assert.equal(find(two, 'transfer', 's:chlorine', 'p:cholera').novelty, 'partial');
  const dup = D.discover({ nodes: NODES, edges: [...EDGES, { src: 's:chlorine', rel: 'mentions', dst: 'p:cholera' }], M, params: P }); assert.equal(find(dup, 'transfer', 's:chlorine', 'p:cholera'), undefined);
  const known = D.discover({ nodes: NODES, edges: EDGES, M, params: P, known: [['s:cash', 's:deworm', 's:nets']] }); assert.equal(find(known, 'combination', 's:cash', 's:deworm'), undefined); assert.equal(find(known, 'combination', 's:deworm', 's:nets'), undefined);
  // the score of a transfer is 0.6 x the problems' similarity + 0.4 x the solution's to the target, boosted by 1.25 across domains or communities
  const t = find(r, 'transfer', 's:chlorine', 'p:cholera'); assert.ok(Math.abs(t.score - (0.6 * t.sims.problems + 0.4 * t.sims.solution_to_target) * 1.25) < 1e-3); assert.equal(t.cross, true);
  const flat = D.discover({ nodes: NODES.map(n => ({ ...n, domain: 'one' })), edges: EDGES, M, params: { ...P, crossBoost: 1 } }); assert.ok(find(flat, 'transfer', 's:chlorine', 'p:cholera').score <= t.score);
  // caps: per type and per member
  const capped = D.discover({ nodes: NODES, edges: EDGES, M, params: { ...P, perType: 2, perMember: 1 } });
  for (const type of ['transfer', 'combination', 'bridge', 'frontier']) { const of = capped.candidates.filter(c => c.type === type); assert.ok(of.length <= 2); const uses = new Map(); for (const c of of) for (const m of c.members) uses.set(m, (uses.get(m) || 0) + 1); assert.ok([...uses.values()].every(n => n === 1), type); }
  // the tenant's own vocabulary
  const ren = D.discover({ nodes: NODES.map(n => ({ ...n, kind: n.kind === 'problem' ? 'question' : 'answer' })), edges: EDGES.map(e => ({ ...e, rel: 'answers' })), M, params: P, roles: { problem: 'question', solution: 'answer', addresses: 'answers' } });
  assert.deepEqual(ren.candidates.map(c => c.id), r.candidates.map(c => c.id));
  // an unsolved problem far from every solution is an open question; one that a transfer reaches is not
  const lonely = [...NODES, { id: 'p:roads', kind: 'problem', domain: 'transport', label: 'Road deaths', mix: { 9: 1.5 } }], M2 = await indexFor(lonely);
  const fr = D.discover({ nodes: lonely, edges: EDGES, M: M2, params: P }); const f = fr.candidates.find(c => c.type === 'frontier'); assert.ok(f && f.members[0] === 'p:roads' && f.novelty === 'none' && f.sims.nearest_solution < 0.5); assert.ok(!fr.candidates.some(c => c.type === 'frontier' && c.members[0] === 'p:cholera'));
  const missing = D.discover({ nodes: [...NODES, { id: 'p:nov', kind: 'problem', label: 'no vector' }], edges: EDGES, M, params: P }); assert.equal(missing.stats.unembedded, 1); assert.ok(missing.candidates.every(c => !c.members.includes('p:nov')));
  assert.equal(JSON.stringify(D.discover({ nodes: NODES, edges: EDGES, M, params: P })), JSON.stringify(r), 'deterministic');
});

test('US-27-R58: the ledger keeps each candidate as new, standing, confirmed or dropped, confirms what the system later links, drops what stops ranking after three runs, and its totals always add up', async () => {
  const M = await indexFor(), r = D.discover({ nodes: NODES, edges: EDGES, M, params: P }), DAY = 86400000;
  let { ledger, run } = D.mergeLedger(null, r, { now: 0, edges: EDGES });
  assert.equal(run.new, r.candidates.length); assert.deepEqual(ledger.totals, { entered: r.candidates.length, confirmed: 0, dropped: 0, open: r.candidates.length, hit_rate: null });
  assert.ok(Object.values(ledger.entries).every(e => e.status === 'new' && e.runs === 1 && e.first_seen === '1970-01-01T00:00:00.000Z'));
  const target = find(r, 'transfer', 's:chlorine', 'p:cholera'), adopted = [...EDGES, { src: target.members[0], rel: 'addresses', dst: target.members[1] }];
  ({ ledger, run } = D.mergeLedger(ledger, D.discover({ nodes: NODES, edges: adopted, M, params: P }), { now: DAY, edges: adopted }));
  assert.equal(ledger.entries[target.id].status, 'confirmed'); assert.equal(ledger.entries[target.id].settled, '1970-01-02T00:00:00.000Z'); assert.ok(run.confirmed >= 1);
  assert.ok(Object.values(ledger.entries).some(e => e.status === 'standing' && e.runs === 2));
  for (let i = 2; i <= 4; i++) ({ ledger, run } = D.mergeLedger(ledger, { ...r, candidates: [] }, { now: i * DAY, edges: adopted }));
  const dropped = Object.values(ledger.entries).filter(e => e.status === 'dropped'); assert.ok(dropped.length > 0 && dropped.every(e => e.reason === 'not ranked for 3 runs' && e.missed === 3));
  assert.equal(ledger.entries[target.id].status, 'confirmed', 'a confirmed entry stays confirmed'); assert.ok(ledger.totals.hit_rate > 0 && ledger.totals.hit_rate < 1);
  const back = D.mergeLedger(ledger, r, { now: 5 * DAY, edges: adopted }).ledger, returned = Object.values(back.entries).filter(e => e.returned); assert.ok(returned.length > 0 && returned.every(e => e.status === 'standing' && e.returned === '1970-01-06T00:00:00.000Z'), 'a dropped candidate that ranks again is standing again');
  const small = D.mergeLedger(ledger, { ...r, candidates: [] }, { now: 9 * DAY, edges: adopted, keep: 2 }).ledger; assert.equal(Object.keys(small.entries).length + Object.values(small.retired).reduce((a, b) => a + b, 0), small.totals.entered, 'entered = kept + retired: nothing is silently lost');
  assert.ok(Object.keys(small.entries).length <= Math.max(2, Object.values(small.entries).filter(e => e.status === 'new' || e.status === 'standing').length));
  for (let i = 0; i < 130; i++) ({ ledger } = D.mergeLedger(ledger, { ...r, candidates: [] }, { now: (10 + i) * DAY, edges: adopted })); assert.equal(ledger.runs.length, 120, 'the last 120 runs');
  // a combination is confirmed when a known combination contains both, a frontier when a solution addresses the problem
  const lonely = [...NODES, { id: 'p:roads', kind: 'problem', domain: 'transport', label: 'Road deaths', mix: { 9: 1.5 } }], M2 = await indexFor(lonely), r2 = D.discover({ nodes: lonely, edges: EDGES, M: M2, params: P });
  const l0 = D.mergeLedger(null, r2, { now: 0, edges: EDGES }).ledger, combo = find(r2, 'combination', 's:cash', 's:deworm'), fr = r2.candidates.find(c => c.type === 'frontier');
  const l1 = D.mergeLedger(l0, r2, { now: DAY, edges: [...EDGES, { src: 's:nets', rel: 'addresses', dst: 'p:roads' }], known: [['s:cash', 's:deworm']] }).ledger;
  assert.equal(l1.entries[combo.id].status, 'confirmed'); assert.equal(l1.entries[fr.id].status, 'confirmed');
});

test('US-27-R59: one knob, one step, one prediction: the share of neighbour links that count moves 0.01 within 0.80 to 0.97, and the next run scores the prediction by its own words', () => {
  assert.deepEqual(D.DEFAULTS.tune, { min: 0.8, max: 0.97, step: 0.01, lowNew: 5, highNew: 40 });
  const hi = D.tune({ runs: [{ at: 'x', new: 90, candidates: 100 }] }, { pct: 0.9 }); assert.equal(hi.params.pct, 0.91); assert.deepEqual([hi.decision.knob, hi.decision.from, hi.decision.to], ['pct', 0.9, 0.91]); assert.equal(hi.decision.prediction, 'new_candidates <= 40 within 24 h');
  const lo = D.tune({ runs: [{ at: 'x', new: 1, candidates: 3 }] }, { pct: 0.9 }); assert.equal(lo.params.pct, 0.89); assert.equal(lo.decision.prediction, 'new_candidates >= 5 within 24 h');
  assert.equal(D.tune({ runs: [{ new: 10, candidates: 30 }] }, { pct: 0.9 }).decision, null, 'in band'); assert.equal(D.tune({ runs: [{ new: 1, candidates: 40 }] }, { pct: 0.9 }).decision, null, 'quiet but not empty: the loop is left alone');
  assert.equal(D.tune({ runs: [{ new: 1, candidates: 2 }] }, { pct: 0.8 }).params.pct, 0.8, 'the floor holds'); assert.equal(D.tune({ runs: [{ new: 99, candidates: 99 }] }, { pct: 0.97 }).params.pct, 0.97, 'the ceiling holds');
  assert.deepEqual(D.tune({ runs: [] }, {}), { params: { pct: 0.9 }, decision: null }); assert.deepEqual(D.tune({}, { pct: 0.85, other: 1 }), { params: { pct: 0.85, other: 1 }, decision: null }, 'other parameters pass through untouched');
  assert.equal(D.scorePrediction(hi.decision, { at: 'y', new: 12 }).kept, true); const bad = D.scorePrediction(hi.decision, { at: 'y', new: 50 }); assert.deepEqual([bad.kept, bad.measured, bad.scored_at], [false, 50, 'y']);
  assert.equal(D.scorePrediction(lo.decision, { at: 'y', new: 5 }).kept, true); assert.equal(D.scorePrediction(lo.decision, { at: 'y', new: 4 }).kept, false);
  assert.equal(D.scorePrediction({ prediction: 'something else' }, { new: 1 }), null); assert.equal(D.scorePrediction(null, { new: 1 }), null); assert.equal(D.scorePrediction(hi.decision, null), null);
});

test('US-27-R60: each candidate is explained in plain sentences from the system\'s own labels, with no model', async () => {
  const M = await indexFor(), r = D.discover({ nodes: NODES, edges: EDGES, M, params: P }), label = id => (NODES.find(n => n.id === id) || { label: id }).label;
  const t = D.explain(find(r, 'transfer', 's:chlorine', 'p:cholera'), label); assert.match(t, /^"Chlorine dispensers at the water point" has evidence against "Child diarrhoea deaths"\. "Cholera outbreaks" reads \d+% alike, and nothing links the two yet: worth testing there\.$/);
  assert.match(D.explain(find(r, 'combination', 's:cash', 's:deworm'), label), /^"Cash transfers to families" and "School deworming" work on related problems \(\d+% alike\) from different angles \(\d+% alike\) and have not been combined\.$/);
  assert.match(D.explain(r.candidates.find(c => c.type === 'bridge'), label), /read \d+% alike but sit in different clusters with no known link between them\.$/);
  assert.match(D.explain({ type: 'frontier', members: ['p:x'], via: 's:nets', sims: { nearest_solution: 0.2 } }, label), /^No known solution comes close to "p:x" \(the nearest, "Bed nets", is 20% alike\): an open question\.$/);
  assert.equal(D.explain({ type: 'frontier', members: ['p:x'], via: 'a', sims: { nearest_solution: 0 } }), 'No known solution comes close to "p:x" (the nearest, "a", is 0% alike): an open question.', 'the label function defaults to the id');
});
