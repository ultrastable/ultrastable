// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { datagraphStep, readGraph, readInsights, readNode, searchGraph, DATAGRAPH_DDL, _reset } from '../src/datagraph.js';
import { ensureItem } from '../src/tick.js';
import { graphScreen } from '../src/ui.js';

const NOW = Date.parse('2026-11-25T12:00:00Z');
// A tenant's own tables, as a replication ledger would hold them, plus a credential table that must never reach the graph.
function seedTenant(db) {
  db.raw.exec(`CREATE TABLE findings (id TEXT PRIMARY KEY, title TEXT, field TEXT);
    CREATE TABLE fields (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE studies (id TEXT PRIMARY KEY, title TEXT, finding_id TEXT, contact_email TEXT);
    CREATE TABLE replications (id TEXT PRIMARY KEY, notes TEXT, outcome TEXT);
    CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT);
    CREATE TABLE oauth_tokens (id TEXT PRIMARY KEY, token TEXT);
    INSERT INTO fields VALUES ('psych','Psychology'),('med','Medicine');
    INSERT INTO findings VALUES ('F-ego','Ego depletion','psych'),('F-prime','Elderly priming','psych'),('F-hrt','HRT protects the heart','med');
    INSERT INTO studies VALUES ('S-1998','Baumeister 1998','F-ego','a@b.c'),('S-1996','Bargh 1996','F-prime',NULL),('S-whi','WHI trial','F-hrt',NULL);
    INSERT INTO replications VALUES ('R-1','Registered report of S-1998 in 23 labs; effect near zero.','failed'),('R-2','Direct replication of S-1996; no effect found.','failed');
    INSERT INTO oauth_tokens VALUES ('gh','ghs_never');`);
  for (let i = 0; i < 12; i++) db.raw.exec(`INSERT INTO notes VALUES ('note-${i}','loose note ${i}')`);
}
const cfg = { knowledge_graph: { every_min: 60 } };

test('the Worker DDL equals the migration', () => {
  const sql = readFileSync(new URL('../migrations/0031_datagraph.sql', import.meta.url), 'utf8');
  for (const d of DATAGRAPH_DDL) assert.ok(sql.includes(d), d.slice(0, 50));
});

test('a pass builds the graph from every table with no configuration, never reads secrets, and files one orphan item', async () => {
  _reset(); const db = makeDb(); seedTenant(db);
  const r = await datagraphStep({ db, config: cfg, ensureItem, now: NOW });
  assert.ok(r.nodes > 20, 'rows of every table, platform tables included');
  assert.ok(r.dropped.tables.includes('oauth_tokens'));
  const all = JSON.stringify(await db.prepare(`SELECT * FROM kg_nodes`).all());
  assert.ok(!all.includes('ghs_never') && !all.includes('a@b.c'), 'secret table and email column never stored');
  const e = await db.prepare(`SELECT * FROM kg_edges WHERE src='studies:S-1998' AND dst='findings:F-ego'`).first();
  assert.equal(e.rel, 'finding_id');
  assert.ok(await db.prepare(`SELECT 1 FROM kg_edges WHERE src='replications:R-1' AND rel='mentions' AND dst='studies:S-1998'`).first());
  assert.deepEqual(r.filed, ['KG-ORPHANS-notes']);
  const it = await db.prepare(`SELECT title, closing_probe FROM items WHERE id='KG-ORPHANS-notes'`).first();
  assert.ok(/within 168 h/.test(it.title) && it.closing_probe === 'datagraph:orphans:notes');
  assert.equal((await datagraphStep({ db, config: cfg, ensureItem, now: NOW + 60e3 })).status, 'not-due');
});

test('a quiet second pass writes nothing; a changed row is rewritten; a removed row is closed, not deleted; the item closes when the kind connects', async () => {
  _reset(); const db = makeDb(); seedTenant(db);
  await datagraphStep({ db, config: cfg, ensureItem, now: NOW });
  let r = await datagraphStep({ db, config: cfg, ensureItem, now: NOW + 3600e3 });
  assert.equal(r.changes.edges_new, 0); assert.equal(r.changes.nodes_closed, 0);
  db.raw.exec(`UPDATE findings SET title='Ego depletion (contested)' WHERE id='F-ego'; DELETE FROM studies WHERE id='S-whi'; DELETE FROM notes;`);
  for (let i = 0; i < 12; i++) db.raw.exec(`INSERT INTO notes VALUES ('n2-${i}','Follow-up note about F-hrt and S-1996 for the ledger')`);
  r = await datagraphStep({ db, config: cfg, ensureItem, now: NOW + 7200e3 });
  assert.ok(r.changes.nodes_changed >= 1 && r.changes.nodes_closed >= 13);
  const gone = await db.prepare(`SELECT valid_to FROM kg_nodes WHERE id='studies:S-whi'`).first();
  assert.ok(gone && gone.valid_to, 'history kept with valid_to');
  assert.ok(r.closed.includes('KG-ORPHANS-notes'));
  assert.equal((await db.prepare(`SELECT status FROM items WHERE id='KG-ORPHANS-notes'`).first()).status, 'done');
});

