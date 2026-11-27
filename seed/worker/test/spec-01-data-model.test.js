// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-01 (data model): the requirements the seed's schema and runtime implement beyond the portable L1 tables of workers/core/migrations, each
// proved under its id so the conformance manifest can attach them (US-00-R03). Uses only files of the seed: it runs in a seed checkout too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { makeDb } from './d1shim.js';
import { runTick, ensureItem } from '../src/tick.js';
import { migrateStep } from '../src/migrate.js';
import { snapshotD1, EXCLUDE, PREFIX } from '../src/d1snapshot.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 'ultrastable', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy, tick_every_min: 10 };
const T0 = Date.parse('2026-11-10T00:00:00Z');
const get = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const rows = (db, sql, ...a) => db.raw.prepare(sql).all(...a);
const ctx = () => ({ nowIso: '2026-11-26 12:00:00', notes: [] });

test('US-01-R09: a metric outside its healthy condition files BREACH-<id> (priority 0 for liveness, 5 otherwise) and closes it with a disposition when the probe passes again', async () => {
  const db = makeDb();
  db.raw.exec(`CREATE TABLE probe_vals (v REAL); INSERT INTO probe_vals VALUES (5);
    INSERT INTO metrics (id,name,kind,source,spec,op,threshold,owner_role,remedy) VALUES ('M-b','backlog','target','sql','SELECT v FROM probe_vals','<=',0,'operations','Drain it.')`);
  const r = await runTick(db, { config, now: T0 });
  const it = get(db, "SELECT status, priority, owner_role, closing_probe, done_check FROM items WHERE id='BREACH-M-b'");
  assert.ok(it, 'filed'); assert.deepEqual([it.priority, it.owner_role, it.closing_probe, it.done_check], [5, 'operations', 'metric:M-b', 'metric M-b reads <= 0']);
  assert.equal(get(db, "SELECT breached FROM metrics WHERE id='M-b'").breached, 1); assert.match(r.report, /in breach/);
  db.raw.exec('UPDATE probe_vals SET v = 0');
  await runTick(db, { config, now: T0 + 10 * 60e3 });
  const done = get(db, "SELECT status, disposition FROM items WHERE id='BREACH-M-b'");
  assert.deepEqual([done.status, done.disposition], ['done', 'fixed: metric M-b healthy again']);
  assert.equal(get(db, "SELECT breached FROM metrics WHERE id='M-b'").breached, 0);
});

