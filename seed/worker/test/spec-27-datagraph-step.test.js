// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-27: the tick loop `knowledge-graph` (seed/worker/src/datagraph.js) and its read side, proved through their exported functions over an in-memory D1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { datagraphStep, readGraph, readInsights, readNode, searchGraph, loadGraph, DATAGRAPH_DDL, KG_DEFAULTS, KG_RESERVE, _reset } from '../src/datagraph.js';
import { ensureItem, ORIGINATE_MAX_PER_DAY } from '../src/tick.js';
import { hiddenByHealthOnly, PUBLIC_READS } from '../src/visibility.js';

const NOW = Date.parse('2026-11-25T12:00:00Z'), H = 3600e3, D = 24 * H;
// A database with only what the test puts in it: the seed's tables are dropped, so the number of tables is the test's.
function bareDb() {
  const db = makeDb();
  for (const r of db.raw.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all()) db.raw.exec(`DROP TABLE IF EXISTS "${r.name}"`);
  _reset(); return db;
}
const withItems = db => { for (const s of ['CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT, kind TEXT, owner_role TEXT, done_check TEXT, closing_probe TEXT, priority INTEGER, status TEXT, surface TEXT, action_class TEXT, disposition TEXT, updated_at TEXT)',
  'CREATE TABLE budget_ledger (day TEXT, kind TEXT, units REAL, calls INTEGER, refused INTEGER, PRIMARY KEY (day, kind))']) db.raw.exec(s); return db; };
