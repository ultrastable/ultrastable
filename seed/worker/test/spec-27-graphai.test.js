// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-27: the Workers AI layer on the data graph (seed/worker/src/graphai.js): embeddings, extracted relations, community summaries, the spend throttle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { DATAGRAPH_DDL } from '../src/datagraph.js';
import { graphAiStep, readGraphAi, budget, DEFAULTS, DDL } from '../src/graphai.js';

const T = (n = 0) => new Date(Date.parse('2026-11-25T00:00:00Z') + n * 1000).toISOString();
const db0 = () => { const db = makeDb(); for (const s of DATAGRAPH_DDL) db.raw.exec(s); return db; };
const rows = (db, sql, ...a) => db.raw.prepare(sql).all(...a);
const addNode = (db, id, label, n = 0, valid = null) => db.raw.prepare(`INSERT INTO kg_nodes (id, kind, label, first_seen, changed_at, valid_to) VALUES (?,?,?,?,?,?)`).run(id, id.split(':')[0], label, T(n), T(n), valid);
// A model that records what it was asked. `reply` answers a relation-extraction prompt, `summary` a summarize prompt.
const model = ({ reply = '[]', summary = 'Records about deploys.', vec = [0.123456, 0.2] } = {}) => { const calls = []; return { calls, run: async (m, inp) => { calls.push({ m, inp }); if (inp.text) return { data: inp.text.map(() => vec) }; return { response: inp.messages[0].content.startsWith('Reply with JSON') ? reply : summary }; } }; };
const NOW = Date.parse('2026-11-25T06:00:00Z');

test('US-27-R24: a pass embeds only the labels of live nodes changed since its cursor, in batches, and stores the vectors rounded to four decimals', async () => {
  assert.equal(DEFAULTS.embed_max, 64); assert.equal(DEFAULTS.embed_model, '@cf/baai/bge-small-en-v1.5');
  const db = db0(); for (let i = 0; i < 70; i++) addNode(db, `items:n${String(i).padStart(2, '0')}`, 'x'.repeat(i === 0 ? 900 : 10), i); addNode(db, 'items:closed', 'gone', 5, T(6));
  const ai = model(), r = await graphAiStep({ db, ai, now: NOW });
  assert.equal(r.embedded, 64, 'one batch of at most embed_max'); assert.equal(ai.calls.length, 1); assert.equal(ai.calls[0].m, DEFAULTS.embed_model);
  assert.ok(ai.calls[0].inp.text.every(t => t.length <= 500), 'a label is cut at 500 characters'); assert.ok(!ai.calls[0].inp.text.includes('gone'), 'a closed node is not embedded');
  assert.equal(rows(db, `SELECT vec FROM kg_vec LIMIT 1`)[0].vec, '[0.1235,0.2]');
  assert.equal(rows(db, `SELECT at FROM kg_ai_cursor WHERE name='nodes'`)[0].at, rows(db, `SELECT MAX(changed_at) AS m FROM (SELECT changed_at FROM kg_nodes WHERE valid_to IS NULL ORDER BY changed_at LIMIT 64)`)[0].m);
  const next = await graphAiStep({ db, ai: model(), now: NOW + 1 }); assert.equal(next.embedded, 6, 'the rest on the next pass: 70 live nodes less the 64 done');
  const quiet = await graphAiStep({ db, ai: model(), now: NOW + 2 }); assert.equal(quiet.embedded, 0, 'nothing changed, nothing embedded');
  db.raw.exec(`UPDATE kg_nodes SET changed_at='${T(500)}' WHERE id='items:n03'`);
  const one = model(); assert.equal((await graphAiStep({ db, ai: one, now: NOW + 3 })).embedded, 1); assert.deepEqual(one.calls[0].inp.text, ['xxxxxxxxxx']);
});

test('US-27-R24: no AI binding skips the pass, and a model that fails is recorded and never throws', async () => {
  const db = db0(); addNode(db, 'items:a', 'one');
  const none = await graphAiStep({ db, ai: null, now: NOW });
  assert.deepEqual([none.skipped, none.embedded, none.proposed, none.summarized, none.neurons], ['no AI binding', 0, 0, 0, 0]);
  const bad = await graphAiStep({ db, ai: { run: async () => { throw new Error('model down'); } }, now: NOW });
  assert.deepEqual(bad.errors, ['embed: model down']); assert.equal(bad.embedded, 0);
});

