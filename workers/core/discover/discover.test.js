// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// DISCOVER-1 tests. A synthetic world with planted truth: vectors are built from topic axes, so which connections exist is known in advance.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from './index.js';

// topic axes: water, child health, schooling, money. A vector is a mix of axes plus a little deterministic noise.
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
const EDGES = [
  { src: 's:chlorine', rel: 'addresses', dst: 'p:diarrhoea' },
  { src: 's:cash', rel: 'addresses', dst: 'p:dropout' },
  { src: 's:deworm', rel: 'addresses', dst: 'p:absent' },
  { src: 's:nets', rel: 'addresses', dst: 'p:malaria' },
];
const cacheFor = async (nodes = NODES) => {
  const byText = new Map(nodes.map(n => [`${n.label}. ${n.text || ''}`.slice(0, 2000), n]));
  return D.refreshEmbeddings({ nodes, embed: async ts => ts.map(t => vec(byText.get(t).mix)), model: 'axes' });
};

test('quantize and pack round-trip keeps cosine similarity', () => {
  const a = vec({ 0: 1, 1: 0.5 }), b = vec({ 0: 1, 1: 0.4 }), c = vec({ 2: 1 });
  const M = D.unpack(D.pack([{ id: 'a', q: D.quantize(a).q }, { id: 'b', q: D.quantize(b).q }, { id: 'c', q: D.quantize(c).q }]));
  assert.ok(D.sim(M, 'a', 'b') > 0.95);
  assert.ok(D.sim(M, 'a', 'c') < 0.3);
  const hit = D.nearest(M, a, { k: 2 });
  assert.deepEqual(hit.map(h => h.id), ['a', 'b']);
  const json = JSON.parse(JSON.stringify(D.pack([{ id: 'x', q: D.quantize(a).q }]))); // the packed index survives JSON (a generated module or a KV value)
  assert.equal(D.unpack(json).ids[0], 'x');
});

test('embeddings refresh only what changed, and a failing batch never erases a good vector', async () => {
  const first = await cacheFor();
  assert.equal(first.embedded, NODES.length); assert.equal(first.errors.length, 0);
  let calls = 0;
  const same = await D.refreshEmbeddings({ nodes: NODES, cache: first.cache, model: 'axes', embed: async ts => { calls++; return ts.map(() => vec({ 0: 1 })); } });
  assert.equal(calls, 0); assert.equal(same.reused, NODES.length);
  const changed = NODES.map(n => n.id === 's:nets' ? { ...n, text: 'long-lasting insecticidal' } : n);
  const broken = await D.refreshEmbeddings({ nodes: changed, cache: first.cache, model: 'axes', embed: async () => { throw new Error('model down'); } });
  assert.equal(broken.errors.length, 1); assert.equal(broken.cache.rows['s:nets'].q, first.cache.rows['s:nets'].q);
  const capped = await D.refreshEmbeddings({ nodes: NODES, cache: {}, model: 'axes', max: 3, embed: async ts => ts.map(() => vec({ 0: 1 })) });
  assert.equal(capped.embedded, 3); assert.equal(capped.pending, NODES.length - 3);
  const gone = await D.refreshEmbeddings({ nodes: NODES.slice(1), cache: first.cache, model: 'axes', embed: async ts => ts.map(() => vec({ 0: 1 })) });
  assert.equal(gone.removed, 1);
});

test('discover finds the planted transfer, combination and frontier, and screens out what is already known', async () => {
  const { cache } = await cacheFor();
  const M = D.unpack(D.packCache(cache));
  const r = D.discover({ nodes: NODES, edges: EDGES, M, params: { pct: 0.5, minSim: 0.3, comboLow: 0.2 } });
  const t = r.candidates.filter(c => c.type === 'transfer');
  // chlorine works on diarrhoea; cholera is a water problem nothing links it to: the planted transfer
  assert.ok(t.some(c => c.members[0] === 's:chlorine' && c.members[1] === 'p:cholera' && c.via === 'p:diarrhoea'), JSON.stringify(t));
  // no candidate repeats a link the system already has
  for (const c of r.candidates) if (c.members.length === 2) assert.ok(!EDGES.some(e => (e.src === c.members[0] && e.dst === c.members[1]) || (e.dst === c.members[0] && e.src === c.members[1])));
  // cash (dropout) and deworming (absence) act on related schooling problems from different angles: the planted combination
  assert.ok(r.candidates.some(c => c.type === 'combination' && c.members.join() === 's:cash,s:deworm'), JSON.stringify(r.candidates));
  assert.ok(r.stats.communities >= 2);
  // a known combination is a duplicate and is not proposed again
  const r2 = D.discover({ nodes: NODES, edges: EDGES, M, params: { pct: 0.5, minSim: 0.3, comboLow: 0.2 }, known: [['s:cash', 's:deworm']] });
  assert.ok(!r2.candidates.some(c => c.type === 'combination' && c.members.join() === 's:cash,s:deworm'));
  // an unsolved problem far from every solution is a frontier
  const lonely = [...NODES, { id: 'p:roads', kind: 'problem', domain: 'transport', label: 'Road deaths', mix: { 9: 1.5 } }];
  const { cache: c2 } = await cacheFor(lonely);
  const r3 = D.discover({ nodes: lonely, edges: EDGES, M: D.unpack(D.packCache(c2)), params: { pct: 0.5, minSim: 0.3, comboLow: 0.2 } });
  assert.ok(r3.candidates.some(c => c.type === 'frontier' && c.members[0] === 'p:roads'));
  assert.match(D.explain(t[0], id => NODES.find(n => n.id === id)?.label || id), /alike/);
});

