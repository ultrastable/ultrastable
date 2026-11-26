// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeDb } from '../_shared/testdb.js';
import { createExporter, classify, splitStatements, memoryStore, lintMigrations } from './index.js';

const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);
const setup = (store = memoryStore()) => { const db = makeDb([MIG]); return { db, store, ex: createExporter({ db, store, now: () => NOW }) }; };
const count = (db, sql) => db.raw.prepare(sql).get().n;

test('US-01-R04: classify finds drops and rewrites, and leaves additive statements, views, indexes and trigger bodies alone', () => {
  assert.deepEqual(classify(`CREATE TABLE IF NOT EXISTS a (id INTEGER); CREATE INDEX IF NOT EXISTS i ON a(id); DROP VIEW IF EXISTS v; INSERT OR IGNORE INTO a VALUES (1);`).destructive, false);
  const c = classify(`DROP TABLE IF EXISTS items; ALTER TABLE roles DROP COLUMN model; -- DELETE FROM org\nDELETE FROM claims WHERE 1; UPDATE "outcomes" SET result='x'; ALTER TABLE org RENAME TO org2;`);
  assert.deepEqual(c.tables, ['items', 'roles', 'claims', 'outcomes', 'org']);
  assert.deepEqual(c.findings.map(f => f.kind), ['drop table', 'drop column', 'delete rows', 'rewrite rows', 'rename']);
  const trig = `CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET id = CASE WHEN id > 1 THEN 1 ELSE 0 END; DELETE FROM b; END; CREATE TABLE c (x TEXT DEFAULT ';--');`;
  assert.equal(splitStatements(trig).length, 2);
  assert.equal(classify(trig).destructive, false);
});

test('US-01-R04: every migration shipped in this repository is additive', () => {
  const files = [];
  const dirs = [path.join(ROOT, 'core/migrations'), path.join(ROOT, 'adapters/shared/migrations')];
  for (const m of readdirSync(path.join(ROOT, 'core'))) dirs.push(path.join(ROOT, 'core', m, 'migrations'));
  for (const d of dirs.filter(existsSync)) for (const f of readdirSync(d).filter(n => n.endsWith('.sql'))) files.push({ name: path.relative(ROOT, path.join(d, f)), sql: readFileSync(path.join(d, f), 'utf8') });
  assert.ok(files.length > 20);
  assert.deepEqual(lintMigrations(files), []);
});

test('US-01-R04: an additive migration is applied with no export', async () => {
  const { db, store, ex } = setup();
  const r = await ex.applyMigration('0009_add', `CREATE TABLE IF NOT EXISTS extra_notes (id INTEGER PRIMARY KEY, body TEXT); INSERT OR IGNORE INTO extra_notes (id, body) VALUES (1, 'a;b');`);
  assert.equal(r.applied, true); assert.equal(r.destructive, false);
  assert.equal(store.m.size, 0);
  assert.equal(db.raw.prepare(`SELECT body FROM extra_notes`).get().body, 'a;b');
});

