// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// RETENTION-1: history tables are pruned once a day by their declared keep_days; state tables are never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pruneAll, cutoff } from '../src/retention.js';

function mkdb() {
  const raw = new DatabaseSync(':memory:');
  const db = { prepare(sql) { const st = raw.prepare(sql); let a = []; const o = { bind(...x) { a = x; return o; },
    async all() { return { results: st.all(...a).map(r => ({ ...r })) }; }, async first() { const r = st.get(...a); return r ? { ...r } : null; },
    async run() { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
  return { raw, db };
}
const NOW = Date.parse('2026-11-16T12:00:00Z');
const rules = { max_rows_per_run: 3, tables: { cost_samples: { column: 'at', keep_days: 30 }, items: { keep: 'state', reason: 'queue' }, missing_table: { column: 'at', keep_days: 1 } } };

test('rows older than keep_days are removed, newer rows and state tables are kept, at most max_rows_per_run a day', async () => {
  const { raw, db } = mkdb();
  raw.exec("CREATE TABLE cost_samples (at TEXT NOT NULL, target TEXT); CREATE TABLE items (id TEXT, created_at TEXT)");
  const old = cutoff(40, NOW), recent = cutoff(5, NOW);
  for (let i = 0; i < 5; i++) raw.prepare('INSERT INTO cost_samples VALUES (?, ?)').run(old, 'x' + i);
  raw.prepare('INSERT INTO cost_samples VALUES (?, ?)').run(recent, 'new');
  raw.prepare('INSERT INTO items VALUES (?, ?)').run('a', old);
  const r = await pruneAll(db, { rules, now: NOW });
  assert.equal(r.ran, true);
  assert.deepEqual(r.tables, [{ table: 'cost_samples', deleted: 3 }], 'bounded per run; a missing table is skipped');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM cost_samples').get().c, 3);
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM items').get().c, 1, 'state table untouched');
  assert.equal((await pruneAll(db, { rules, now: NOW })).ran, false, 'once a day');
  const next = await pruneAll(db, { rules, now: NOW + 864e5 });
  assert.equal(next.tables[0].deleted, 2);
  assert.equal(raw.prepare("SELECT target FROM cost_samples").all().map(x => x.target).join(), 'new');
});

test('no rules means nothing runs; names are checked before they reach SQL', async () => {
  const { raw, db } = mkdb();
  assert.equal((await pruneAll(db, {})).ran, false);
  raw.exec("CREATE TABLE t (at TEXT)");
  const r = await pruneAll(db, { rules: { tables: { 't; DROP TABLE t': { column: 'at', keep_days: 1 } } }, now: NOW });
  assert.equal(r.tables[0].error, 'unsafe name');
  assert.ok(raw.prepare("SELECT name FROM sqlite_master WHERE name='t'").get());
});

test('the tick runs the prune and the config carries the rules', () => {
  const idx = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(idx, /pruneAll\(env\.DB, \{ rules: config\.retention, archive:/);
  assert.match(readFileSync(new URL('../src/handoff.js', import.meta.url), 'utf8'), /retention: await j\('seed\/autonomy\/retention\.json'\)/);
  const rules = JSON.parse(readFileSync(new URL('../../autonomy/retention.json', import.meta.url), 'utf8'));
  for (const [t, r] of Object.entries(rules.tables)) assert.ok((r.keep_days > 0 && r.column) || (r.keep && r.reason), t + ' needs keep_days and column, or keep and a reason');
});

test('a table with unit "ms" is pruned by its integer-millisecond time column (host_events)', async () => {
  const { raw, db } = mkdb();
  raw.exec('CREATE TABLE host_events (at INTEGER NOT NULL, host TEXT)');
  raw.prepare('INSERT INTO host_events VALUES (?, ?)').run(NOW - 40 * 864e5, 'old');
  raw.prepare('INSERT INTO host_events VALUES (?, ?)').run(NOW - 1 * 864e5, 'new');
  const r = await pruneAll(db, { rules: { max_rows_per_run: 10, tables: { host_events: { column: 'at', unit: 'ms', keep_days: 30 } } }, now: NOW });
  assert.deepEqual(r.tables, [{ table: 'host_events', deleted: 1 }]);
  assert.equal(raw.prepare('SELECT host FROM host_events').get().host, 'new');
});
