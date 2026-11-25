// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// KGRAPH-1: the shared knowledge-graph engine. Extraction and identity, incremental sync with retirement (no silent drop), analytics,
// the insights loop (settle and calibrate), the read side, and the DDL kept equal to the migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import * as kg from '../src/knowledge.js';

const mappers = {
  paper: (d, { node, edge }) => {
    const p = node('paper', d.title, { year: d.year });
    for (const a of d.authors) edge(p, 'by', node('author', a));
    edge(p, 'about', node('topic', d.topic));
  },
};
const recs = list => list.map(d => ({ type: 'paper', source: 'paper/' + d.id, data: d }));
const base = [
  { id: 1, title: 'Deterrence', year: 2013, authors: ['Nagin'], topic: 'crime' },
  { id: 2, title: 'Imprisonment and reoffending', year: 2009, authors: ['Nagin', 'Cullen'], topic: 'crime' },
  { id: 3, title: 'Hot spots', year: 2019, authors: ['Braga'], topic: 'policing' },
  { id: 4, title: 'Disorder policing', year: 2015, authors: ['Braga', 'Welsh'], topic: 'policing' },
];
const spec = { predict: [{ from: 'paper', to: 'paper' }], gaps: [{ id: 'no-topic', kind: 'author', need: { rel: 'by', dir: 'in' }, text: n => `${n.label} has no paper` }], window_days: 1 };

test('identity: case, accents, punctuation and "et al." resolve to one entity; aliases merge', () => {
  assert.equal(kg.key('The Nagin, et al.'), 'nagin');
  assert.equal(kg.nodeId('author', 'Guimerà'), kg.nodeId('author', 'guimera'));
  assert.equal(kg.nodeId('author', 'D. Nagin', { 'author:d nagin': 'author:nagin' }), 'author:nagin');
  const f = kg.extract(recs(base.slice(0, 1)), mappers);
  assert.equal(f[0].nodes.length, 3); assert.equal(f[0].edges.length, 2); assert.match(f[0].hash, /^[0-9a-f]{16}$/);
  assert.equal(kg.extract(recs(base.slice(0, 1)), mappers)[0].hash, f[0].hash, 'hash is stable');
  assert.throws(() => kg.extract([{ type: 'x', source: 's', data: {} }], mappers), /no mapper/);
  assert.throws(() => kg.extract([...recs(base.slice(0, 1)), ...recs(base.slice(0, 1))], mappers), /duplicate source/);
});

test('model extraction keeps only schema triples whose quote is in the text', () => {
  const text = 'Nagin (2013) found that the certainty of being caught deters far more than severity of punishment.';
  const schema = { kinds: ['author', 'finding'], rels: ['found'] };
  const out = JSON.stringify({ triples: [
    { src: { kind: 'author', label: 'Nagin' }, rel: 'found', dst: { kind: 'finding', label: 'certainty deters' }, quote: 'the certainty of being caught deters far more' },
    { src: { kind: 'author', label: 'Nagin' }, rel: 'found', dst: { kind: 'finding', label: 'invented' }, quote: 'prison always lowers crime by a large amount' },
    { src: { kind: 'place', label: 'x' }, rel: 'found', dst: { kind: 'finding', label: 'y' }, quote: 'the certainty of being caught deters far more' }] });
  const r = kg.checkExtraction('model says: ' + out, text, schema);
  assert.equal(r.triples.length, 1); assert.equal(r.dropped, 2);
  assert.equal(kg.checkExtraction('nonsense', text, schema).reason, 'not json');
  assert.match(kg.extractPrompt(text, schema)[0].content, /Relations: found/);
});

test('sync is incremental: unchanged records write nothing, changed ones replace, removed ones are retired not deleted', async () => {
  const db = makeDb(); const t0 = 1_700_000_000_000;
  let r = await kg.sync(db, kg.extract(recs(base), mappers), { tenant: 't', now: t0 });
  assert.deepEqual(r, { added: 4, changed: 0, retired: 0, unchanged: 0 });
  r = await kg.sync(db, kg.extract(recs(base), mappers), { tenant: 't', now: t0 + 1 });
  assert.deepEqual(r, { added: 0, changed: 0, retired: 0, unchanged: 4 });
  const changed = base.map(d => (d.id === 4 ? { ...d, authors: ['Braga', 'Schnell'] } : d)).filter(d => d.id !== 1);
  r = await kg.sync(db, kg.extract(recs(changed), mappers), { tenant: 't', now: t0 + 2 });
  assert.deepEqual(r, { added: 0, changed: 1, retired: 1, unchanged: 2 });
  const g = await kg.load(db, 't');
  assert.ok(!g.nodes.has('paper:deterrence'), 'a retired record leaves the live graph');
  assert.ok(g.nodes.has('author:nagin'), 'Nagin is still mentioned by paper 2');
  assert.ok(g.nodes.has('author:schnell') && !g.nodes.has('author:welsh'));
  const kept = db.raw.prepare(`SELECT COUNT(*) AS n FROM kg_nodes WHERE tenant='t' AND retired_at IS NOT NULL`).get().n;
  assert.ok(kept > 0, 'retired facts are kept as history');
  assert.equal((await kg.load(db, 'other')).nodes.size, 0, 'tenants are isolated');
});