test('US-01-R04: a destructive migration is preceded by an export that is verified readable, then applied', async () => {
  const { db, store, ex } = setup();
  db.raw.exec(`INSERT INTO org (key, value) VALUES ('name', 'Example'), ('slug', 'example')`);
  const r = await ex.applyMigration('0010_drop_org', `DROP TABLE org;`);
  assert.equal(r.applied, true);
  assert.equal(r.exports.length, 1); assert.equal(r.exports[0].verified, true); assert.equal(r.exports[0].rows, 2);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sqlite_master WHERE name='org'`), 0);
  const led = await ex.ledger();
  assert.equal(led[0].verified, 1); assert.equal(led[0].at, '2026-11-15 12:00:00'); assert.match(led[0].sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(await ex.readExport(led[0].object_key), [{ key: 'name', value: 'Example' }, { key: 'slug', value: 'example' }]);
  assert.equal(db.raw.prepare(`SELECT outcome FROM export_migrations WHERE name='0010_drop_org'`).get().outcome, 'applied');
});

test('US-01-R04: no object store, an unreadable export or a corrupted export refuses the migration and leaves the data', async () => {
  const cases = [
    null,
    { async put() {}, async get() { return null; } },
    { async put() {}, async get() { return { text: async () => '{"key":"other","value":"x"}' }; } },
    { async put() { throw new Error('bucket offline'); }, async get() { return null; } },
  ];
  for (const store of cases) {
    const db = makeDb([MIG]);
    db.raw.exec(`INSERT INTO org (key, value) VALUES ('name', 'Example')`);
    const ex = createExporter({ db, store, now: () => NOW });
    const r = await ex.applyMigration('0011_rewrite', `UPDATE org SET value = 'gone';`);
    assert.equal(r.applied, false); assert.equal(r.refusal, 'export_not_verified');
    assert.equal(db.raw.prepare(`SELECT value FROM org`).get().value, 'Example');
    assert.equal(db.raw.prepare(`SELECT outcome FROM export_migrations WHERE name='0011_rewrite'`).get().outcome, 'refused');
  }
});

test('an empty table exports and verifies; a table that does not exist needs no export; a bad table name is refused', async () => {
  const { ex } = setup();
  const e = await ex.exportTable('claims');
  assert.equal(e.verified, true); assert.equal(e.rows, 0);
  const r = await ex.applyMigration('0012_none', `DROP TABLE IF EXISTS never_there;`);
  assert.equal(r.applied, true); assert.equal(r.exports.length, 0);
  await assert.rejects(() => ex.exportTable('org; DROP TABLE org'), /not a table name/);
});

test('US-01-R04: statements handed in with a migration (a caller ledger row) land with it in one batch when the store has batch(), in order when it has not, and never when the export is refused', async () => {
  const batched = (db) => Object.assign(db, { batches: 0, async batch(list) { this.batches++; db.raw.exec('BEGIN'); try { for (const s of list) await s.run(); db.raw.exec('COMMIT'); } catch (e) { db.raw.exec('ROLLBACK'); throw e; } } });
  const ledgerRow = (db, name) => { db.raw.exec(`CREATE TABLE IF NOT EXISTS mig_ledger (name TEXT PRIMARY KEY)`); return [db.prepare(`INSERT INTO mig_ledger (name) VALUES (?)`).bind(name)]; };
  const rows = (db) => count(db, `SELECT COUNT(*) AS n FROM mig_ledger`), hasOrg = (db) => count(db, `SELECT COUNT(*) AS n FROM sqlite_master WHERE name='org'`);
  const a = setup(); batched(a.db);
  assert.equal((await a.ex.applyMigration('0013_drop', `DROP TABLE org;`, { also: ledgerRow(a.db, '0013_drop') })).applied, true);
  assert.equal(a.db.batches, 1, 'the migration and its ledger row were one call'); assert.equal(rows(a.db), 1); assert.equal(hasOrg(a.db), 0);
  const half = setup(); batched(half.db);
  await assert.rejects(() => half.ex.applyMigration('0014_half', `DROP TABLE org; INSERT INTO table_that_is_not_there (x) VALUES (1);`, { also: ledgerRow(half.db, '0014_half') }));
  assert.equal(rows(half.db), 0, 'the ledger row did not land without the migration'); assert.equal(hasOrg(half.db), 1, 'the drop was rolled back with the failing statement');
  const plain = setup();
  assert.equal((await plain.ex.applyMigration('0015_plain', `CREATE TABLE IF NOT EXISTS extra_two (x);`, { also: ledgerRow(plain.db, '0015_plain') })).applied, true);
  assert.equal(rows(plain.db), 1, 'without batch() the statements run in order');
  const refused = setup(null); refused.db.raw.exec(`INSERT INTO org (key, value) VALUES ('a','b')`);
  assert.equal((await refused.ex.applyMigration('0016_refused', `DROP TABLE org;`, { also: ledgerRow(refused.db, '0016_refused') })).applied, false);
  assert.equal(rows(refused.db), 0, 'a refused migration records nothing'); assert.equal(hasOrg(refused.db), 1);
});
