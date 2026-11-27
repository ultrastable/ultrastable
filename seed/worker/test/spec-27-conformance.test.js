// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-27 conformance tests T01 to T04 and T08: the data graph run end to end through the tick loop, its read side and its AI layer, over an in-memory D1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { datagraphStep, readGraph, readInsights, readNode, searchGraph, _reset } from '../src/datagraph.js';
import { graphAiStep } from '../src/graphai.js';
import { ensureItem } from '../src/tick.js';

const NOW = Date.parse('2026-11-25T12:00:00Z'), H = 3600e3, D = 24 * H;
function bareDb() { const db = makeDb(); for (const r of db.raw.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all()) db.raw.exec(`DROP TABLE IF EXISTS "${r.name}"`); _reset(); return db; }
const rows = (db, sql, ...a) => db.raw.prepare(sql).all(...a);
const SECRET = 'ghs_never_in_the_graph', MAIL = 'person@example.org', PRIVATE = 'a private reply naming F-ego';
function world() {
  const db = bareDb();
  db.raw.exec(`CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT, status TEXT, disposition TEXT, closing_probe TEXT, owner_role TEXT, kind TEXT, done_check TEXT, priority INTEGER, surface TEXT, action_class TEXT, updated_at TEXT);
    CREATE TABLE budget_ledger (day TEXT, kind TEXT, units REAL, calls INTEGER, refused INTEGER, PRIMARY KEY (day, kind));
    CREATE TABLE fields (id TEXT PRIMARY KEY, name TEXT); CREATE TABLE findings (id TEXT PRIMARY KEY, title TEXT, field_id TEXT);
    CREATE TABLE studies (id TEXT PRIMARY KEY, title TEXT, finding_id TEXT, reviewer_email TEXT); CREATE TABLE replications (id TEXT PRIMARY KEY, notes TEXT);
    CREATE TABLE oauth_tokens (id TEXT PRIMARY KEY, token TEXT); CREATE TABLE human_inbox (id TEXT PRIMARY KEY, body TEXT);
    INSERT INTO fields VALUES ('psych','Psychology'),('med','Medicine');
    INSERT INTO findings VALUES ('F-ego','Ego depletion','psych'),('F-prime','Elderly priming','psych'),('F-hrt','HRT protects the heart','med');
    INSERT INTO studies VALUES ('S-1998','Baumeister 1998','F-ego','${MAIL}'),('S-1996','Bargh 1996','F-prime',NULL),('S-whi','WHI trial','F-hrt',NULL);
    INSERT INTO replications VALUES ('R-1','Registered report of S-1998 in 23 labs; effect near zero, see also S-1996.'),('R-2','Direct replication of S-1996; no effect found.');
    INSERT INTO oauth_tokens VALUES ('gh','${SECRET}'); INSERT INTO human_inbox VALUES ('m1','${PRIVATE}');`);
  return db;
}

test('US-27-T01: every row of the ordinary tables is a node and every reference an edge, and no secret, address or private message reaches any table of the graph', async () => {
  const db = world(), r = await datagraphStep({ db, ensureItem, now: NOW });
  const ids = new Set(rows(db, `SELECT id FROM kg_nodes`).map(x => x.id));
  for (const id of ['fields:psych', 'findings:F-ego', 'studies:S-whi', 'replications:R-2']) assert.ok(ids.has(id), id);
  assert.ok(rows(db, `SELECT 1 FROM kg_edges WHERE src='studies:S-1998' AND rel='finding_id' AND dst='findings:F-ego' AND status='confirmed'`).length, 'a reference found from the data');
  assert.ok(rows(db, `SELECT 1 FROM kg_edges WHERE src='replications:R-1' AND rel='mentions' AND dst='studies:S-1998'`).length, 'an id written in text');
  assert.ok(![...ids].some(i => i.startsWith('oauth_tokens:') || i.startsWith('human_inbox:')));
  for (const t of ['kg_nodes', 'kg_edges', 'kg_insights', 'kg_runs']) { const all = JSON.stringify(rows(db, `SELECT * FROM ${t}`)); for (const s of [SECRET, MAIL, PRIVATE]) assert.ok(!all.includes(s), `${t} holds ${s}`); }
  assert.ok(r.dropped.tables.includes('oauth_tokens') && r.dropped.tables.includes('human_inbox') && r.dropped.columns >= 1);
});