test('analytics: pagerank sums to one, communities split the two clusters, Adamic-Adar predicts the shared-author link', async () => {
  const db = makeDb();
  await kg.sync(db, kg.extract(recs(base), mappers), { tenant: '', now: 1 });
  const g = await kg.load(db, ''), an = kg.analyze(g, spec);
  assert.ok(Math.abs(Object.values(an.rank).reduce((s, x) => s + x, 0) - 1) < 1e-3);
  assert.equal(an.community['paper:deterrence'], an.community['paper:imprisonment and reoffending']);
  assert.notEqual(an.community['paper:deterrence'], an.community['paper:hot spots']);
  assert.ok(an.modularity > 0.3, `modularity ${an.modularity}`);
  const l = an.links.map(x => [x.a, x.b].sort().join('|'));
  assert.ok(l.includes('paper:deterrence|paper:imprisonment and reoffending'));
  assert.ok(!l.some(x => x.includes('deterrence') && x.includes('hot spots')), 'no link across unrelated clusters');
  assert.deepEqual(an.gaps, []);
});

test('the insights loop files findings, settles them against the graph, and re-weights kinds from outcomes', async () => {
  const db = makeDb(), D = 864e5; let now = 1_700_000_000_000;
  let r = await kg.runKg(db, { tenant: 'u', records: recs(base), mappers, spec, now });
  assert.ok(r.ok, r.error); assert.ok(r.insights_new >= 1);
  const open = await kg.insights(db, 'u');
  const link = open.find(i => i.kind === 'link');
  assert.ok(link, 'a predicted link is filed'); assert.match(link.text, /share/);
  // the predicted link appears in the data: kept on the next beat
  const linkedBase = [...base, { id: 5, title: 'Deterrence', year: 2013, authors: ['Nagin'], topic: 'crime', cites: true }];
  const m2 = { paper: (d, h) => { mappers.paper(d, h); if (d.cites) h.edge(h.node('paper', 'Deterrence'), 'cites', h.node('paper', 'Imprisonment and reoffending')); } };
  now += D / 2;
  r = await kg.runKg(db, { tenant: 'u', records: recs(linkedBase), mappers: m2, spec, now });
  assert.ok(r.ok, r.error); assert.ok(r.kept >= 1);
  assert.equal((await kg.insights(db, 'u', { status: 'kept' })).some(i => i.id === link.id), true);
  // a second run with nothing new files nothing twice
  now += D / 2; r = await kg.runKg(db, { tenant: 'u', records: recs(linkedBase), mappers: m2, spec, now });
  const ids = (await kg.insights(db, 'u', { status: 'any', limit: 500 })).map(i => i.id);
  assert.equal(new Set(ids).size, ids.length);
  // follows count as an outcome for a link nobody wrote down
  assert.equal(kg.judge({ kind: 'link', subject: 'paper:hot spots', object: 'paper:disorder policing', due_at: now + D, follows: 3 }, await kg.load(db, 'u'), { gaps: [], bridges: [] }, { now }), 'kept');
  assert.deepEqual(kg.calibrate([{ kind: 'link', status: 'kept' }, { kind: 'link', status: 'kept' }]), { link: 1 }, 'no change under the minimum');
  const w = kg.calibrate([...Array(6)].map((_, i) => ({ kind: 'gap', status: i ? 'dropped' : 'kept' })).concat([...Array(6)].map(() => ({ kind: 'link', status: 'kept' }))));
  assert.ok(w.gap < 1 && w.link > 1 && w.link <= 1.5 && w.gap >= 0.5);
  const h = await kg.kgHealth(db, 'u', now);
  assert.equal(h.ok, true); assert.ok(h.nodes > 0); assert.ok(h.kept_rate > 0);
});

test('a failing mapper is recorded on the run, not swallowed', async () => {
  const db = makeDb();
  const r = await kg.runKg(db, { tenant: 'x', records: [{ type: 'paper', source: 's', data: { title: '', authors: [], topic: 't' } }], mappers, now: 5 });
  assert.equal(r.ok, false); assert.match(r.error, /needs kind and label/);
  assert.equal((await kg.lastRun(db, 'x')).error, r.error);
  assert.equal((await kg.kgHealth(db, 'x', 5)).ok, false);
});

