// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for the pack sandbox (US-21-R06, R08): no raw db, no unbound guard, no escaping imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { KERNEL_DIR } from '../kernel/testkit.js';
import { createPacks, loadManifest, MIGRATIONS_DIR, checkSql, sandboxDb, scanPackSource } from './index.js';

const EXAMPLE_DIR = fileURLToPath(new URL('./example/', import.meta.url));
const T0 = Date.now() - 3600e3;  // relative: pack read probes use datetime('now', '-N days'), so a fixed date fails once it ages out

test('checkSql allows own-table writes and shared reads, refuses everything else', () => {
  const ok = [
    `SELECT * FROM guard_ledger WHERE pack = 'x'`, `INSERT INTO x_things (a) VALUES (?)`, `UPDATE x_things SET a = 1`,
    `DELETE FROM x_things WHERE a = ?`, `INSERT OR IGNORE INTO predictions (id) VALUES (?)`, `INSERT INTO items (id) VALUES (?)`,
    `SELECT 1 FROM x_things WHERE a = 'guard_suppression; DROP TABLE x'`,                    // keywords inside text are text
    `SELECT status, reason FROM guard_queue WHERE id = ?`,                                      // the one read of the approval queue a pack may make
    `INSERT INTO x_things (a) VALUES (?) ON CONFLICT(a) DO UPDATE SET a = excluded.a`,       // upsert: the target is the INSERT table
  ];
  for (const s of ok) assert.equal(checkSql(s, 'x'), null, s);
  assert.equal(checkSql('INSERT INTO x_things (a) VALUES (1) ON CONFLICT(a) DO UPDATE SET a = 2', 'x'), null);
  assert.equal(checkSql('INSERT INTO x_things (a) VALUES (1) ON CONFLICT(a) DO UPDATE SET a = 2; UPDATE other SET a = 1', 'x'), 'multiple_statements');
  assert.equal(checkSql('UPDATE other SET a = 1', 'x'), 'write_outside_pack:other');
  const bad = {
    'INSERT INTO guard_suppression (recipient_hash) VALUES (1)': 'write_outside_pack:guard_suppression',
    'DELETE FROM guard_ledger': 'write_outside_pack:guard_ledger',
    "UPDATE trust_ledger SET rung = 'autonomous'": 'write_outside_pack:trust_ledger',
    'UPDATE y_things SET a = 1': 'write_outside_pack:y_things',
    'WITH t AS (SELECT 1) DELETE FROM packs_runs': 'write_outside_pack:packs_runs',
    'SELECT manifest_json FROM packs_registry': 'forbidden_table',
    'SELECT token_hash FROM guard_consent': 'forbidden_table',
    'SELECT 1; DELETE FROM guard_ledger': 'multiple_statements',
    'DROP TABLE x_things': 'ddl_or_pragma', 'PRAGMA writable_schema = 1': 'ddl_or_pragma', "ATTACH DATABASE 'a' AS b": 'ddl_or_pragma',
    'DELETE FROM "guard_ledger"': 'quoted_identifier', 'DELETE FROM [guard_ledger]': 'quoted_identifier',
    'DELETE /* x */ FROM guard_ledger': 'write_outside_pack:guard_ledger',
  };
  for (const [s, why] of Object.entries(bad)) assert.equal(checkSql(s, 'x'), why, s);
});

function host() {
  const db = makeDb([KERNEL_DIR, MIGRATIONS_DIR]);
  const sent = [];
  const packs = createPacks({ db, now: () => T0, config: { step_timeout_ms: 500, packs: { example: { recipients: ['a@example.com'] } } },
    channels: { fake: { send: async m => { sent.push(m); return { id: 'p1' }; } } } });
  return { db, packs, sent };
}
async function enableWith(packs, dir) {
  const m = loadManifest(EXAMPLE_DIR);
  const r = await packs.register(m, { dir });
  if (!r.ok) return r;
  return packs.enablePack('example', { by: 'owner', cardText: m.enable_gate });
}
function evilPack(body) {
  const dir = mkdtempSync(path.join(tmpdir(), 'evil-'));
  writeFileSync(path.join(dir, 'noop.js'), body);
  return dir;
}
async function runLoop(db, packs) {
  const [step] = await packs.packSteps();
  const ctx = { tickId: 1, notes: [], errors: [], env: { SECRET_TOKEN: 'super-secret-value' }, config: { x: 1 }, now: T0, nowIso: new Date(T0).toISOString().slice(0, 19).replace('T', ' ') };
  await step.run(db, ctx);
  return ctx;
}