test('US-01-R09: a declared metric with no probe is a breach and not a pass, and a new system has grace_hours before a metric can breach', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO metrics (id,name,kind,source,spec,op,threshold,owner_role,remedy) VALUES ('M-d','declared by the owner','target','declared','revenue is up','>=',1,'product-manager','Build a probe.');
    INSERT INTO metrics (id,name,kind,source,spec,op,threshold,grace_hours,owner_role,remedy) VALUES ('M-g','new','target','sql','SELECT 0','>=',1,48,'operations','r')`);
  await runTick(db, { config, now: T0 });
  assert.ok(get(db, "SELECT 1 AS x FROM items WHERE id='BREACH-M-d'"), 'an unprobed measure is a breach');
  assert.match(get(db, "SELECT title FROM items WHERE id='BREACH-M-d'").title, /Build a probe for "revenue is up"/);
  assert.equal(get(db, "SELECT 1 AS x FROM items WHERE id='BREACH-M-g'"), undefined, 'inside its grace period a failing metric only warms up');
  await runTick(db, { config, now: T0 + 49 * 3600e3 });
  assert.ok(get(db, "SELECT 1 AS x FROM items WHERE id='BREACH-M-g'"), 'after the grace period it breaches');
});

const m = (file, sql) => ({ file, sql });

test('US-01-T07 and US-01-R14: a migration applies once and is ledgered with its hash; an applied file whose text changed is drift: reported, never re-run, and filed', async () => {
  const db = makeDb();
  const v1 = m('0001_x.sql', `CREATE TABLE IF NOT EXISTS x1 (a);`);
  const r1 = await migrateStep(db, ctx(), [v1], ensureItem);
  assert.deepEqual(r1.applied, ['0001_x.sql']);
  assert.equal(get(db, "SELECT sha256 FROM _migrations WHERE file='0001_x.sql'").sha256, createHash('sha256').update(v1.sql).digest('hex'));
  assert.deepEqual((await migrateStep(db, ctx(), [v1], ensureItem)).applied, [], 'applied once');
  const edited = m('0001_x.sql', `CREATE TABLE IF NOT EXISTS x1 (a); CREATE TABLE IF NOT EXISTS x2 (b);`);
  const r2 = await migrateStep(db, ctx(), [edited], ensureItem);
  assert.deepEqual([r2.applied, r2.drift, r2.pending], [[], ['0001_x.sql'], 1]);
  assert.equal(get(db, "SELECT name FROM sqlite_master WHERE name='x2'"), undefined, 'the edited text was not run');
  assert.equal(get(db, "SELECT value FROM org WHERE key='migrations_pending'").value, '1');
  const item = get(db, "SELECT priority, closing_probe, title FROM items WHERE id='MIGRATION-0001_x'");
  assert.ok(item); assert.equal(item.priority, -1); assert.match(item.title, /drifted \(edited after it was applied\): ship the change as a new migration file/);
  const r3 = await migrateStep(db, ctx(), [edited, m('0002_x2.sql', `CREATE TABLE IF NOT EXISTS x2 (b);`)], ensureItem);
  assert.deepEqual(r3.applied, ['0002_x2.sql'], 'the change shipped as a new file applies');
});

test('US-01-R13: a table rebuild marked atomic applies as one all-or-nothing batch, and a failing rebuild leaves the old table and no ledger row', async () => {
  const rebuild = (last) => [`-- atomic: rebuild t_old with a new column`, `CREATE TABLE t_old_copy AS SELECT * FROM t_old;`, `CREATE TABLE t_new (a, b);`, `INSERT INTO t_new (a, b) SELECT a, a FROM t_old;`, `DROP TABLE t_old;`, last].join('\n');
  const mk = () => { const db = makeDb(); db.raw.exec(`CREATE TABLE t_old (a); INSERT INTO t_old VALUES (1), (2)`); return db; };
  const bad = mk();
  const r = await migrateStep(bad, ctx(), [m('0005_rebuild.sql', rebuild(`INSERT INTO table_that_is_not_there VALUES (1);`))], ensureItem);
  assert.deepEqual([r.applied, r.failed], [[], ['0005_rebuild.sql']]);
  assert.equal(get(bad, 'SELECT COUNT(*) AS n FROM t_old').n, 2, 'the old table and its rows are still there');
  assert.equal(get(bad, "SELECT name FROM sqlite_master WHERE name='t_new'"), undefined, 'nothing of the rebuild survived');
  assert.equal(get(bad, "SELECT file FROM _migrations WHERE file='0005_rebuild.sql'"), undefined);
  const good = mk();
  const ok = await migrateStep(good, ctx(), [m('0005_rebuild.sql', rebuild(`ALTER TABLE t_new RENAME TO t_old;`))], ensureItem);
  assert.deepEqual(ok.applied, ['0005_rebuild.sql']);
  assert.deepEqual(rows(good, 'SELECT a, b FROM t_old ORDER BY a').map(r => ({ ...r })), [{ a: 1, b: 1 }, { a: 2, b: 2 }]);
});

test('US-01-R12: a runtime acts only on rows of its own tenant: another tenant row is never dispatched, and the trust ledger keeps one row per tenant, surface and action class', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status,tenant_id) VALUES ('THEIRS','t','staff','x',1,'ready','other-tenant'), ('OWN','o','staff','x',9,'ready',NULL)`);
  await runTick(db, { config, now: T0 });
  assert.deepEqual(rows(db, 'SELECT item_id FROM claims').map(r => r.item_id), ['OWN'], 'the other tenant item has the better priority and is still left alone');
  assert.equal(get(db, "SELECT status FROM items WHERE id='THEIRS'").status, 'ready');
  for (const t of ['items', 'claims', 'gate_cards', 'trust_ledger']) assert.ok(rows(db, `SELECT name FROM pragma_table_info('${t}')`).some(c => c.name === 'tenant_id'), `${t}.tenant_id`);
  const ins = (tenant) => db.raw.prepare(`INSERT INTO trust_ledger (surface, action_class, rung, reliability, tenant_id) VALUES ('repo','open_pr','observed',0.5,?)`).run(tenant);
  ins(null); ins('other-tenant');
  assert.throws(() => ins(null), /UNIQUE/i, 'a second own row for the same surface and action class');
  assert.throws(() => ins('other-tenant'), /UNIQUE/i);
});