test('US-27-R25: ids a label names are offered to the model, and only the answers that name one of them and a live node become proposed edges with source ai', async () => {
  const db = db0(); addNode(db, 'items:Q-ONE-1', 'first', 0); addNode(db, 'items:Q-TWO-2', 'Q-TWO-2 waits on Q-ONE-1 and Q-GHOST-9', 1); addNode(db, 'items:plain', 'nothing to extract', 2);
  const reply = JSON.stringify([{ dst: 'Q-ONE-1', rel: 'Blocks It!' }, { dst: 'Q-GHOST-9', rel: 'knows' }, { dst: 'Q-NOT-OFFERED-1', rel: 'knows' }, { dst: 'Q-TWO-2', rel: 'self' }]);
  const ai = model({ reply }); const r = await graphAiStep({ db, ai, now: NOW });
  const asked = ai.calls.filter(c => c.inp.messages); assert.equal(asked.length, 1, 'only a label that names an id is sent'); assert.match(asked[0].inp.messages[1].content, /Ids: Q-TWO-2, Q-ONE-1, Q-GHOST-9/);
  assert.equal(r.proposed, 1);
  const e = rows(db, `SELECT * FROM kg_edges WHERE source='ai'`); assert.equal(e.length, 1);
  assert.deepEqual([e[0].src, e[0].rel, e[0].dst, e[0].status, e[0].confidence], ['items:Q-TWO-2', 'blocks_it_', 'items:Q-ONE-1', 'proposed', 0.5]);
  // never overwrites an edge the data graph already holds; and the layer never confirms anything
  db.raw.exec(`DELETE FROM kg_edges; INSERT INTO kg_edges (src, rel, dst, status, confidence, source, first_seen) VALUES ('items:Q-TWO-2','blocks_it_','items:Q-ONE-1','confirmed',1,'value:items.x','${T(0)}')`);
  db.raw.exec(`UPDATE kg_nodes SET changed_at='${T(900)}' WHERE id='items:Q-TWO-2'`); await graphAiStep({ db, ai: model({ reply }), now: NOW + 5 });
  assert.equal(rows(db, `SELECT status FROM kg_edges`)[0].status, 'confirmed');
  assert.ok(rows(db, `SELECT status FROM kg_edges WHERE source='ai'`).every(x => x.status === 'proposed'));
  // at most extract_max labels a pass
  const many = db0(); for (let i = 0; i < 5; i++) addNode(many, `items:Q-AAA-${i}`, `Q-AAA-${i} mentions Q-AAA-9`, i);
  const m = model({ reply: '[]' }); await graphAiStep({ db: many, ai: m, config: { graph_ai: { extract_max: 2 } }, now: NOW });
  assert.equal(m.calls.filter(c => c.inp.messages).length, 2);
  // a reply that is not JSON proposes nothing and is recorded
  const junk = db0(); addNode(junk, 'items:Q-ONE-1', 'x', 0); addNode(junk, 'items:Q-TWO-2', 'Q-TWO-2 after Q-ONE-1', 1);
  const j = await graphAiStep({ db: junk, ai: model({ reply: 'sorry, no' }), now: NOW }); assert.equal(j.proposed, 0);
  const broken = await graphAiStep({ db: junk, ai: model({ reply: '[{"dst": ' + 'oops' }), now: NOW + 1 }); assert.equal(broken.proposed, 0);
});

