// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { snapshotD1, EXCLUDE, PREFIX } from '../src/d1snapshot.js';

const d1 = (db) => {
  const stmt = (s) => ({ all: async () => ({ results: db.prepare(s).all() }) });
  return { prepare: stmt, batch: async (list) => Promise.all(list.map(x => x.all())) };
};
const r2 = (broken = false) => {
  const m = new Map();
  return { m,
    head: async (k) => (m.has(k) ? { key: k } : null),
    put: async (k, v) => { m.set(k, broken ? new Uint8Array([1, 2, 3]) : new Uint8Array(v)); },
    get: async (k) => (m.has(k) ? { arrayBuffer: async () => m.get(k).buffer } : null),
    list: async ({ prefix }) => ({ objects: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })), truncated: false }),
    delete: async (ks) => { for (const k of [].concat(ks)) m.delete(k); } };
};
const fixture = () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE items (id TEXT, title TEXT); INSERT INTO items VALUES ('a','one'),('b','two'); CREATE TABLE credentials (k TEXT); INSERT INTO credentials VALUES ('sealed');");
  return db;
};

test('a daily snapshot is stored, read back whole and taken once per day; sealed credentials stay out', async () => {
  const b = r2(), now = Date.parse('2026-11-22T01:00:00Z');
  const r = await snapshotD1(d1(fixture()), b, { now });
  assert.equal(r.key, `${PREFIX}ultrastable-org/2026-11-22.ndjson.gz`);
  assert.equal(r.rows, 2);
  assert.equal(r.readback, true);
  assert.deepEqual(Object.keys(r.counts), ['items']);
  assert.equal((await snapshotD1(d1(fixture()), b, { now })).skipped, 'already taken today');
});

test('a copy that does not read back is reported, and nothing is pruned on it', async () => {
  const b = r2(true);
  for (const d of ['2026-11-01', '2026-11-02']) b.m.set(`${PREFIX}ultrastable-org/${d}.ndjson.gz`, new Uint8Array([0]));
  const r = await snapshotD1(d1(fixture()), b, { now: Date.parse('2026-11-22T01:00:00Z'), keep: 1 });
  assert.equal(r.readback, false);
  assert.equal(r.deleted, 0);
});

test('only the newest copies are kept', async () => {
  const b = r2();
  for (const d of ['2026-11-01', '2026-11-02', '2026-11-03']) b.m.set(`${PREFIX}ultrastable-org/${d}.ndjson.gz`, new Uint8Array([0]));
  const r = await snapshotD1(d1(fixture()), b, { now: Date.parse('2026-11-22T01:00:00Z'), keep: 2 });
  assert.equal(r.deleted, 2);
  assert.deepEqual([...b.m.keys()].sort(), [`${PREFIX}ultrastable-org/2026-11-03.ndjson.gz`, `${PREFIX}ultrastable-org/2026-11-22.ndjson.gz`]);
});

test('no bucket bound is a stated skip, never a pass', async () => {
  assert.equal((await snapshotD1(d1(fixture()), null)).skipped, 'no AUDIT bucket bound');
});

test('the excluded tables match the weekly drill (doctrine/backup.json)', () => {
  const p = new URL('../../../doctrine/backup.json', import.meta.url);
  if (!existsSync(p)) return;  // seed checkout
  assert.deepEqual([...EXCLUDE].sort(), [...JSON.parse(readFileSync(p, 'utf8')).exclude_tables].sort());
});