test('a loop gets the sandboxed db: it cannot rewrite the guard ledger, suppression list or its own registry row', async () => {
  const { db, packs } = host();
  const dir = evilPack(`export async function run({ db }) {
    const tries = [
      "DELETE FROM guard_ledger", "UPDATE packs_registry SET enabled = 1", "INSERT INTO guard_suppression (recipient_hash, channel, reason, at) VALUES ('h','*','x','t')",
      "UPDATE trust_ledger SET rung = 'self-extending'", "DROP TABLE guard_ledger" ];
    const out = [];
    for (const t of tries) { try { db.prepare(t); out.push('allowed'); } catch (e) { out.push(e.message); } }
    if (db.raw || db.exec || db.batch) out.push('raw surface exposed');
    throw new Error(out.join(' | '));
  }`);
  assert.equal((await enableWith(packs, dir)).ok, true);
  const ctx = await runLoop(db, packs);
  const msg = ctx.errors[0];
  assert.equal((msg.match(/pack sandbox refused statement/g) || []).length, 5, msg);
  assert.ok(!/allowed|raw surface/.test(msg), msg);
});

test('a loop cannot see env or config through ctx, cannot mutate the bound guard, and cannot send as another pack', async () => {
  const { db, packs, sent } = host();
  const dir = evilPack(`export async function run({ ctx, guard }) {
    const seen = [ctx.env, ctx.config, ctx.db].some(x => x !== undefined);
    if (seen) throw new Error('ctx leaked');
    if (!Object.isFrozen(guard) || !Object.isFrozen(guard.consent)) throw new Error('guard mutable');
    const r = await guard.send({ pack: 'someone_else', channel: 'fake', kind: 'notice', recipient: 'a@example.com', content: 'hi there', idempotencyKey: 'k' });
    ctx.notes.push('pack-field:' + r.reason);
  }`);
  assert.equal((await enableWith(packs, dir)).ok, true);
  const ctx = await runLoop(db, packs);
  assert.deepEqual(ctx.errors, []);
  assert.deepEqual(ctx.notes, ['pack-field:no_consent']);       // evaluated as pack 'example', not 'someone_else'
  assert.equal(sent.length, 0);
  assert.deepEqual(db.raw.prepare(`SELECT pack FROM guard_ledger`).all().map(r => r.pack), ['example']);
});

test('the bound guard keeps its own methods working when detached (unsubscribe suppresses)', async () => {
  const { db, packs } = host();
  const { unsubscribe } = packs.boundGuard('example');
  assert.equal((await unsubscribe({ recipient: 'gone@example.com' })).ok, true);
  assert.equal(db.raw.prepare(`SELECT reason FROM guard_suppression`).get().reason, 'unsubscribe');
});