const ids = (db, sql, ...a) => db.raw.prepare(sql).all(...a);
// The row budget is shared by every table the database lists, the graph's own four and any engine table included; a test sizes its total from that count.
const listed = db => { for (const q of DATAGRAPH_DDL) db.raw.exec(q); return ids(db, `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`)[0].n; };
const world = db => {
  db.raw.exec(`CREATE TABLE fields (id TEXT PRIMARY KEY, name TEXT); CREATE TABLE findings (id TEXT PRIMARY KEY, title TEXT, field TEXT);
    CREATE TABLE studies (id TEXT PRIMARY KEY, title TEXT, finding_id TEXT, contact_email TEXT); CREATE TABLE replications (id TEXT PRIMARY KEY, notes TEXT);
    INSERT INTO fields VALUES ('psych','Psychology'),('med','Medicine');
    INSERT INTO findings VALUES ('F-ego','Ego depletion','psych'),('F-prime','Elderly priming','psych'),('F-hrt','HRT protects the heart','med');
    INSERT INTO studies VALUES ('S-1998','Baumeister 1998','F-ego','a@b.c'),('S-1996','Bargh 1996','F-prime',NULL),('S-whi','WHI trial','F-hrt',NULL);
    INSERT INTO replications VALUES ('R-1','Registered report of S-1998 in 23 labs; effect near zero.'),('R-2','Direct replication of S-1996; no effect found.');`);
};
const fill = (db, table, n, prefix = 'row') => { db.raw.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, title TEXT)`); const ins = db.raw.prepare(`INSERT INTO ${table} VALUES (?,?)`); for (let i = 1; i <= n; i++) ins.run(`${prefix}-${String(i).padStart(4, '0')}`, `${table} ${i}`); };

test('US-27-R14: the loop needs no configuration, runs when its interval is due, can be forced, and is switched off only by config', async () => {
  assert.equal(KG_DEFAULTS.every_min, 360);
  const db = bareDb(); world(db);
  const first = await datagraphStep({ db, now: NOW });
  assert.ok(first.nodes > 5 && first.at === new Date(NOW).toISOString(), 'a system with no knowledge_graph config builds its graph');
  const due = await datagraphStep({ db, now: NOW + 359 * 60e3 });
  assert.equal(due.status, 'not-due'); assert.equal(due.last, first.at);
  assert.ok((await datagraphStep({ db, now: NOW + 360 * 60e3 })).nodes > 5, 'due exactly at the interval');
  assert.ok((await datagraphStep({ db, now: NOW + 361 * 60e3, force: true })).nodes > 5, 'force ignores the interval');
  assert.equal((await datagraphStep({ db, now: NOW + 9 * D, config: { knowledge_graph: { every_min: 5 } } })).at, new Date(NOW + 9 * D).toISOString(), 'the interval is a config value');
  assert.deepEqual(await datagraphStep({ db, now: NOW + 20 * D, config: { knowledge_graph: { enabled: false } } }), { status: 'disabled-by-config' });
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.ok(src.includes("b('knowledge-graph', () => datagraphStep({ db: env.DB, config, ensureItem }))"), 'the cron runs it as a loop beside the tick, as a recorded beat');
});

test('US-27-R15: reads are bounded per table and in all, newest rows first, secret-shaped tables are never selected, and an unreadable table keeps its nodes', async () => {
  assert.deepEqual([KG_DEFAULTS.max_rows_total, KG_DEFAULTS.max_rows_per_table, KG_DEFAULTS.max_tables, KG_DEFAULTS.proposals_per_pass], [6000, 400, 60, 10]);
  let db = bareDb(); fill(db, 'big', 500, 'row'); fill(db, 'small', 3, 'sm');
  let r = await datagraphStep({ db, now: NOW, config: { knowledge_graph: { max_rows_total: 50 * listed(db) } } });
  assert.equal(r.rows_per_table, 50, 'the total is shared between the tables the database lists');
  const big = ids(db, `SELECT id FROM kg_nodes WHERE kind='big' ORDER BY id`);
  assert.equal(big.length, 50); assert.equal(big[0].id, 'big:row-0451', 'newest first: the last rows of the table');
  db = bareDb(); fill(db, 'big', 500, 'row');
  assert.equal((await datagraphStep({ db, now: NOW })).rows_per_table, 400, 'at most 400 rows of any table');
  db = bareDb(); for (let i = 1; i <= 65; i++) db.raw.exec(`CREATE TABLE t${String(i).padStart(2, '0')} (id TEXT PRIMARY KEY); INSERT INTO t${String(i).padStart(2, '0')} VALUES ('id-${i}')`);
  r = await datagraphStep({ db, now: NOW });
  assert.equal(r.tables, 60, 'at most 60 tables by name, the graph\'s own included'); assert.equal(r.rows_per_table, 100, '6000 rows shared by 60 tables');
  assert.ok(ids(db, `SELECT 1 FROM kg_nodes WHERE kind='t01'`).length && !ids(db, `SELECT 1 FROM kg_nodes WHERE kind='t65'`).length, 'the tables after the sixtieth name are not read');
  // a secret-shaped table is never even selected
  db = bareDb(); world(db); db.raw.exec(`CREATE TABLE oauth_tokens (id TEXT PRIMARY KEY, token TEXT); INSERT INTO oauth_tokens VALUES ('gh','ghs_never')`);
  const sql = []; const spy = { raw: db.raw, batch: s => db.batch(s), prepare: q => { sql.push(q); return db.prepare(q); } };
  r = await datagraphStep({ db: spy, now: NOW });
  assert.ok(r.dropped.tables.includes('oauth_tokens')); assert.ok(!sql.some(q => /SELECT[^;]*FROM "oauth_tokens"/.test(q)), 'the table is not queried');
  // an unreadable table is not an empty one
  db = bareDb(); world(db); let failing = false;
  const flaky = { raw: db.raw, batch: s => db.batch(s), prepare: q => { if (failing && q.includes('"studies"')) { const o = { bind: () => o, all: async () => { throw new Error('disk i/o'); } }; return o; } return db.prepare(q); } };
  await datagraphStep({ db: flaky, now: NOW }); failing = true;
  r = await datagraphStep({ db: flaky, now: NOW + 7 * H });
  assert.deepEqual(r.read_errors, ['studies: disk i/o']); assert.equal(ids(db, `SELECT id FROM kg_nodes WHERE kind='studies' AND valid_to IS NULL`).length, 3, 'its nodes stay open');
});

test('US-27-R16: the graph is bi-temporal: a quiet pass writes nothing, a changed row is rewritten, a vanished row is closed with valid_to and kept, a cut table closes nothing', async () => {
  const db = bareDb(); world(db);
  await datagraphStep({ db, now: NOW });
  const quiet = await datagraphStep({ db, now: NOW + 7 * H });
  assert.deepEqual(quiet.changes, { nodes_new: 0, nodes_changed: 0, nodes_closed: 0, edges_new: 0, edges_closed: 0 });
  db.raw.exec(`UPDATE findings SET title='Ego depletion (contested)' WHERE id='F-ego'; DELETE FROM studies WHERE id='S-whi'; UPDATE studies SET finding_id=NULL WHERE id='S-1996'`);
  const moved = await datagraphStep({ db, now: NOW + 14 * H });
  assert.equal(moved.changes.nodes_changed, 2); assert.equal(moved.changes.nodes_closed, 1); assert.equal(moved.changes.edges_closed, 2, 'the deleted row\'s edge and the cleared reference');
  const gone = ids(db, `SELECT first_seen, valid_to FROM kg_nodes WHERE id='studies:S-whi'`)[0];
  assert.equal(gone.valid_to, new Date(NOW + 14 * H).toISOString()); assert.equal(gone.first_seen, new Date(NOW).toISOString(), 'closed, never deleted, and its first_seen kept');
  assert.equal(ids(db, `SELECT valid_to FROM kg_edges WHERE src='studies:S-1996' AND rel='finding_id'`)[0].valid_to, new Date(NOW + 14 * H).toISOString());
  assert.equal((await loadGraph(db)).nodes.some(n => n.id === 'studies:S-whi'), false, 'the live graph holds valid rows only');
  db.raw.exec(`INSERT INTO studies VALUES ('S-whi','WHI trial','F-hrt',NULL)`);
  await datagraphStep({ db, now: NOW + 21 * H });
  assert.equal(ids(db, `SELECT valid_to FROM kg_nodes WHERE id='studies:S-whi'`)[0].valid_to, null, 'a row that returns is open again');
  // a table cut at the row budget: older rows that were not read are not closed
  const cut = bareDb(); fill(cut, 'big', 60, 'row'); const cfg = { knowledge_graph: { max_rows_total: 50 * listed(cut) } };
  await datagraphStep({ db: cut, now: NOW, config: cfg });
  assert.equal(ids(cut, `SELECT COUNT(*) AS n FROM kg_nodes WHERE valid_to IS NULL`)[0].n, 50);
  cut.raw.exec(`INSERT INTO big VALUES ('row-0061','big 61'),('row-0062','big 62'),('row-0063','big 63'),('row-0064','big 64'),('row-0065','big 65')`);
  const next = await datagraphStep({ db: cut, now: NOW + 7 * H, config: cfg });
  assert.equal(next.changes.nodes_closed, 0); assert.equal(ids(cut, `SELECT COUNT(*) AS n FROM kg_nodes WHERE valid_to IS NULL`)[0].n, 55);
});

test('US-27-R17: link leads are stored as proposed edges, at most proposals_per_pass new each pass, settled against later data, and never proposed twice', async () => {
  const mk = () => { const db = bareDb(); db.raw.exec(`CREATE TABLE things (id TEXT PRIMARY KEY, a TEXT, b TEXT); INSERT INTO things VALUES ('hub-a',NULL,NULL),('hub-b',NULL,NULL),('x-one','hub-a','hub-b'),('y-two','hub-a','hub-b')`); return db; };
  let db = mk();
  const r = await datagraphStep({ db, now: NOW, config: { knowledge_graph: { proposals_per_pass: 1 } } });
  assert.equal(r.proposals.new, 1); const p = ids(db, `SELECT * FROM kg_edges WHERE status='proposed'`);
  assert.equal(p.length, 1); assert.equal(p[0].rel, 'related'); assert.equal(p[0].source, 'adamic-adar'); assert.ok(p[0].confidence > 0 && p[0].confidence <= 1); assert.match(p[0].why, /shared neighbours/);
  await datagraphStep({ db, now: NOW + 7 * H, config: { knowledge_graph: { proposals_per_pass: 1 } } });
  const pairs = ids(db, `SELECT src, dst FROM kg_edges WHERE rel='related'`).map(x => [x.src, x.dst].sort().join('|'));
  assert.equal(new Set(pairs).size, pairs.length, 'a pair that is already a lead is not proposed again');
  assert.equal(pairs.length, 2, 'the next pass proposes the other pair');
  // a lead the data confirms is kept; one that gets no confirmation in fourteen days is dropped and not proposed again
  db = mk(); await datagraphStep({ db, now: NOW });
  const open = ids(db, `SELECT src, dst FROM kg_edges WHERE status='proposed'`);
  db.raw.exec(`ALTER TABLE things ADD COLUMN peer TEXT; UPDATE things SET peer='y-two' WHERE id='x-one'`);
  const k = await datagraphStep({ db, now: NOW + 7 * H });
  assert.ok(k.proposals.kept >= 1);
  const kept = ids(db, `SELECT status, outcome, valid_to FROM kg_edges WHERE status='kept'`)[0];
  assert.equal(kept.outcome, 'kept'); assert.ok(kept.valid_to, 'a settled lead leaves the live graph with its outcome recorded');
  const stale = ids(db, `SELECT src, dst FROM kg_edges WHERE status='proposed'`);
  const d = await datagraphStep({ db, now: NOW + 15 * D });
  assert.equal(d.proposals.dropped, stale.length);
  for (const s of stale) { const row = ids(db, `SELECT status, outcome, valid_to FROM kg_edges WHERE src=? AND dst=? AND rel='related'`, s.src, s.dst)[0]; assert.deepEqual([row.status, row.outcome, !!row.valid_to], ['rejected', 'dropped', true]); }
  assert.equal(ids(db, `SELECT COUNT(*) AS n FROM kg_edges WHERE status='proposed' AND (src||dst) IN (${stale.map(s => `'${s.src}${s.dst}'`).join(',') || "''"})`)[0].n, 0, 'a dropped lead is not re-proposed');
  assert.ok(open.length >= 1);
});

test('US-27-R17: the confidence of a stored lead is its Adamic-Adar score over three, at most one', async () => {
  // two shared neighbours of degree two: score 2 / ln 2 = 2.8854, confidence 0.9618
  let db = bareDb(); db.raw.exec(`CREATE TABLE things (id TEXT PRIMARY KEY, a TEXT, b TEXT); INSERT INTO things VALUES ('hub-a',NULL,NULL),('hub-b',NULL,NULL),('x-one','hub-a','hub-b'),('y-two','hub-a','hub-b')`);
  await datagraphStep({ db, now: NOW });
  const two = ids(db, `SELECT confidence FROM kg_edges WHERE status='proposed' AND src LIKE '%x-one' AND dst LIKE '%y-two'`)[0];
  assert.ok(two && Math.abs(two.confidence - (2 / Math.log(2)) / 3) < 1e-3, `score over three, got ${two && two.confidence}`);
  // five shared neighbours: score 7.2, so the confidence is capped at one
  db = bareDb(); db.raw.exec(`CREATE TABLE things (id TEXT PRIMARY KEY, a TEXT, b TEXT, c TEXT, d TEXT, e TEXT); INSERT INTO things VALUES ('hub-a',NULL,NULL,NULL,NULL,NULL),('hub-b',NULL,NULL,NULL,NULL,NULL),('hub-c',NULL,NULL,NULL,NULL,NULL),('hub-d',NULL,NULL,NULL,NULL,NULL),('hub-e',NULL,NULL,NULL,NULL,NULL),
    ('x-one','hub-a','hub-b','hub-c','hub-d','hub-e'),('y-two','hub-a','hub-b','hub-c','hub-d','hub-e')`);
  await datagraphStep({ db, now: NOW });
  const five = ids(db, `SELECT confidence FROM kg_edges WHERE status='proposed' AND src LIKE '%x-one' AND dst LIKE '%y-two'`)[0];
  assert.equal(five.confidence, 1, 'at most one');
});

test('US-27-R18: insights are stored while they hold and cleared when they stop, and the strongest orphan finding files one item that closes by the same reading', async () => {
  const db = withItems(bareDb()); fill(db, 'gadgets', 12, 'gad'); fill(db, 'widgets', 12, 'wid'); world(db);
  const r = await datagraphStep({ db, ensureItem, now: NOW });
  assert.deepEqual(r.filed, ['KG-ORPHANS-gadgets'], 'one item a pass: the strongest finding, ties broken by id');
  const it = ids(db, `SELECT * FROM items WHERE id='KG-ORPHANS-gadgets'`)[0];
  assert.deepEqual([it.owner_role, it.kind, it.priority, it.status, it.closing_probe], ['product-manager', 'improvement', 0, 'ready', 'datagraph:orphans:gadgets']);
  assert.match(it.title, /Prediction: graph_orphan_share_gadgets < 0.5 within 168 h\./); assert.match(it.done_check, /no longer mostly unconnected/);
  assert.equal(ids(db, `SELECT item_id, state FROM kg_insights WHERE id='orphans:gadgets'`)[0].item_id, 'KG-ORPHANS-gadgets');
  assert.equal(KG_RESERVE, 2); assert.equal(ORIGINATE_MAX_PER_DAY, 20);
  const again = await datagraphStep({ db, ensureItem, now: NOW + 7 * H });
  assert.deepEqual(again.filed, [], 'an item that exists is not filed twice');
  db.raw.exec(`DELETE FROM gadgets`);
  const closed = await datagraphStep({ db, ensureItem, now: NOW + 14 * H });
  assert.ok(closed.closed.includes('KG-ORPHANS-gadgets')); const done = ids(db, `SELECT status, disposition FROM items WHERE id='KG-ORPHANS-gadgets'`)[0];
  assert.deepEqual([done.status, done.disposition], ['done', 'probe green: datagraph:orphans:gadgets no longer fires']);
  assert.equal(ids(db, `SELECT state FROM kg_insights WHERE id='orphans:gadgets'`)[0].state, 'cleared');
  assert.equal(ids(db, `SELECT state FROM kg_insights WHERE id='orphans:widgets'`)[0].state, 'open', 'a finding that still holds stays open');
});

test('US-27-R19: every pass records one run summary that the read side serves, and prunes runs older than 400 days', async () => {
  const db = bareDb(); world(db); for (const q of DATAGRAPH_DDL) db.raw.exec(q);
  db.raw.exec(`INSERT INTO kg_runs (at, summary) VALUES ('${new Date(NOW - 401 * D).toISOString()}', '{}'), ('${new Date(NOW - 399 * D).toISOString()}', '{}')`);
  const r = await datagraphStep({ db, now: NOW });
  for (const k of ['at', 'nodes', 'edges', 'components', 'orphans', 'hubs', 'communities', 'bridges', 'by_kind', 'tables', 'rows_per_table', 'read_errors', 'dropped', 'changes', 'proposals', 'weights', 'insights', 'filed', 'closed', 'ms']) assert.ok(k in r, k);
  assert.ok(!('_community' in r) && !('_pagerank' in r), 'the internal maps are not stored');
  const rows = ids(db, `SELECT at FROM kg_runs ORDER BY at`);
  assert.deepEqual(rows.map(x => x.at), [new Date(NOW - 399 * D).toISOString(), new Date(NOW).toISOString()]);
  const g = await readGraph(db, { open: true }); assert.equal(g.built, true); assert.equal(g.last.nodes, r.nodes); assert.deepEqual(g.series.at(-1), { at: r.at, nodes: r.nodes, edges: r.edges, components: r.components, orphans: r.orphans });
  assert.equal((await readGraph(bareDb())).built, false);
});

test('US-27-R20: the Worker carries its own additive DDL, equal to the migration, so the graph builds on a database that has none of its tables', async () => {
  const sql = readFileSync(new URL('../migrations/0031_datagraph.sql', import.meta.url), 'utf8');
  for (const d of DATAGRAPH_DDL) assert.ok(sql.includes(d), d.slice(0, 60));
  assert.ok(!/\b(DROP|DELETE|UPDATE|ALTER|INSERT)\b/i.test(sql), 'a migration of this graph only creates');
  assert.ok(sql.split('\n').filter(l => /^CREATE/i.test(l)).every(l => /IF NOT EXISTS/i.test(l)));
  const db = bareDb(); world(db); db.raw.exec(sql); db.raw.exec(sql);   // idempotent
  assert.ok((await datagraphStep({ db, now: NOW })).nodes > 5);
  const fresh = bareDb(); world(fresh);
  assert.deepEqual(ids(fresh, `SELECT name FROM sqlite_master WHERE name LIKE 'kg_%'`), []);
  await datagraphStep({ db: fresh, now: NOW });
  assert.deepEqual(ids(fresh, `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'kg_%' ORDER BY name`).map(x => x.name), ['kg_edges', 'kg_insights', 'kg_nodes', 'kg_runs']);
});

test('US-27-R21: the read side is public from the first deploy: summary, insights, node, search and the page are reads no health-only gate hides', () => {
  const env = { PUBLIC_HEALTH_ONLY: '1' };
  for (const p of ['/api/graph', '/api/graph/insights', '/api/graph/node', '/api/graph/search', '/graph']) {
    assert.ok(PUBLIC_READS.includes(p), p); assert.equal(hiddenByHealthOnly(env, 'GET', p), false, p); assert.equal(hiddenByHealthOnly(env, 'POST', p), true, 'a write is never public: ' + p);
  }
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  for (const p of ['/api/graph', '/api/graph/insights', '/api/graph/node', '/api/graph/search', '/graph', '/api/graph/ai']) assert.ok(src.includes(`url.pathname === '${p}'`), 'served: ' + p);
  assert.ok(src.includes("bearerOk(request, env)") && src.includes('public_kinds'), 'the owner bearer and the declared public kinds decide the view');
});

test('US-27-R22: without the owner bearer only counts, the series, orphan and fragmentation findings and declared public kinds are shown; everything else is veiled', async () => {
  const db = withItems(bareDb()); world(db); fill(db, 'notes', 12, 'note');
  db.raw.exec(`CREATE TABLE human_inbox (id TEXT PRIMARY KEY, body TEXT); INSERT INTO human_inbox VALUES ('m1','a private reply naming F-ego')`);
  const r = await datagraphStep({ db, ensureItem, now: NOW });
  assert.ok(r.dropped.tables.includes('human_inbox'));
  const P = { publicKinds: ['findings', 'studies', 'replications', 'fields'] };
  const pub = await readGraph(db), own = await readGraph(db, { open: true });
  assert.ok(pub.view === 'public' && own.view === 'owner');
  assert.ok(pub.last.hubs.length && pub.last.hubs.every(h => h.redacted === true && !('id' in h) && /^a .+ record$/.test(h.label) && 'pagerank' in h), 'a hub of a private kind is "a <kind> record" with its numbers');
  assert.ok(own.last.hubs.every(h => h.id && !h.redacted));
  assert.ok(pub.last.communities.every(c => Object.keys(c).sort().join() === 'kinds,size'), 'communities show size and kinds only');
  assert.equal(pub.last.nodes, own.last.nodes, 'counts are the same for everyone');
  const shown = await readGraph(db, P); assert.ok(shown.last.hubs.some(h => h.id && h.kind === 'studies'));
  const ins = await readInsights(db), insOwn = await readInsights(db, { open: true });
  assert.ok(ins.insights.length >= 1 && ins.insights.every(i => ['orphans', 'fragmenting'].includes(i.kind)), 'only findings that name kinds and numbers');
  assert.ok(insOwn.insights.length >= ins.insights.length && insOwn.proposals.length >= ins.proposals.length);
  assert.ok(insOwn.proposals.length > 0 && ins.proposals.length === 0, 'link leads are shown only when both ends are public kinds');
  const kindOf = id => id.slice(0, id.indexOf(':'));
  assert.ok((await readInsights(db, P)).proposals.every(p => P.publicKinds.includes(kindOf(p.src)) && P.publicKinds.includes(kindOf(p.dst))));
  assert.equal(await readNode(db, 'findings:F-ego'), null); assert.equal((await readNode(db, 'findings:F-ego', P)).view, 'public');
  const n = await readNode(db, 'findings:F-ego', { ...P, depth: 2 }); assert.ok(n.neighbors.length && n.neighbors.every(x => P.publicKinds.includes(x.kind)));
  assert.deepEqual((await searchGraph(db, 'priming')).results, []); assert.equal((await searchGraph(db, 'priming', P)).results[0].id, 'findings:F-prime'); assert.equal((await searchGraph(db, 'priming', { open: true })).results.length, 1);
  assert.equal((await readNode(db, 'findings:F-ego', { open: true })).node.props.title, 'Ego depletion');
});

test('US-27-R23: every read is bounded: a short search term answers nothing, results stop at 50, a node shows at most 60 edges a ring', async () => {
  const db = bareDb(); fill(db, 'widgets', 120, 'wid');
  db.raw.exec(`CREATE TABLE hubs (id TEXT PRIMARY KEY, name TEXT); INSERT INTO hubs VALUES ('hub-x','Hub X'); CREATE TABLE spokes (id TEXT PRIMARY KEY, name TEXT, hub_id TEXT)`);
  const ins = db.raw.prepare(`INSERT INTO spokes VALUES (?,?,?)`); for (let i = 0; i < 150; i++) ins.run('spoke-' + String(i).padStart(3, '0'), 'spoke', 'hub-x');
  await datagraphStep({ db, now: NOW, config: { knowledge_graph: { max_rows_total: 6000 } } });
  const O = { open: true };
  assert.deepEqual((await searchGraph(db, 'w', O)).results, [], 'under two characters'); assert.deepEqual((await searchGraph(db, '', O)).results, []);
  assert.equal((await searchGraph(db, 'widgets', { ...O, limit: 500 })).results.length, 50); assert.equal((await searchGraph(db, 'widgets', { ...O, limit: 7 })).results.length, 7);
  const n = await readNode(db, 'hubs:hub-x', O); assert.ok(n.edges.length <= 60 && n.edges.length > 0); assert.ok(n.neighbors.length <= 60);
  assert.equal(await readNode(db, 'nope:nothing', O), null);
  assert.ok((await readInsights(db, { ...O, limit: 500 })).insights.length <= 200);
});

test('US-27-R23: insights are read at most 200 at a time, strongest first, however many are open', async () => {
  const db = bareDb(); for (const q of DATAGRAPH_DDL) db.raw.exec(q);
  const ins = db.raw.prepare(`INSERT INTO kg_insights (id, kind, subject, text, score, prediction, probe, state, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,'open',?,?)`);
  for (let i = 0; i < 250; i++) ins.run(`orphans:k${String(i).padStart(3, '0')}`, 'orphans', `k${i}`, 'text', i / 1000, 'p', 'datagraph:x', '2026-11-25T00:00:00Z', '2026-11-25T00:00:00Z');
  const r = await readInsights(db, { open: true, limit: 500 });
  assert.equal(r.insights.length, 200, 'capped at 200 although 250 are open');
  assert.equal(r.insights[0].id, 'orphans:k249', 'strongest first');
  assert.equal((await readInsights(db, { open: true })).insights.length, 50, 'the default is 50');
});

// Defect 7 of US-SPEC-27 section 7, fixed in 0.3.0 (seed/worker/src/datagraph.js readInsights). Before the fix a link insight was kept when its source kind
// alone was public, and the text of a link insight and the `why` of a lead named the labels of the neighbours the pair shares, of any kind.
test('US-27-R22: a stranger\'s link insights and link leads name no id, label or probe of a record whose kind is not public', async () => {
  const db = bareDb();
  db.raw.exec(`CREATE TABLE hubs (id TEXT PRIMARY KEY, name TEXT); INSERT INTO hubs VALUES ('hub-a','Hub A'),('hub-b','Hub B');
    CREATE TABLE apub (id TEXT PRIMARY KEY, title TEXT, h1 TEXT, h2 TEXT); INSERT INTO apub VALUES ('pub-1','Public one','hub-a','hub-b');
    CREATE TABLE zpriv (id TEXT PRIMARY KEY, title TEXT, h1 TEXT, h2 TEXT); INSERT INTO zpriv VALUES ('priv-1','Secret thing','hub-a','hub-b');`);
  await datagraphStep({ db, now: NOW });
  const owner = JSON.stringify(await readInsights(db, { open: true }));
  for (const s of ['link:apub:pub-1|zpriv:priv-1', 'Secret thing', 'Hub A']) assert.ok(owner.includes(s), `the owner sees ${s}: the pair is planted`);
  for (const publicKinds of [['apub'], ['apub', 'hubs']]) {
    const seen = JSON.stringify(await readInsights(db, { publicKinds }));
    for (const secret of ['zpriv', 'priv-1', 'Secret thing']) assert.ok(!seen.includes(secret), `publicKinds ${publicKinds}: "${secret}" reached a stranger`);
  }
  // both ends public: the insight and the lead are shown, worded with the number of shared neighbours and none of their labels, public or not
  const both = await readInsights(db, { publicKinds: ['apub', 'hubs'] });
  const li = both.insights.find(i => i.id === 'link:hubs:hub-a|hubs:hub-b');
  assert.equal(li.text, 'hubs:hub-a and hubs:hub-b share 2 shared neighbours but are not linked. A lead, not a fact: it is kept only if the data later links them.');
  assert.equal(li.probe, 'datagraph:link:hubs:hub-a|hubs:hub-b');
  assert.deepEqual(both.proposals.map(p => [p.src, p.dst, p.why]), [['hubs:hub-a', 'hubs:hub-b', '2 shared neighbours']]);
  assert.ok(!JSON.stringify(both).includes('Public one'), 'the label of a shared neighbour is left out even when its kind is public');
  // one end public and the other not: neither the insight nor the lead is shown
  assert.deepEqual(await readInsights(db, { publicKinds: ['apub'] }), { view: 'public', insights: [], proposals: [] });
});

test('US-27-R22: a stranger gets the number of dropped tables and of read errors, never their names or the database\'s message; the owner gets both', async () => {
  const db = bareDb(); world(db); db.raw.exec(`CREATE TABLE oauth_tokens (id TEXT PRIMARY KEY, token TEXT); INSERT INTO oauth_tokens VALUES ('gh','ghs_never')`);
  let failing = false;
  const flaky = { raw: db.raw, batch: s => db.batch(s), prepare: q => { if (failing && q.includes('"studies"')) { const o = { bind: () => o, all: async () => { throw new Error('disk i/o near studies.secret_col'); } }; return o; } return db.prepare(q); } };
  await datagraphStep({ db: flaky, now: NOW }); failing = true;
  const r = await datagraphStep({ db: flaky, now: NOW + 7 * H });
  assert.deepEqual(r.read_errors, ['studies: disk i/o near studies.secret_col']); assert.ok(r.dropped.tables.includes('oauth_tokens'));
  const own = await readGraph(db, { open: true }), pub = await readGraph(db), shown = await readGraph(db, { publicKinds: ['studies', 'findings'] });
  assert.deepEqual(own.last.read_errors, r.read_errors, 'the owner reads the run row as stored'); assert.deepEqual(own.last.dropped.tables, r.dropped.tables);
  for (const v of [pub, shown]) {
    assert.equal(v.last.read_errors, 1); assert.equal(v.last.dropped.tables, r.dropped.tables.length);
    assert.equal(v.last.dropped.columns, r.dropped.columns); assert.equal(v.last.dropped.nodes, r.dropped.nodes);
    const text = JSON.stringify(v);
    for (const s of ['oauth_tokens', 'disk i/o', 'secret_col']) assert.ok(!text.includes(s), `"${s}" reached a stranger`);
  }
});

test('US-27-R23: a search term is cut to 80 characters', async () => {
  const db = bareDb(); const head = 'q'.repeat(80);
  db.raw.exec(`CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT); INSERT INTO notes VALUES ('n-1','${head} tail')`);
  await datagraphStep({ db, now: NOW });
  const O = { open: true };
  assert.deepEqual((await searchGraph(db, head + 'z'.repeat(20), O)).results.map(r => r.id), ['notes:n-1'], 'the first 80 characters are searched, the rest is dropped');
});

test('US-27-R23: a node\'s neighbourhood is read from at most 40 nodes and holds at most 120 nodes', async () => {
  const spy = db => { const sql = []; return { sql, db: { raw: db.raw, batch: s => db.batch(s), prepare: q => { sql.push(q); return db.prepare(q); } } }; };
  const O = { open: true, depth: 2 }, ring = q => /FROM kg_edges WHERE valid_to IS NULL AND \(src = \? OR dst = \?\)/.test(q), node = q => /^SELECT id, kind, label FROM kg_nodes WHERE id = \?$/.test(q);
  // a hub with 50 spokes, each spoke with one leaf of its own: the second ring is read from 40 of the 50 spokes, so 40 leaves are reached
  let db = bareDb();
  db.raw.exec(`CREATE TABLE hubs (id TEXT PRIMARY KEY, name TEXT); INSERT INTO hubs VALUES ('hub-x','Hub X'); CREATE TABLE spokes (id TEXT PRIMARY KEY, name TEXT, hub_id TEXT); CREATE TABLE leaves (id TEXT PRIMARY KEY, name TEXT, spoke_id TEXT)`);
  for (let i = 0; i < 50; i++) { const s = 'spoke-' + String(i).padStart(3, '0'); db.raw.prepare(`INSERT INTO spokes VALUES (?,?,?)`).run(s, 'spoke', 'hub-x'); db.raw.prepare(`INSERT INTO leaves VALUES (?,?,?)`).run('leaf-' + String(i).padStart(3, '0'), 'leaf', s); }
  await datagraphStep({ db, now: NOW });
  let s = spy(db), n = await readNode(s.db, 'hubs:hub-x', O);
  assert.equal(s.sql.filter(ring).length, 1 + 40, 'one ring for the node, then one for each of at most 40 neighbours');
  assert.equal(n.neighbors.filter(x => x.kind === 'leaves').length, 40); assert.equal(n.neighbors.filter(x => x.kind === 'spokes').length, 50);
  // a hub with 60 spokes, each with two leaves: 181 nodes in reach, at most 120 are read
  db = bareDb();
  db.raw.exec(`CREATE TABLE hubs (id TEXT PRIMARY KEY, name TEXT); INSERT INTO hubs VALUES ('hub-x','Hub X'); CREATE TABLE spokes (id TEXT PRIMARY KEY, name TEXT, hub_id TEXT); CREATE TABLE leaves (id TEXT PRIMARY KEY, name TEXT, spoke_id TEXT)`);
  for (let i = 0; i < 60; i++) { const sp = 'spoke-' + String(i).padStart(3, '0'); db.raw.prepare(`INSERT INTO spokes VALUES (?,?,?)`).run(sp, 'spoke', 'hub-x'); for (const t of ['a', 'b']) db.raw.prepare(`INSERT INTO leaves VALUES (?,?,?)`).run(`leaf-${t}-${String(i).padStart(3, '0')}`, 'leaf', sp); }
  await datagraphStep({ db, now: NOW });
  s = spy(db); n = await readNode(s.db, 'hubs:hub-x', O);
  assert.equal(s.sql.filter(node).length, 120, 'at most 120 nodes are looked up'); assert.ok(n.neighbors.length <= 119);
});
