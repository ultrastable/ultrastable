// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSql, selfMigrateStep } from './selfmigrate.js';

test('splitSql keeps a trigger body whole and drops comments', () => {
  const st = splitSql('-- c\nCREATE TABLE a (x);\nCREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 1; SELECT 2; END;');
  assert.equal(st.length, 2);
  assert.match(st[1], /END;$/);
});

test('the step names itself and takes its table from the caller', () => {
  const s = selfMigrateStep({ files: {}, allow: [], table: 'x_applied', stepName: 'x_step' });
  assert.equal(s.name, 'x_step');
});

// A stand-in for D1: prepare/bind/run/all, and batch() that applies all of its statements or none.
function fakeDb({ batch = true, failOn = null } = {}) {
  const log = [], ledger = new Map(), calls = { batch: 0, run: 0 };
  const stmt = (sql, args = []) => ({
    sql, args, bind: (...a) => stmt(sql, a),
    async run() { calls.run++; exec(sql, args); return {}; },
    async all() { return { results: [...ledger.keys()].map(name => ({ name })) }; },
  });
  const exec = (sql, args) => { if (failOn && sql.includes(failOn)) throw new Error('boom'); if (/^INSERT OR REPLACE/.test(sql)) ledger.set(args[0], args[1]); else if (!/^CREATE TABLE IF NOT EXISTS \w+_applied/.test(sql)) log.push(sql); };
  const db = { prepare: sql => stmt(sql), log, ledger, calls };
  if (batch) db.batch = async list => { calls.batch++; if (failOn && list.some(s => s.sql.includes(failOn))) throw new Error('boom'); for (const s of list) exec(s.sql, s.args); return []; };
  return db;
}
const FILES = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map(n => [`${n}.sql`, `CREATE TABLE IF NOT EXISTS ${n}1 (x);\nCREATE TABLE IF NOT EXISTS ${n}2 (x);`]));

test('a database far behind is caught up a few migrations per run, each as one batched call, and the rest are reported as waiting', async () => {
  const { applyPending } = await import('./selfmigrate.js');
  const db = fakeDb(), allow = Object.keys(FILES);
  const r1 = await applyPending(db, FILES, allow, 't1', 'x_applied');
  assert.deepEqual(r1.filter(x => x.ok).map(x => x.name), ['a.sql', 'b.sql', 'c.sql', 'd.sql']);
  assert.deepEqual(r1.filter(x => x.waiting).map(x => x.name), ['e.sql', 'f.sql']);
  assert.equal(db.calls.batch, 4, 'one call per migration, not one per statement');
  const r2 = await applyPending(db, FILES, allow, 't2', 'x_applied');
  assert.deepEqual(r2.map(x => [x.name, x.ok]), [['e.sql', true], ['f.sql', true]]);
  assert.deepEqual(await applyPending(db, FILES, allow, 't3', 'x_applied'), []);
  assert.equal(db.log.length, 12);
});

test('a migration that fails in a batch leaves nothing behind and is not recorded; without batch() the statements still run in order', async () => {
  const { applyPending } = await import('./selfmigrate.js');
  const bad = fakeDb({ failOn: 'b2' });
  const r = await applyPending(bad, FILES, ['a.sql', 'b.sql'], 't', 'x_applied');
  assert.deepEqual(r.map(x => x.ok), [true, false]);
  assert.ok(!bad.ledger.has('b.sql')); assert.ok(!bad.log.some(s => s.includes('b1')), 'the failed migration landed no statement');
  const plain = fakeDb({ batch: false });
  assert.deepEqual((await applyPending(plain, FILES, ['a.sql'], 't', 'x_applied')).map(x => x.ok), [true]);
  assert.ok(plain.ledger.has('a.sql')); assert.equal(plain.log.length, 2);
});

// ---- US-01-R04: export before drop, through the tick's own migration applier ----
const { makeDb } = await import('../_shared/testdb.js');
const { createExporter, memoryStore } = await import('../export/index.js');
const EXPORT_MIG = new URL('../export/migrations/', import.meta.url).pathname;
const NOW = Date.UTC(2026, 10, 26, 9, 0, 0);
const DESTRUCTIVE = { 'a_drop.sql': `DROP TABLE org;`, 'b_add.sql': `CREATE TABLE IF NOT EXISTS extra_notes (id INTEGER PRIMARY KEY, body TEXT);` };
const world = (store = memoryStore()) => {
  const db = makeDb([EXPORT_MIG]);
  db.raw.exec(`INSERT INTO org (key, value) VALUES ('name', 'Example'), ('slug', 'example')`);
  return { db, store, exporter: createExporter({ db, store, now: () => NOW }) };
};
const has = (db, name) => Boolean(db.raw.prepare(`SELECT name FROM sqlite_master WHERE name = ?`).get(name));
const ledgered = (db, name) => Boolean(db.raw.prepare(`SELECT name FROM applied_migrations WHERE name = ?`).get(name));

test('US-01-R04: selfmigrate refuses a destructive file when no exporter is given, reports it, and still applies the additive file after it', async () => {
  const { applyPending } = await import('./selfmigrate.js');
  const { db } = world();
  const r = await applyPending(db, DESTRUCTIVE, ['a_drop.sql', 'b_add.sql'], 't1');
  assert.deepEqual(r.map(x => [x.name, x.ok]), [['a_drop.sql', false], ['b_add.sql', true]]);
  assert.equal(r[0].refused, 'destructive migration needs an export store');
  assert.ok(has(db, 'org'), 'the data is untouched');
  assert.ok(!ledgered(db, 'a_drop.sql'), 'a refused file is not recorded as applied, so it is offered again');
  assert.ok(has(db, 'extra_notes') && ledgered(db, 'b_add.sql'));
});

