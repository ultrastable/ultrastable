// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makeDb } from './d1shim.js';
import { ensureItem } from '../src/tick.js';
import { migrateStep, unbackedDrops } from '../src/migrate.js';

const dir = new URL('../migrations/', import.meta.url);
const files = () => readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(file => ({ file, sql: readFileSync(new URL(file, dir), 'utf8') }));
const ctx = () => ({ nowIso: '2026-11-17 12:00:00', notes: [] });

test('index.json lists exactly the migration files (the tick config is generated from it)', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')), files().map(m => m.file));
});

test('a recorded migration is skipped, an unrecorded one is applied once and ledgered with the file sha256', async () => {
  const db = makeDb();
  const ms = files(); const last = ms[ms.length - 1];
  db.raw.exec(`DROP TABLE IF EXISTS unknown_questions`);
  db.raw.exec(`CREATE TABLE IF NOT EXISTS _migrations (file TEXT PRIMARY KEY, sha256 TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await migrateStep(db, ctx(), ms.slice(0, -1), ensureItem);
  const r = await migrateStep(db, ctx(), ms, ensureItem);
  assert.deepEqual(r.applied, [last.file]);
  assert.equal(db.raw.prepare(`SELECT sha256 FROM _migrations WHERE file=?`).get(last.file).sha256, createHash('sha256').update(last.sql).digest('hex'));
  assert.ok(db.raw.prepare(`SELECT name FROM sqlite_master WHERE name='unknown_questions'`).get());
  assert.deepEqual((await migrateStep(db, ctx(), ms, ensureItem)).applied, [], 'idempotent');
  assert.equal(db.raw.prepare(`SELECT value FROM org WHERE key='migrations_pending'`).get().value, '0');
});

test('an applied file whose text changed is drift: not re-run, pending 1, an item is filed', async () => {
  const db = makeDb(); const ms = files();
  await migrateStep(db, ctx(), ms, ensureItem);
  const edited = ms.map((m, i) => i === 0 ? { ...m, sql: m.sql + '\n-- edited' } : m);
  const r = await migrateStep(db, ctx(), edited, ensureItem);
  assert.deepEqual(r.drift, [ms[0].file]);
  assert.equal(db.raw.prepare(`SELECT value FROM org WHERE key='migrations_pending'`).get().value, '1');
  assert.ok(db.raw.prepare(`SELECT id FROM items WHERE id=?`).get('MIGRATION-' + ms[0].file.replace(/\.sql$/, '')));
});

test('a failing migration stops the run, is reported and counted pending', async () => {
  const db = makeDb(); const c = ctx();
  const r = await migrateStep(db, c, [{ file: '9999_bad.sql', sql: 'CREATE TABLE nope (' }], ensureItem);
  assert.deepEqual(r.failed, ['9999_bad.sql']);
  assert.equal(r.pending, 1); assert.match(c.notes[0], /9999_bad/);
});

test('without a migration list the step does nothing', async () => {
  assert.deepEqual(await migrateStep(makeDb(), ctx(), null, ensureItem), { applied: [], drift: [], failed: [], pending: null });
});

test('US-01-R04: every shipped migration is additive, or copies the whole table in the same atomic file before it drops it', () => {
  for (const m of files()) assert.deepEqual(unbackedDrops(m.sql), [], m.file);
  const rebuild = files().find(m => /^DROP\s+TABLE\s+trust_ledger\s*;/mi.test(m.sql));
  assert.ok(rebuild, 'the trust ledger rebuild is the shipped case of a drop with its copy');
  assert.equal(unbackedDrops(rebuild.sql.replace(/^CREATE TABLE IF NOT EXISTS \w+ AS SELECT \* FROM trust_ledger;$/m, '')).length, 1, 'the same file without its copy is refused');
  assert.equal(unbackedDrops(rebuild.sql.replace(/^-- atomic:.*$/m, '-- not one transaction')).length, 1, 'the same file outside one transaction is refused');
  assert.deepEqual(unbackedDrops('CREATE TABLE t_v2 (a);\nDROP TABLE IF EXISTS t_v2;\nALTER TABLE t_v2 RENAME TO t;'), [], 'a staging table the file renames away holds no data of record');
  assert.equal(unbackedDrops('-- atomic: x\nCREATE TABLE keep AS SELECT * FROM items;\nALTER TABLE items DROP COLUMN blocker;').length, 0);
  assert.equal(unbackedDrops('ALTER TABLE items DROP COLUMN blocker;').length, 1);
  assert.deepEqual(unbackedDrops('DROP INDEX IF EXISTS idx_items_status;\nCREATE TRIGGER tr AFTER INSERT ON items BEGIN\n  DELETE FROM claims WHERE item_id = NEW.id;\nEND;'), [], 'indexes and trigger bodies are not data drops');
});

test('US-01-R04: the tick refuses a migration that drops a table with no copy: nothing runs, the table and its rows stay, an item is filed', async () => {
  const db = makeDb(); const c = ctx(); const ms = files();
  await migrateStep(db, c, ms, ensureItem);
  db.raw.exec(`INSERT INTO items (id, title, owner_role, done_check) VALUES ('KEEP-1', 'kept', 'staff', 'x')`);
  const r = await migrateStep(db, c, [...ms, { file: '9998_drop.sql', sql: 'CREATE TABLE IF NOT EXISTS ran_first (a);\nDROP TABLE items;' }], ensureItem);
  assert.deepEqual(r.failed, ['9998_drop.sql']);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM items WHERE id='KEEP-1'`).get().n, 1);
  assert.equal(db.raw.prepare(`SELECT name FROM sqlite_master WHERE name='ran_first'`).get(), undefined, 'no statement of a refused file runs');
  assert.equal(db.raw.prepare(`SELECT file FROM _migrations WHERE file='9998_drop.sql'`).get(), undefined);
  assert.ok(c.notes.some(n => /9998_drop\.sql failed: refused, not applied: drops table items/.test(n)));
  assert.ok(db.raw.prepare(`SELECT id FROM items WHERE id='MIGRATION-9998_drop'`).get());
});