test('US-01-R16: the queries the tick repeats on its growing tables are served by an index, not a scan', () => {
  const db = makeDb();
  const plan = (sql, ...a) => rows(db, 'EXPLAIN QUERY PLAN ' + sql, ...a).map(r => r.detail).join(' | ');
  const own = `(tenant_id IS NULL OR tenant_id = ?)`;
  const indexed = {
    'reconcile: items that left the active set': [`SELECT id FROM items WHERE status IN ('done','superseded','cancelled') AND (disposition IS NULL OR disposition = '') AND ${own}`, 'x'],
    'dispatch: the top ready item of a role': [`SELECT id FROM items WHERE status='ready' AND owner_role=? AND ${own} AND id NOT IN (SELECT item_id FROM claims) ORDER BY priority, created_at LIMIT 50`, 'staff', 'x'],
    'age_sla: items open past 120 minutes': [`SELECT COUNT(*) AS n FROM items WHERE status IN ('open','ready') AND created_at < ?`, 'x'],
    'metric tick_runs_completed_1h': [`SELECT COUNT(*) AS n FROM tick_runs WHERE finished_at >= ? AND steps_completed = steps_total`, 'x'],
    'metric silent_drops_7d': [`SELECT COUNT(*) AS n FROM outcomes WHERE result='silent_drop' AND at >= ?`, 'x'],
  };
  for (const [what, [sql, ...a]] of Object.entries(indexed)) assert.match(plan(sql, ...a), /USING (COVERING )?INDEX/, `${what}: ${plan(sql, ...a)}`);
});

test('US-01-T08 and US-01-R15: a daily copy of every non-secret table is stored, read back whole and counted before it counts as a copy; a copy that does not read back is reported and prunes nothing', async () => {
  const d1 = (raw) => ({ prepare: (s) => ({ all: async () => ({ results: raw.prepare(s).all() }) }), batch: async (list) => Promise.all(list.map(x => x.all())) });
  const r2 = (broken = false) => { const mm = new Map(); return { mm,
    head: async (k) => (mm.has(k) ? { key: k } : null),
    put: async (k, v) => { mm.set(k, broken ? new Uint8Array([1, 2, 3]) : new Uint8Array(v)); },
    get: async (k) => (mm.has(k) ? { arrayBuffer: async () => mm.get(k).buffer } : null),
    list: async ({ prefix }) => ({ objects: [...mm.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })), truncated: false }),
    delete: async (ks) => { for (const k of [].concat(ks)) mm.delete(k); } }; };
  const fixture = () => { const raw = new DatabaseSync(':memory:'); raw.exec(`CREATE TABLE items (id TEXT, title TEXT); INSERT INTO items VALUES ('a','one'),('b','two'); CREATE TABLE credentials (k TEXT); INSERT INTO credentials VALUES ('sealed')`); return raw; };
  const bucket = r2(); const now = Date.parse('2026-11-26T01:00:00Z');
  const r = await snapshotD1(d1(fixture()), bucket, { now });
  assert.deepEqual([r.key, r.rows, r.readback, Object.keys(r.counts)], [`${PREFIX}ultrastable-org/2026-11-26.ndjson.gz`, 2, true, ['items']]);
  assert.ok(EXCLUDE.includes('credentials'), 'sealed credentials are never copied');
  assert.equal((await snapshotD1(d1(fixture()), bucket, { now })).skipped, 'already taken today');
  const broken = r2(true);
  for (const d of ['2026-11-01', '2026-11-02']) broken.mm.set(`${PREFIX}ultrastable-org/${d}.ndjson.gz`, new Uint8Array([0]));
  const bad = await snapshotD1(d1(fixture()), broken, { now, keep: 1 });
  assert.equal(bad.readback, false); assert.equal(bad.deleted, 0, 'nothing is pruned on a copy that did not read back');
  assert.equal(broken.mm.size, 3);
});

// ---- US-01-R17, US-01-R18: the sealed audit log and the retention that feeds it ----
import { record, seal, verify, head, archiveRows } from '../src/auditchain.js';
import { pruneAll } from '../src/retention.js';

const sink = (name = 'mem') => { const m = new Map(); return { name, m, async put(k, b) { m.set(k, Uint8Array.from(b)); }, async get(k) { return m.has(k) ? m.get(k) : null; } }; };
const DAY = 864e5, NOW = Date.parse('2026-11-26T12:00:00Z');
const fill = async (db, n, daysAgo) => { for (let i = 0; i < n; i++) await record(db, { at: NOW - daysAgo * DAY, kind: 'decision', actor: 'tick', ref: `item-${i % 3}`, summary: `event ${i}` }, { now: NOW - daysAgo * DAY }); };