test('the ledger confirms a candidate the system later adopts, drops one that stops ranking, and keeps the accounting whole', async () => {
  const { cache } = await cacheFor();
  const M = D.unpack(D.packCache(cache)), P = { pct: 0.5, minSim: 0.3, comboLow: 0.2 };
  const r = D.discover({ nodes: NODES, edges: EDGES, M, params: P });
  let { ledger, run } = D.mergeLedger(null, r, { now: 0, edges: EDGES });
  assert.equal(run.new, r.candidates.length);
  const target = r.candidates.find(c => c.type === 'transfer' && c.members[1] === 'p:cholera');
  const adopted = [...EDGES, { src: target.members[0], rel: 'addresses', dst: target.members[1] }];
  const r2 = D.discover({ nodes: NODES, edges: adopted, M, params: P });
  ({ ledger, run } = D.mergeLedger(ledger, r2, { now: 86400000, edges: adopted }));
  assert.equal(ledger.entries[target.id].status, 'confirmed');
  assert.ok(run.confirmed >= 1);
  for (let i = 2; i < 6; i++) ({ ledger } = D.mergeLedger(ledger, { ...r2, candidates: [] }, { now: i * 86400000, edges: adopted }));
  assert.ok(Object.values(ledger.entries).some(e => e.status === 'dropped' && /not ranked/.test(e.reason)));
  assert.ok(ledger.totals.hit_rate > 0 && ledger.totals.hit_rate <= 1);
  const small = D.mergeLedger(ledger, r2, { now: 7 * 86400000, edges: adopted, keep: 2 }).ledger;
  const kept = Object.keys(small.entries).length, retired = Object.values(small.retired).reduce((a, b) => a + b, 0);
  assert.equal(kept + retired, small.totals.entered);
});

test('tune moves one knob one step with a prediction, and the prediction is scored by its own words', () => {
  const L = { runs: [{ at: 'x', new: 90, candidates: 100 }] };
  const { params, decision } = D.tune(L, { pct: 0.9 });
  assert.equal(params.pct, 0.91); assert.match(decision.prediction, /^new_candidates <= 40 within 24 h$/);
  assert.equal(D.scorePrediction(decision, { at: 'y', new: 12 }).kept, true);
  assert.equal(D.scorePrediction(decision, { at: 'y', new: 50 }).kept, false);
  assert.equal(D.tune({ runs: [{ new: 10, candidates: 30 }] }, { pct: 0.9 }).decision, null);
  assert.equal(D.tune({ runs: [{ new: 1, candidates: 2 }] }, { pct: 0.8 }).params.pct, 0.8); // floor holds
});

test('rank fusion and ports', async () => {
  const f = D.rrf([['a', 'b', 'c'], ['c', 'a', 'd']]);
  assert.equal(f[0].id, 'a'); assert.ok(f.some(x => x.id === 'd'));
  const M = D.unpack(D.pack([{ id: 'a', q: D.quantize(vec({ 0: 1 })).q }, { id: 'b', q: D.quantize(vec({ 1: 1 })).q }]));
  const port = D.choosePort(M, null);
  assert.equal(port.kind, 'packed'); assert.equal((await port.query(vec({ 1: 1 }), { topK: 1 }))[0].id, 'b');
  const calls = []; const fake = { upsert: async r => calls.push(r), query: async () => ({ matches: [{ id: 'z', score: 0.9 }] }) };
  assert.equal(D.choosePort(M, fake, { promoteAt: 1 }).kind, 'vectorize');
  assert.equal((await D.vectorizePort(fake).query([1, 0]))[0].id, 'z');
  assert.equal(D.hash('abc'), D.hash('abc')); assert.notEqual(D.hash('abc'), D.hash('abd'));
});