test('registration scans pack source: escaping imports, fs access and eval are refused and nothing is stored', async () => {
  const cases = {
    "import { createGuard } from '../../../core/packs/guard.js';": /outside the pack/,
    "import { sha256, createGuard } from '../../../core/packs/guard.js';": /outside the pack/,
    "import fs from 'node:fs';": /imports node:fs/,
    "export const x = eval('1');": /eval/,
    "export const y = process.env.TOKEN;": /process/,
    "const n = './a'; export const z = await import(n + '.js');": /dynamic import/,
    "import('../../../core/kernel/programs.js');": /outside the pack/,
  };
  for (const [src, re] of Object.entries(cases)) {
    const { db, packs } = host();
    const dir = evilPack(`${src}\nexport async function run() {}`);
    const r = await packs.register(loadManifest(EXAMPLE_DIR), { dir });
    assert.equal(r.ok, false, src);
    assert.match(r.errors.join(' '), re, src);
    assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM packs_registry`).get().n, 0);
  }
});

test('the shipped packs and the example pass the source scan', () => {
  const root = fileURLToPath(new URL('../../packs/', import.meta.url));
  for (const d of [EXAMPLE_DIR, path.join(root, 'email'), path.join(root, 'social')]) assert.deepEqual(scanPackSource(d), [], d);
});

test('a relative import that stays inside the pack directory is fine', () => {
  const dir = evilPack(`import { a } from './lib/a.js'; export async function run() { return a; }`);
  mkdirSync(path.join(dir, 'lib'));
  writeFileSync(path.join(dir, 'lib', 'a.js'), `export const a = 1;`);
  assert.deepEqual(scanPackSource(dir), []);
});

test('sandboxDb rejects a bad pack id', () => {
  assert.throws(() => sandboxDb({}, "x'; --"), /bad pack id/);
});

// ---------------- US-21-R08: what a pack may read and change in the shared tables ----------------
test('US-21-R08: a pack cannot read the approval queue content, the trust ledger, roles, gate cards, suppression list or the schema', () => {
  const bad = {
    'SELECT recipient, content FROM guard_queue': 'forbidden_table_columns:guard_queue',
    'SELECT * FROM guard_queue WHERE id = ?': 'forbidden_table_columns:guard_queue',
    'INSERT INTO x_things SELECT recipient, content FROM guard_queue': 'forbidden_table_columns:guard_queue',
    'SELECT status FROM guard_queue g JOIN x_things t ON t.id = g.id WHERE g.id = ?': 'forbidden_table_columns:guard_queue',
    'SELECT * FROM trust_ledger': 'forbidden_table', 'SELECT * FROM roles': 'forbidden_table', 'SELECT * FROM gate_cards': 'forbidden_table',
    'SELECT recipient_hash FROM guard_suppression': 'forbidden_table', 'SELECT sql FROM sqlite_master': 'forbidden_table', 'SELECT name FROM sqlite_schema': 'forbidden_table',
  };
  for (const [s, why] of Object.entries(bad)) assert.equal(checkSql(s, 'x'), why, s);
  assert.equal(checkSql('SELECT status, reason FROM guard_queue WHERE id = ?', 'x'), null);
});

test('US-21-R08: a pack cannot update or delete items or delete predictions, and writes to the shared tables need a row id it owns', () => {
  const bad = {
    "UPDATE items SET status = 'done' WHERE id = ?": 'shared_table_update:items',
    'DELETE FROM items': 'shared_table_delete:items', 'DELETE FROM predictions WHERE id = ?': 'shared_table_delete:predictions',
    "UPDATE predictions SET verdict = 'hit'": 'shared_table_unscoped_update:predictions',
    "UPDATE predictions SET verdict = 'hit' WHERE metric = ?": 'shared_table_unscoped_update:predictions',
    'INSERT INTO items SELECT * FROM x_things': 'shared_table_unscoped_insert:items',
    "INSERT INTO predictions (id, metric) VALUES ('p1', ?)": 'shared_table_unscoped_insert:predictions',
    'INSERT INTO predictions (metric, op) VALUES (?, ?)': 'shared_table_unscoped_insert:predictions',
  };
  for (const [s, why] of Object.entries(bad)) assert.equal(checkSql(s, 'x'), why, s);
  const ok = ['INSERT INTO items (id, title) VALUES (?, ?)', 'INSERT OR IGNORE INTO predictions (id, metric, op, target, due_at) VALUES (?,?,?,?,?)', 'UPDATE predictions SET observed = ?, verdict = ? WHERE id = ?'];
  for (const s of ok) assert.equal(checkSql(s, 'x'), null, s);
});

test('US-21-R08: the id bound to a shared-table write must start with the pack id; another pack\'s, a core item\'s or the host\'s id is refused at bind time', () => {
  const calls = [];
  const raw = { prepare(sql) { return { bind(...a) { calls.push([sql, a]); return { run: async () => ({}) }; } }; } };
  const db = sandboxDb(raw, 'social');
  const ins = db.prepare('INSERT INTO items (id, title) VALUES (?, ?)');
  for (const id of ['social-1', 'social', 'social_x', 'SOCIALVERIFY-3']) assert.doesNotThrow(() => ins.bind(id, 't'), id);
  for (const id of ['email-1', 'DRAFTSTALE-3', 'PACKFAIL-social-1', 'PACKTRIAL-social', '', null]) assert.throws(() => ins.bind(id, 't'), /shared_table_id_not_owned/, String(id));
  const upd = db.prepare("UPDATE predictions SET observed = ?, verdict = ? WHERE id = ?");
  assert.doesNotThrow(() => upd.bind(5, 'hit', 'social-engagement-1'));
  assert.throws(() => upd.bind(5, 'hit', 'email-engagement-1'), /shared_table_id_not_owned/);
  assert.throws(() => upd.run(), /shared_table_id_not_owned/, 'an unbound statement cannot be run');
  assert.equal(calls.length, 5);
  assert.equal(typeof db.prepare('SELECT 1 FROM social_x WHERE a = ?').bind, 'function', 'a statement with no shared write is passed through unchanged');
});

// ---------------- US-21-R08 (T21-18): what the stripping, a string in place of a name and an overwrite could not reach ----------------
test('T21-18 US-21-R08: a -- or /* inside a string does not hide a later table, write target or queue read', () => {
  const bad = {
    "SELECT id AS a, title AS b FROM items WHERE title = '--' UNION ALL SELECT recipient, content FROM guard_queue": 'forbidden_table_columns:guard_queue',
    "WITH c(x) AS (SELECT '--') DELETE FROM items": 'shared_table_delete:items',
    "SELECT '/*' AS a FROM items UNION ALL SELECT rung FROM trust_ledger -- */": 'forbidden_table',
    "SELECT '--' FROM x_things; DELETE FROM guard_ledger": 'multiple_statements',
  };
  for (const [s, why] of Object.entries(bad)) assert.equal(checkSql(s, 'x'), why, s);
});

test('T21-18 US-21-R08: a string literal where SQLite reads a table name is refused; strings in value positions still pass', () => {
  const bad = ["SELECT * FROM 'trust_ledger'", "SELECT * FROM items, 'trust_ledger'", "SELECT * FROM items JOIN 'roles' ON 1 = 1", "DELETE FROM 'items'",
    "INSERT INTO 'guard_ledger' (id) VALUES (?)", "UPDATE 'predictions' SET verdict = 'hit' WHERE id = ?", "SELECT * FROM main.'gate_cards'",
    "SELECT * FROM items i JOIN x_things t ON t.a = i.id, 'guard_queue'"];
  for (const s of bad) assert.equal(checkSql(s, 'x'), 'string_as_table_name', s);
  assert.equal(checkSql("SELECT * FROM pragma_table_info('roles')", 'x'), 'forbidden_table', 'a pragma table function reads the schema');
  const ok = ["SELECT * FROM items WHERE title IN ('a', 'b')", "SELECT 'x', 'y' FROM items", "UPDATE x_things SET a = 'q', b = 'r'", "SELECT a AS 'label' FROM x_things",
    "SELECT * FROM items WHERE status = 'ready' AND kind = 'fix'", "INSERT INTO x_things (a, b) VALUES ('p', 'q')"];
  for (const s of ok) assert.equal(checkSql(s, 'x'), null, s);
});

test('T21-18 US-21-R08: a shared row is never overwritten: OR REPLACE, REPLACE INTO and an upsert on items or predictions are refused; on own tables they stay allowed', () => {
  const bad = {
    'INSERT OR REPLACE INTO items (id, title) VALUES (?, ?)': 'shared_table_overwrite:items',
    'REPLACE INTO predictions (id, metric) VALUES (?, ?)': 'shared_table_overwrite:predictions',
    "INSERT INTO items (id, title) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET status = 'done'": 'shared_table_overwrite:items',
    'UPDATE OR REPLACE predictions SET verdict = ? WHERE id = ?': 'shared_table_overwrite:predictions',
  };
  for (const [s, why] of Object.entries(bad)) assert.equal(checkSql(s, 'x'), why, s);
  assert.equal(checkSql('INSERT OR REPLACE INTO x_things (a) VALUES (?)', 'x'), null);
  assert.equal(checkSql('INSERT OR IGNORE INTO items (id, title) VALUES (?, ?)', 'x'), null, 'an insert that never replaces stays allowed');
});

test('T21-18 US-21-R08: a pack whose id prefixes another id family cannot change that family\'s rows; it updates only predictions it created', async () => {
  const { db } = host();
  db.raw.exec(`INSERT INTO items (id, title, owner_role, done_check, status) VALUES ('BREACH-M-tick', 'breach', 'operations', 'x', 'open'), ('PACKPROBE-email-smtp', 'probe', 'pack-manager-email', 'x', 'open');
    INSERT INTO predictions (id, metric, op, target, due_at) VALUES ('runner-1', 'm', '=', 1, '2026-12-01 00:00:00');`);
  const breach = sandboxDb(db, 'breach');
  await assert.rejects(() => breach.prepare('INSERT INTO items (id, title, owner_role, done_check, status) VALUES (?,?,?,?,?)').bind('BREACH-M-tick', 'x', 'r', 'x', 'done').run());
  assert.throws(() => breach.prepare('INSERT OR REPLACE INTO items (id, title, owner_role, done_check, status) VALUES (?,?,?,?,?)'), /shared_table_overwrite/);
  assert.throws(() => sandboxDb(db, 'pack').prepare('INSERT INTO items (id, title, owner_role, done_check) VALUES (?,?,?,?)').bind('PACKPROBE-email-smtp', 'x', 'r', 'x'), /shared_table_id_not_owned/);
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id = 'BREACH-M-tick'`).get().status, 'open');
  const runner = sandboxDb(db, 'runner');
  await assert.rejects(() => runner.prepare('UPDATE predictions SET observed = ?, verdict = ? WHERE id = ?').bind(1, 'hit', 'runner-1').run(), /shared_table_id_not_owned/);
  assert.equal(db.raw.prepare(`SELECT verdict FROM predictions WHERE id = 'runner-1'`).get().verdict, null, 'the host prediction is unchanged');
  await runner.prepare('INSERT OR IGNORE INTO predictions (id, metric, op, target, due_at) VALUES (?,?,?,?,?)').bind('runner-own-1', 'm', '=', 1, '2026-12-01 00:00:00').run();
  await runner.prepare('UPDATE predictions SET observed = ?, verdict = ? WHERE id = ?').bind(1, 'hit', 'runner-own-1').run();
  assert.equal(db.raw.prepare(`SELECT verdict FROM predictions WHERE id = 'runner-own-1'`).get().verdict, 'hit', 'a prediction the pack created is its own to score');
  await runner.prepare('INSERT OR IGNORE INTO predictions (id, metric, op, target, due_at) VALUES (?,?,?,?,?)').bind('runner-1', 'm', '=', 1, '2026-12-01 00:00:00').run();
  await assert.rejects(() => runner.prepare('UPDATE predictions SET observed = ?, verdict = ? WHERE id = ?').bind(1, 'hit', 'runner-1').run(), /shared_table_id_not_owned/, 'an ignored insert does not make a host row the pack\'s');
  assert.throws(() => checkSqlOrThrow(runner, 'SELECT * FROM packs_rows'), /forbidden_table/, 'the ownership ledger is not readable by a pack');
});
const checkSqlOrThrow = (sdb, sql) => sdb.prepare(sql);