test('the JSON routes serve the graph, insights, a node, health and follows', async () => {
  const db = makeDb(), now = 1_700_000_000_000;
  await kg.runKg(db, { tenant: 'r', records: recs(base), mappers, spec, now });
  const get = p => kg.handleKg(new Request('https://x.test' + p), db, { tenant: 'r', now });
  const snap = await (await get('/api/graph.json')).json();
  assert.equal(snap.ok, true); assert.equal(snap.total.nodes, snap.nodes.length); assert.ok(snap.nodes[0].rank > 0);
  const ins = await (await get('/api/graph/insights')).json(); assert.ok(ins.insights.length >= 1);
  const nb = await (await get('/api/graph/node?id=author:nagin')).json(); assert.equal(nb.neighbors.length, 2);
  assert.equal((await get('/api/graph/health')).status, 200);
  const f = await kg.handleKg(new Request('https://x.test/api/graph/follow', { method: 'POST', body: JSON.stringify({ id: ins.insights[0].id }) }), db, { tenant: 'r' });
  assert.equal((await f.json()).ok, true);
  assert.equal(await get('/elsewhere'), null);
});

test('the Worker DDL equals the migration (a deploy ahead of its migration cannot fail)', () => {
  const sql = readFileSync(new URL('../migrations/0031_knowledge.sql', import.meta.url), 'utf8');
  for (const q of kg.KG_DDL) assert.ok(sql.includes(q), 'migration lacks: ' + q.slice(0, 60));
  assert.ok(JSON.parse(readFileSync(new URL('../migrations/index.json', import.meta.url), 'utf8')).includes('0031_knowledge.sql'));
});

test('the research is live: every practice is measured from the graph, and an empty graph says unmeasured or fails, never holds by default', async () => {
  const db = makeDb(), now = 1_700_000_000_000;
  const empty = await kg.practices(db, 'z', now);
  assert.equal(empty.practices.find(p => p.id === 'fresh').status, 'fails');
  assert.equal(empty.practices.find(p => p.id === 'calibrated-insights').status, 'unmeasured');
  await kg.runKg(db, { tenant: 'z', records: recs(base), mappers, spec, now });
  const p = await kg.practices(db, 'z', now);
  assert.equal(p.practices.length, kg.KG_PRACTICES.length);
  for (const id of ['schema-first', 'provenance', 'entity-resolution', 'communities', 'bounded-cost', 'fresh']) assert.equal(p.practices.find(x => x.id === id).status, 'holds', id);
  for (const x of p.practices) assert.match(x.source.url, /^https:\/\//);
  const html = kg.methodHtml(p); assert.match(html, /re-checked each time/); assert.doesNotMatch(html, /<script/);
  const r = await kg.handleKg(new Request('https://x.test/api/graph/method'), db, { tenant: 'z', now });
  assert.equal((await r.json()).practices.length, kg.KG_PRACTICES.length);
});

test('every seeded system keeps a graph of its own records; an unmeasured objective becomes one KG item, throttled to once an hour', async () => {
  const { knowledgeStep } = await import('../src/kgstep.js');
  const db = makeDb(), now = Date.parse('2026-11-25T16:00:00Z');
  db.raw.exec(`INSERT INTO objectives (id, statement, owner_role) VALUES ('OBJ-1','Readers come back weekly','product-manager'), ('OBJ-2','Costs stay inside budget','operations')`);
  db.raw.exec(`INSERT INTO metrics (id, objective_id, name, kind, source, spec, op, threshold, owner_role, remedy) VALUES ('M-1','OBJ-2','cost per day','target','sql','SELECT 1','<=',1,'operations','cut cost'), ('M-2',NULL,'return visits','target','sql','SELECT 1','>=',1,'product-manager','grow')`);
  db.raw.exec(`INSERT INTO items (id, title, owner_role, done_check, project) VALUES ('W-1','Ship the feed','product-manager','feed live','growth')`);
  const filed = [];
  const ensureItem = async (_db, it) => { filed.push(it); return true; };
  const ctx = { config: { org_slug: 'acme' } };
  const r = await knowledgeStep(db, ctx, ensureItem, { now });
  assert.ok(r.ok, r.error); assert.ok(r.nodes >= 6);
  assert.equal(filed.length, 1); assert.match(filed[0].id, /^KG-G-unmeasured-objective-OBJ-1/); assert.match(filed[0].title, /Readers come back weekly/);
  const ins = await kg.insights(db, 'acme', { kind: 'link' });
  assert.ok(ins.some(i => i.subject === 'metric:M-2' || i.object === 'metric:M-2'), 'the unattached metric is proposed for the objective its owner holds');
  assert.deepEqual(await knowledgeStep(db, ctx, ensureItem, { now: now + 60000 }), { skipped: true });
});

test('via_kinds limits the shared neighbours that count as evidence for a predicted link', async () => {
  const db = makeDb();
  await kg.sync(db, kg.extract(recs(base), mappers), { tenant: 'v', now: 1 });
  const g = await kg.load(db, 'v');
  assert.ok(kg.analyze(g, { ...spec, via_kinds: ['author'] }).links.every(l => l.via.every(v => v.startsWith('author:'))));
  assert.equal(kg.analyze(g, { ...spec, via_kinds: ['venue'] }).links.length, 0);
});