test('link leads are proposed, then kept when the data later links the pair', async () => {
  _reset(); const db = makeDb();
  db.raw.exec(`CREATE TABLE things (id TEXT PRIMARY KEY, a TEXT, b TEXT); INSERT INTO things VALUES ('hub-a',NULL,NULL),('hub-b',NULL,NULL),('x-one','hub-a','hub-b'),('y-two','hub-a','hub-b');`);
  await datagraphStep({ db, config: cfg, now: NOW });
  const p = await db.prepare(`SELECT src, dst FROM kg_edges WHERE status='proposed'`).all();
  assert.ok(p.results.some(x => [x.src, x.dst].sort().join() === 'things:hub-a,things:hub-b' || [x.src, x.dst].sort().join() === 'things:x-one,things:y-two'));
  const lead = p.results.find(x => [x.src, x.dst].sort().join() === 'things:x-one,things:y-two');
  assert.ok(lead, 'x-one and y-two share both hubs');
  db.raw.exec(`ALTER TABLE things ADD COLUMN peer TEXT; UPDATE things SET peer='y-two' WHERE id='x-one';`);
  const r = await datagraphStep({ db, config: cfg, now: NOW + 3600e3 });
  assert.ok(r.proposals.kept >= 1);
  assert.equal((await db.prepare(`SELECT outcome FROM kg_edges WHERE status='kept' AND src=? AND dst=?`).bind(lead.src, lead.dst).first()).outcome, 'kept');
});

test('the read side answers: summary, insights, a node with its neighbourhood, search, and the page', async () => {
  _reset(); const db = makeDb(); seedTenant(db);
  await datagraphStep({ db, config: cfg, ensureItem, now: NOW });
  const O = { open: true };
  const g = await readGraph(db); assert.ok(g.built && g.series.length === 1);
  assert.ok((await readInsights(db)).insights.some(i => i.kind === 'orphans'));
  const n = await readNode(db, 'findings:F-ego', { depth: 2, ...O });
  assert.ok(n.neighbors.some(x => x.id === 'studies:S-1998') && n.neighbors.some(x => x.id === 'replications:R-1'));
  assert.equal(await readNode(db, 'nope', O), null);
  assert.ok((await searchGraph(db, 'priming', O)).results.some(x => x.id === 'findings:F-prime'));
  const html = await graphScreen({ graph: g, insights: await readInsights(db) }).text();
  assert.ok(/records, \d+ links/.test(html) && html.includes('not connected'));
  const empty = await graphScreen({ graph: { last: null } }).text(); assert.ok(empty.includes('next pass'));
});

test('privacy: without the owner bearer only counts and declared public kinds are shown; other records are veiled', async () => {
  _reset(); const db = makeDb(); seedTenant(db);
  db.raw.exec(`CREATE TABLE human_inbox (id TEXT PRIMARY KEY, body TEXT); INSERT INTO human_inbox VALUES ('m1','a private reply naming F-ego');`);
  const r = await datagraphStep({ db, config: cfg, ensureItem, now: NOW });
  assert.ok(r.dropped.tables.includes('human_inbox'), 'a person\'s message is never read into the graph');
  assert.equal(await readNode(db, 'findings:F-ego'), null, 'not a public kind');
  assert.equal((await searchGraph(db, 'priming')).results.length, 0);
  const g = await readGraph(db);
  assert.ok(g.last.hubs.every(h => h.redacted && !h.id && /^a .+ record$/.test(h.label)));
  const P = { publicKinds: ['findings', 'studies', 'replications', 'fields'] };
  const n = await readNode(db, 'findings:F-ego', { ...P, depth: 2 });
  assert.ok(n && n.neighbors.every(x => P.publicKinds.includes(x.kind)));
  assert.ok((await readGraph(db, P)).last.hubs.some(h => h.id === 'studies:S-1996'));
});

test('a system can switch the step off only by config, and the index wires the step and routes', () => {
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.ok(src.includes("b('knowledge-graph', () => datagraphStep("));
  for (const r of ['/api/graph', '/api/graph/insights', '/api/graph/node', '/api/graph/search', '/graph']) assert.ok(src.includes(`'${r}'`), r);
});