test('US-27-T02: a quiet second pass writes nothing, a changed row is rewritten, and a deleted row is closed and kept as history', async () => {
  const db = world(); await datagraphStep({ db, now: NOW });
  const quiet = await datagraphStep({ db, now: NOW + 7 * H }); assert.deepEqual(quiet.changes, { nodes_new: 0, nodes_changed: 0, nodes_closed: 0, edges_new: 0, edges_closed: 0 });
  db.raw.exec(`UPDATE findings SET title='Ego depletion (contested)' WHERE id='F-ego'; DELETE FROM studies WHERE id='S-whi'`);
  const r = await datagraphStep({ db, now: NOW + 14 * H }); assert.equal(r.changes.nodes_changed, 1); assert.equal(r.changes.nodes_closed, 1);
  assert.equal(rows(db, `SELECT valid_to FROM kg_nodes WHERE id='studies:S-whi'`)[0].valid_to, new Date(NOW + 14 * H).toISOString());
  assert.equal(rows(db, `SELECT label FROM kg_nodes WHERE id='findings:F-ego'`)[0].label, 'Ego depletion (contested)');
});

test('US-27-T03: a link lead is a proposed edge and no structure; the data later links the pair and it is kept, or nothing does for fourteen days and it is dropped', async () => {
  const mk = () => { const db = bareDb(); db.raw.exec(`CREATE TABLE things (id TEXT PRIMARY KEY, a TEXT, b TEXT); INSERT INTO things VALUES ('hub-a',NULL,NULL),('hub-b',NULL,NULL),('x-one','hub-a','hub-b'),('y-two','hub-a','hub-b')`); return db; };
  let db = mk(); await datagraphStep({ db, now: NOW });
  const lead = rows(db, `SELECT src, dst FROM kg_edges WHERE status='proposed' AND (src='things:x-one' OR src='things:y-two')`)[0]; assert.ok(lead, 'x-one and y-two share both hubs');
  const g = await readGraph(db, { open: true }); assert.equal(g.last.edges, 4, 'the four references; the proposed lead is not counted as a link');
  db.raw.exec(`ALTER TABLE things ADD COLUMN peer TEXT; UPDATE things SET peer='y-two' WHERE id='x-one'`);
  const kept = await datagraphStep({ db, now: NOW + 7 * H }); assert.ok(kept.proposals.kept >= 1); assert.equal(rows(db, `SELECT outcome FROM kg_edges WHERE status='kept'`)[0].outcome, 'kept');
  db = mk(); await datagraphStep({ db, now: NOW }); const open = rows(db, `SELECT COUNT(*) AS n FROM kg_edges WHERE status='proposed'`)[0].n;
  const late = await datagraphStep({ db, now: NOW + 15 * D }); assert.equal(late.proposals.dropped, open); assert.equal(rows(db, `SELECT COUNT(*) AS n FROM kg_edges WHERE status='proposed'`)[0].n, 0);
  assert.equal(rows(db, `SELECT COUNT(*) AS n FROM kg_edges WHERE outcome='dropped' AND status='rejected'`)[0].n, open);
});

test('US-27-T04: a stranger sees counts and orphan findings and the kinds a system declares public; the owner sees every record', async () => {
  const db = world(); db.raw.exec(`CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT)`); for (let i = 0; i < 12; i++) db.raw.exec(`INSERT INTO notes VALUES ('note-${i}','loose note ${i}')`);
  await datagraphStep({ db, ensureItem, now: NOW });
  const stranger = await readGraph(db), owner = await readGraph(db, { open: true });
  assert.equal(stranger.last.nodes, owner.last.nodes); assert.ok(stranger.last.hubs.every(h => h.redacted && /^a .+ record$/.test(h.label))); assert.ok(owner.last.hubs.every(h => !h.redacted && h.id));
  assert.ok((await readInsights(db)).insights.every(i => ['orphans', 'fragmenting'].includes(i.kind))); assert.equal(await readNode(db, 'findings:F-ego'), null); assert.deepEqual((await searchGraph(db, 'priming')).results, []);
  assert.ok(await readNode(db, 'findings:F-ego', { open: true })); assert.equal((await searchGraph(db, 'priming', { open: true })).results.length, 1);
  const declared = { publicKinds: ['findings', 'studies'] }; assert.ok((await readNode(db, 'findings:F-ego', declared)).neighbors.every(n => declared.publicKinds.includes(n.kind)));
});

