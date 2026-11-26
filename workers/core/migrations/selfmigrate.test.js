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
