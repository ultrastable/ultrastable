// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-33, the part of the deploy path that carries a merged change's schema to the database: the ledgered plan the deploy uses and the same rules applied by
// the tick through its own binding. The database is the in-memory one the other tests use; no credential and no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeDb } from './d1shim.js';
import { ensureItem } from '../src/tick.js';
import { migrateStep } from '../src/migrate.js';
import { planMigrations } from '../../../deploy/migration-plan.mjs';

const ctx = () => ({ nowIso: '2026-11-26 12:00:00', notes: [] });
const sha = s => createHash('sha256').update(s).digest('hex');
const ledger = (db) => Object.fromEntries(db.raw.prepare('SELECT file, sha256 FROM _migrations').all().map(r => [r.file, r.sha256]));
const pending = (db) => db.raw.prepare("SELECT value FROM org WHERE key='migrations_pending'").get().value;

test('US-33-R89: a migration a merged change adds is planned from a sha256 ledger, applied once through the tick\'s own binding, never re-run when edited, and a failure stops the later files and files one item', async () => {
  // the plan: files sorted by name; an unrecorded one applies, a recorded one with the same hash is skipped, a recorded one whose hash changed is drift with the old hash kept
  const plan = planMigrations([{ file: '0003_c.sql', sha256: 'c' }, { file: '0001_a.sql', sha256: 'a' }, { file: '0002_b.sql', sha256: 'b2' }], new Map([['0001_a.sql', 'a'], ['0002_b.sql', 'b1']]));
  assert.deepEqual(plan.map(m => [m.file, m.action]), [['0001_a.sql', 'skip'], ['0002_b.sql', 'drift'], ['0003_c.sql', 'apply']]); assert.equal(plan[1].was, 'b1');
  assert.deepEqual(planMigrations([{ file: 'x.sql', sha256: '1' }], null).map(m => m.action), ['apply'], 'an empty ledger applies everything');
  // the tick applies the same rules with no credential: statements run in file order, each file once, the hash of the file text is the ledger row
  const db = makeDb(), first = { file: '9001_a.sql', sql: 'CREATE TABLE IF NOT EXISTS s33_a (x INTEGER);\nALTER TABLE s33_a ADD COLUMN y TEXT;\n' };
  const r1 = await migrateStep(db, ctx(), [first], ensureItem);
  assert.deepEqual([r1.applied, r1.drift, r1.failed, r1.pending], [['9001_a.sql'], [], [], 0]); assert.equal(ledger(db)['9001_a.sql'], sha(first.sql)); assert.equal(pending(db), '0');
  assert.deepEqual((await migrateStep(db, ctx(), [first], ensureItem)).applied, [], 'a recorded file is not run again');
  // a column that is already there is the state the statement asks for (a partly applied file, or the deploy runner got there first); the file is still recorded
  db.raw.exec('CREATE TABLE s33_b (x INTEGER, y TEXT)');
  const dup = { file: '9002_b.sql', sql: 'ALTER TABLE s33_b ADD COLUMN y TEXT;\nCREATE TABLE IF NOT EXISTS s33_b2 (z INTEGER);\n' };
  const r2 = await migrateStep(db, ctx(), [first, dup], ensureItem); assert.deepEqual([r2.applied, r2.failed], [['9002_b.sql'], []]); assert.ok(db.raw.prepare("SELECT name FROM sqlite_master WHERE name='s33_b2'").get(), 'the statements after the duplicate column ran');
  // an applied file whose text changed is drift: not re-run, counted pending, one item for the person-free fix (a new migration file)
  const edited = { ...first, sql: first.sql + '-- edited after it ran\nCREATE TABLE s33_never (q INTEGER);\n' };
  const c3 = ctx(), r3 = await migrateStep(db, c3, [edited, dup], ensureItem);
  assert.deepEqual([r3.applied, r3.drift, r3.pending], [[], ['9001_a.sql'], 1]); assert.equal(pending(db), '1'); assert.equal(db.raw.prepare("SELECT name FROM sqlite_master WHERE name='s33_never'").get(), undefined, 'a drifted file is never run again');
  const item = db.raw.prepare("SELECT kind, owner_role, priority, done_check, closing_probe FROM items WHERE id='MIGRATION-9001_a'").get();
  assert.deepEqual({ ...item }, { kind: 'fix', owner_role: 'operations', priority: -1, done_check: 'org.migrations_pending = 0', closing_probe: 'selfaudit:migrations-pending' });
  assert.equal(ledger(db)['9001_a.sql'], sha(first.sql), 'the ledger keeps the hash the file had when it ran');
  // a file that fails stops the run, because a later file may depend on it, and is reported with its reason
  const c4 = ctx(), bad = { file: '9003_bad.sql', sql: 'CREATE TABLE s33_bad (' }, later = { file: '9004_later.sql', sql: 'CREATE TABLE IF NOT EXISTS s33_later (x INTEGER);\n' };
  const r4 = await migrateStep(db, c4, [first, dup, bad, later], ensureItem);
  assert.deepEqual([r4.applied, r4.failed], [[], ['9003_bad.sql']]); assert.equal(db.raw.prepare("SELECT name FROM sqlite_master WHERE name='s33_later'").get(), undefined); assert.match(c4.notes[0], /9003_bad\.sql failed/);
  assert.ok(db.raw.prepare("SELECT id FROM items WHERE id='MIGRATION-9003_bad'").get());
  // a table rebuild marked atomic applies whole or not at all: a failure between its statements leaves the old table in place
  const atomicBad = { file: '9005_rebuild.sql', sql: '-- atomic: rebuild s33_a\nCREATE TABLE s33_a_new (x INTEGER);\nINSERT INTO s33_a_new SELECT x FROM s33_a;\nDROP TABLE s33_a;\nALTER TABLE s33_missing RENAME TO s33_a;\n' };
  const r5 = await migrateStep(db, ctx(), [atomicBad], ensureItem); assert.deepEqual(r5.failed, ['9005_rebuild.sql']);
  assert.ok(db.raw.prepare("SELECT name FROM sqlite_master WHERE name='s33_a'").get(), 'the old table survived the failed rebuild'); assert.equal(db.raw.prepare("SELECT name FROM sqlite_master WHERE name='s33_a_new'").get(), undefined, 'the half-built table was rolled back');
  // without a list there is nothing to do and nothing is written
  assert.deepEqual(await migrateStep(makeDb(), ctx(), [], ensureItem), { applied: [], drift: [], failed: [], pending: null });
});