test('US-01-R17: log rows chain by hash, old rows seal into a batch with a Merkle root and leave the store only after the sealed copy exists, and a changed past row is detected', async () => {
  const db = makeDb(), a = sink();
  await fill(db, 6, 20); await fill(db, 2, 0);
  assert.equal((await verify(db, [])).ok, true);
  assert.equal((await seal(db, [], { now: NOW })).sealed, 0, 'with no place to put the batch nothing leaves the store');
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM audit_log').n, 8);
  const r = await seal(db, [a], { now: NOW });
  assert.equal(r.sealed, 6); assert.equal(a.m.size >= 2, true, 'a segment and its manifest were written');
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM audit_log').n, 2, 'only the hot rows stay in the store');
  const seg = get(db, 'SELECT merkle_root FROM audit_segments');
  assert.match(seg.merkle_root, /^[0-9a-f]{64}$/);
  assert.equal((await verify(db, [a], { deep: true })).ok, true);
  const key = [...a.m.keys()].find(k => k.includes('/seg/')), good = a.m.get(key);
  a.m.set(key, new Uint8Array([...good].map((x, i) => (i === 20 ? x ^ 1 : x))));
  assert.equal((await verify(db, [a], { deep: true })).ok, false, 'a changed sealed row is detected'); a.m.set(key, good);
  db.raw.exec("UPDATE audit_log SET summary = 'rewritten' WHERE seq = (SELECT MAX(seq) FROM audit_log)");
  assert.equal((await verify(db, [a])).ok, false, 'a changed hot row is detected');
  assert.equal((await head(db)).seq, 8);
});

test('US-01-R18: history tables are pruned a bounded number of rows a day, oldest first, state tables are left alone, and an archived table is sealed into the log before its rows go', async () => {
  const db = makeDb();
  db.raw.exec(`CREATE TABLE hist (at TEXT, v TEXT); CREATE TABLE kept_state (at TEXT, v TEXT); CREATE TABLE arch (at TEXT, v TEXT)`);
  const old = '2020-01-01 00:00:00', recent = '2026-11-25 00:00:00';
  for (let i = 0; i < 5; i++) db.raw.prepare('INSERT INTO hist VALUES (?, ?)').run(old, `h${i}`);
  db.raw.prepare('INSERT INTO hist VALUES (?, ?)').run(recent, 'new'); db.raw.prepare('INSERT INTO kept_state VALUES (?, ?)').run(old, 's');
  db.raw.prepare('INSERT INTO arch VALUES (?, ?)').run(old, 'a1'); db.raw.prepare('INSERT INTO arch VALUES (?, ?)').run('2020-01-02 00:00:00', 'a2');
  const rules = { max_rows_per_run: 3, tables: { hist: { column: 'at', keep_days: 30 }, kept_state: { keep: 'state', reason: 'current state' }, arch: { column: 'at', keep_days: 30, archive: true } } };
  const archive = (t, rows) => archiveRows(db, t)(rows);
  const r = await pruneAll(db, { rules, now: NOW, archive });
  assert.deepEqual(r.tables.map(t => [t.table, t.deleted]), [['hist', 3], ['arch', 2]], 'at most three rows of a table a day');
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM kept_state').n, 1);
  assert.equal(get(db, "SELECT COUNT(*) AS n FROM audit_log WHERE kind = 'archive:arch'").n, 2, 'the archived rows are in the chain');
  assert.equal((await pruneAll(db, { rules, now: NOW, archive })).ran, false, 'once a day');
  const bad = makeDb();
  bad.raw.exec(`CREATE TABLE arch (at TEXT, v TEXT)`); bad.raw.prepare('INSERT INTO arch VALUES (?, ?)').run(old, 'a1');
  const fail = await pruneAll(bad, { rules: { max_rows_per_run: 3, tables: { arch: { column: 'at', keep_days: 30, archive: true } } }, now: NOW, archive: async () => { throw new Error('no place to seal'); } });
  assert.ok(fail.tables[0].error); assert.equal(get(bad, 'SELECT COUNT(*) AS n FROM arch').n, 1, 'a row that could not be sealed is not deleted');
});