test('US-01-R04: selfmigrate applies a destructive file after a verified export, records it, and the export is readable', async () => {
  const { applyPending } = await import('./selfmigrate.js');
  const { db, store, exporter } = world();
  const r = await applyPending(db, DESTRUCTIVE, ['a_drop.sql'], 't1', 'applied_migrations', { exporter });
  assert.deepEqual(r, [{ name: 'a_drop.sql', ok: true, exported: 1 }]);
  assert.ok(!has(db, 'org'));
  assert.ok(ledgered(db, 'a_drop.sql'));
  const [proof] = await exporter.ledger();
  assert.equal(proof.verified, 1); assert.equal(proof.table_name, 'org'); assert.equal(proof.row_count, 2);
  assert.deepEqual(await exporter.readExport(proof.object_key), [{ key: 'name', value: 'Example' }, { key: 'slug', value: 'example' }]);
  assert.equal(store.m.size, 1);
  // a second run has nothing to do
  assert.deepEqual(await applyPending(db, DESTRUCTIVE, ['a_drop.sql'], 't2', 'applied_migrations', { exporter }), []);
});

test('US-01-R04: a corrupted, unreadable or offline export refuses the file: the data stays and the file is not recorded', async () => {
  const { applyPending } = await import('./selfmigrate.js');
  const stores = [
    { async put() {}, async get() { return null; } },
    { async put() {}, async get() { return { text: async () => '{"key":"other","value":"x"}' }; } },
    { async put() { throw new Error('bucket offline'); }, async get() { return null; } },
  ];
  for (const store of stores) {
    const { db, exporter } = world(store);
    const r = await applyPending(db, DESTRUCTIVE, ['a_drop.sql'], 't1', 'applied_migrations', { exporter });
    assert.equal(r[0].ok, false); assert.equal(r[0].refused, 'export_not_verified'); assert.match(r[0].error, /export of org not verified/);
    assert.ok(has(db, 'org')); assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM org`).get().n, 2);
    assert.ok(!ledgered(db, 'a_drop.sql'));
  }
});

test('US-01-R04: an additive file is applied with no export and the exporter is not used for it', async () => {
  const { applyPending } = await import('./selfmigrate.js');
  const { db, store, exporter } = world();
  const r = await applyPending(db, DESTRUCTIVE, ['b_add.sql'], 't1', 'applied_migrations', { exporter });
  assert.deepEqual(r, [{ name: 'b_add.sql', ok: true }]);
  assert.equal(store.m.size, 0);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM export_ledger`).get().n, 0);
});

test('US-01-R04: the migrate step note names a refused file, so a refusal is visible in the tick report and never silent', async () => {
  const { db } = world();
  const notes = [];
  await selfMigrateStep({ files: DESTRUCTIVE, allow: ['a_drop.sql'] }).run(db, { nowIso: 't', notes });
  assert.match(notes[0], /a_drop\.sql REFUSED \(destructive migration needs an export store\)/);
});

test('US-01-R04: with batch(), a destructive file and its ledger row land together or not at all', async () => {
  const { applyPending } = await import('./selfmigrate.js');
  const batched = (db) => Object.assign(db, { batches: 0, async batch(list) { this.batches++; db.raw.exec('BEGIN'); try { for (const s of list) await s.run(); db.raw.exec('COMMIT'); } catch (e) { db.raw.exec('ROLLBACK'); throw e; } } });
  const ok = world(); batched(ok.db);
  const r1 = await applyPending(ok.db, DESTRUCTIVE, ['a_drop.sql'], 't1', 'applied_migrations', { exporter: ok.exporter });
  assert.equal(r1[0].ok, true); assert.equal(ok.db.batches, 1, 'the migration and its ledger row were one call');
  assert.ok(!has(ok.db, 'org') && ledgered(ok.db, 'a_drop.sql'));
  const bad = world(); batched(bad.db);
  const files = { 'c_half.sql': `DROP TABLE org; INSERT INTO table_that_is_not_there (x) VALUES (1);` };
  const r2 = await applyPending(bad.db, files, ['c_half.sql'], 't1', 'applied_migrations', { exporter: bad.exporter });
  assert.equal(r2[0].ok, false);
  assert.ok(has(bad.db, 'org') && bad.db.raw.prepare(`SELECT COUNT(*) AS n FROM org`).get().n === 2, 'the drop was rolled back with the failing statement');
  assert.ok(!ledgered(bad.db, 'c_half.sql'));
  assert.equal((await bad.exporter.ledger())[0].verified, 1, 'the verified export of the table stays as the proof it was taken');
});

test('US-01-R04: files refused for want of an exporter do not spend the per-run cap, so additive migrations behind them still apply', async () => {
  const { applyPending } = await import('./selfmigrate.js');
  const { db } = world();
  const files = { d1: 'DELETE FROM org;', d2: 'DELETE FROM org;', d3: 'DELETE FROM org;', d4: 'DELETE FROM org;', z_add: 'CREATE TABLE IF NOT EXISTS extra_notes (id INTEGER PRIMARY KEY);' };
  const allow = ['d1', 'd2', 'd3', 'd4', 'z_add'];
  const r = await applyPending(db, files, allow, 't1', 'applied_migrations', { max: 4 });
  assert.deepEqual(r.map(x => [x.name, x.ok, Boolean(x.refused)]), [['d1', false, true], ['d2', false, true], ['d3', false, true], ['d4', false, true], ['z_add', true, false]]);
  assert.ok(ledgered(db, 'z_add'), 'the additive file behind four refused ones is applied in the same run');
  assert.ok(has(db, 'org'));
});