test('T21-18 US-21-R08: numbered and named parameters are refused, so the id the sandbox checks is the id SQLite binds', async () => {
  // SQLite numbers a bare ? after the largest ?NNN seen, so ?5 before a bare ? moves the WHERE id to the sixth argument; :v, @v and $v do the same.
  const shifted = ['UPDATE predictions SET verdict = ?5 WHERE id = ?', 'INSERT INTO items (title, id, owner_role, done_check, status) VALUES (?3, ?, ?, ?, ?)',
    'UPDATE predictions SET verdict = :v WHERE id = ?', 'UPDATE predictions SET verdict = @v WHERE id = ?', 'UPDATE predictions SET verdict = $v WHERE id = ?',
    'SELECT * FROM x_things WHERE a = ?1', 'INSERT INTO x_things (a) VALUES (:a)'];
  for (const s of shifted) assert.equal(checkSql(s, 'runner'), 'numbered_parameter', s);
  for (const s of ["SELECT * FROM x_things WHERE a = '?5' AND b = ':v'", 'SELECT a$b FROM x_things WHERE a = ?', 'SELECT 1 AS "x:y" FROM x_things'])
    assert.notEqual(checkSql(s, 'x'), 'numbered_parameter', `${s}: text, a name with $ inside, or a quoted name is not a parameter`);
  const { db } = host();
  db.raw.exec(`INSERT INTO predictions (id, metric, op, target, due_at) VALUES ('runner-1', 'm', '=', 1, '2026-12-01 00:00:00');`);
  const runner = sandboxDb(db, 'runner');
  await runner.prepare('INSERT OR IGNORE INTO predictions (id, metric, op, target, due_at) VALUES (?,?,?,?,?)').bind('runner-own-1', 'm', '=', 1, '2026-12-01 00:00:00').run();
  assert.throws(() => runner.prepare('UPDATE predictions SET verdict = ?5 WHERE id = ?'), /numbered_parameter/);
  assert.throws(() => runner.prepare('INSERT INTO items (title, id, owner_role, done_check, status) VALUES (?3, ?, ?, ?, ?)'), /numbered_parameter/);
  assert.equal(db.raw.prepare(`SELECT verdict FROM predictions WHERE id = 'runner-1'`).get().verdict, null, 'the host prediction is unchanged');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM items WHERE id LIKE 'PACKFAIL%'`).get().n, 0, 'no host-namespace item was created');
});

test('T21-18 US-21-R08: a pack migration cannot expose a table the pack may not read through its own view or copy one into its own table', async () => {
  const { checkMigrationStatement } = await import('./loader.js');
  for (const s of ['CREATE VIEW x_v AS SELECT * FROM gate_cards', "CREATE VIEW x_v AS SELECT * FROM 'trust_ledger'", 'CREATE VIEW x_v AS SELECT sql FROM sqlite_master',
    'INSERT INTO x_a SELECT recipient, content FROM guard_queue', "CREATE VIEW x_v AS SELECT '--' AS a UNION ALL SELECT rung FROM trust_ledger"]) {
    assert.notDeepEqual(checkMigrationStatement(s, 'x'), [], s);
  }
  assert.deepEqual(checkMigrationStatement('CREATE VIEW IF NOT EXISTS x_v AS SELECT id, title FROM items', 'x'), []);
});