test('US-27-R26: open community insights without a current summary get a one-sentence summary of at most 300 characters, a few a pass', async () => {
  assert.equal(DEFAULTS.summarize_max, 4);
  const db = db0();
  for (let i = 1; i <= 6; i++) db.raw.prepare(`INSERT INTO kg_insights (id, kind, subject, text, state, first_seen, last_seen) VALUES (?,?,?,?,?,?,?)`).run('c' + i, 'community', 'c:' + i, 'deploy items ' + i, 'open', T(), T());
  db.raw.prepare(`INSERT INTO kg_insights (id, kind, subject, text, state, first_seen, last_seen) VALUES ('c9','community','c:9','closed one','cleared',?,?), ('o1','orphans','orphans:x','not a community','open',?,?)`).run(T(), T(), T(), T());
  const long = 'S'.repeat(500), ai = model({ summary: ' ' + long + ' ' });
  const r = await graphAiStep({ db, ai, now: NOW });
  assert.equal(r.summarized, 4); assert.equal(rows(db, `SELECT COUNT(*) AS n FROM kg_summaries`)[0].n, 4); assert.ok(rows(db, `SELECT text FROM kg_summaries`).every(x => x.text.length === 300));
  assert.equal((await graphAiStep({ db, ai: model(), now: NOW + 1 })).summarized, 2, 'the rest next pass: a summarized insight is not summarized again');
  assert.equal((await graphAiStep({ db, ai: model(), now: NOW + 2 })).summarized, 0);
  db.raw.exec(`UPDATE kg_insights SET last_seen='${new Date(NOW + 60e3).toISOString()}' WHERE id='c2'`);
  assert.equal((await graphAiStep({ db, ai: model({ summary: 'Fresh.' }), now: NOW + 3 })).summarized, 1, 'an insight seen again after its summary is summarized again');
  assert.equal(rows(db, `SELECT text FROM kg_summaries WHERE subject='c:2'`)[0].text, 'Fresh.');
  assert.ok(!rows(db, `SELECT subject FROM kg_summaries`).some(x => x.subject === 'c:9' || x.subject === 'orphans:x'), 'only open community insights');
});

test('US-27-R27: the spend throttle shrinks every batch and never turns the layer off, and a daily neuron share bounds the cost and files an item when spent', async () => {
  const k = { embed_max: 64, extract_max: 8, summarize_max: 4 };
  assert.deepEqual(budget(k, null), { pace: 1, embed: 64, extract: 8, summarize: 4 });
  assert.deepEqual(budget(k, { knobs: { pace: 4 } }), { pace: 4, embed: 16, extract: 2, summarize: 1 });
  assert.deepEqual(budget(k, { knobs: { pace: 100 } }), { pace: 100, embed: 1, extract: 1, summarize: 1 });
  assert.equal(budget(k, { knobs: { pace: 0.2 } }).pace, 1, 'a pace below one is one');
  assert.deepEqual(DEFAULTS.cost, { embed: 1, extract: 40, summarize: 40 }); assert.equal(DEFAULTS.daily_neurons, 2500);
  const db = db0(); for (let i = 0; i < 20; i++) addNode(db, `items:n${i}`, 'label ' + i, i);
  const filed = [], ensureItem = async (_db, item) => { filed.push(item); return true; };
  const cfg = { graph_ai: { daily_neurons: 10 } };
  const first = await graphAiStep({ db, ai: model(), config: cfg, ensureItem, now: NOW });
  assert.equal(first.embedded, 20); assert.equal(first.neurons, 20, 'one neuron for each embedded label'); assert.deepEqual(filed, [], 'under the share when the pass began');
  addNode(db, 'items:late', 'late', 900);
  const spent = await graphAiStep({ db, ai: model(), config: cfg, ensureItem, now: NOW + 1 });
  assert.equal(spent.skipped, 'daily share used'); assert.equal(spent.embedded, 0);
  assert.equal(filed.length, 1); assert.equal(filed[0].id, 'KG-COST-2026-11-25'); assert.equal(filed[0].owner_role, 'product-manager'); assert.match(filed[0].title, /Prediction: kg_cost <= 10 within 24 h/);
  const nextDay = await graphAiStep({ db, ai: model(), config: cfg, ensureItem, now: NOW + 86400e3 });
  assert.equal(nextDay.embedded, 1, 'a new day, a new share'); assert.equal(nextDay.skipped, null);
  assert.equal((await graphAiStep({ db, ai: model(), config: cfg, ensureItem: async () => { throw new Error('queue down'); }, now: NOW + 2 })).skipped, 'daily share used', 'a failing item filer never stops the pass');
  const v = await readGraphAi(db, NOW + 3);
  assert.deepEqual(v.cost_today, { neurons: 20, calls: 1 }); assert.equal(v.share, 2500); assert.equal(v.embedded, 21); assert.ok(Array.isArray(v.summaries));
  assert.equal(DDL.length, 4);
});
