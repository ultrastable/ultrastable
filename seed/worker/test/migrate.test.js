// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makeDb } from './d1shim.js';
import { ensureItem } from '../src/tick.js';
import { migrateStep } from '../src/migrate.js';

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