test('US-27-T04: a private record that shares two neighbours with a public one, and the tables left out, reach a stranger as counts only', async () => {
  const db = world();
  // the private kind sorts after the public ones, so a lead between them has the public record as its subject
  db.raw.exec(`CREATE TABLE zdrafts (id TEXT PRIMARY KEY, title TEXT, finding_a TEXT, finding_b TEXT); INSERT INTO zdrafts VALUES ('d-unpublished','Unpublished draft on priming','F-prime','F-ego');
    CREATE TABLE reviews (id TEXT PRIMARY KEY, title TEXT, finding_a TEXT, finding_b TEXT); INSERT INTO reviews VALUES ('rv-1','Published review','F-prime','F-ego');`);
  await datagraphStep({ db, ensureItem, now: NOW });
  const owner = JSON.stringify([await readGraph(db, { open: true }), await readInsights(db, { open: true })]);
  for (const s of ['link:fields:psych|zdrafts:d-unpublished', 'Unpublished draft on priming', 'oauth_tokens', 'human_inbox']) assert.ok(owner.includes(s), `the owner sees ${s}`);
  for (const publicKinds of [[], ['reviews'], ['reviews', 'findings'], ['fields', 'reviews', 'findings']]) {
    const seen = JSON.stringify([await readGraph(db, { publicKinds }), await readInsights(db, { publicKinds })]);
    for (const s of ['d-unpublished', 'Unpublished draft', 'oauth_tokens', 'human_inbox', SECRET, MAIL, PRIVATE]) assert.ok(!seen.includes(s), `public kinds [${publicKinds}]: "${s}" reached a stranger`);
  }
  const g = await readGraph(db, { publicKinds: ['reviews'] }); assert.ok(Number.isInteger(g.last.dropped.tables) && g.last.dropped.tables >= 2 && g.last.read_errors === 0, 'the tables left out are counted');
});

test('US-27-T08: the AI layer can fail or be spent without stopping the data graph, and it only ever adds proposed edges', async () => {
  const db = world(); db.raw.exec(`CREATE TABLE things (id TEXT PRIMARY KEY, label TEXT)`); db.raw.exec(`INSERT INTO things VALUES ('Q-ONE-1','first'),('Q-TWO-2','Q-TWO-2 waits on Q-ONE-1')`);
  await datagraphStep({ db, ensureItem, now: NOW });
  const before = rows(db, `SELECT COUNT(*) AS n FROM kg_edges WHERE status='confirmed'`)[0].n;
  const down = await graphAiStep({ db, ai: { run: async () => { throw new Error('model down'); } }, now: NOW }); assert.ok(down.errors.length >= 1);
  const spent = await graphAiStep({ db, ai: { run: async () => ({ data: [] }) }, config: { graph_ai: { daily_neurons: 0 } }, ensureItem, now: NOW + 1 }); assert.equal(spent.skipped, 'daily share used');
  const next = await datagraphStep({ db, ensureItem, now: NOW + 7 * H }); assert.ok(next.nodes > 10, 'the graph is built regardless');
  const ai = { run: async (m, inp) => (inp.text ? { data: inp.text.map(() => [1]) } : { response: '[{"dst":"Q-ONE-1","rel":"blocks"}]' }) }; db.raw.exec(`UPDATE kg_nodes SET changed_at='2027-01-01T00:00:00Z' WHERE id='things:Q-TWO-2'`);
  await graphAiStep({ db, ai, now: NOW + 2 * D }); assert.ok(rows(db, `SELECT status FROM kg_edges WHERE source='ai'`).every(x => x.status === 'proposed'));
  assert.equal(rows(db, `SELECT COUNT(*) AS n FROM kg_edges WHERE status='confirmed'`)[0].n, before, 'nothing the model said became structure');
});
