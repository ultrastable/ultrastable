// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The SQLite store port (US-14-R02, R06): the handle that stands in for D1 on any host with a file system.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from './d1-sqlite.js';

const withMigrations = (files, fn) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'us-mig-'));
  try { for (const [n, sql] of Object.entries(files)) writeFileSync(path.join(dir, n), sql); return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('US-14-R02: the handle offers prepare().bind().all/first/run with D1-shaped results and run meta', async () => {
  const db = openDb(':memory:');
  db.raw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  const ins = await db.prepare('INSERT INTO t (v) VALUES (?)').bind('a').run();
  assert.deepEqual(ins.meta, { changes: 1, last_row_id: 1 });
  assert.deepEqual((await db.prepare('SELECT * FROM t').all()).results, [{ id: 1, v: 'a' }]);
  assert.deepEqual(await db.prepare('SELECT v FROM t WHERE id=?').bind(1).first(), { v: 'a' });
  assert.equal(await db.prepare('SELECT v FROM t WHERE id=?').bind(2).first(), null);
  db.close();
});

test('US-14-R06: the handle keeps journal mode DELETE unless ULTRASTABLE_JOURNAL says otherwise, with a 5000 ms busy timeout', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'us-db-'));
  const was = process.env.ULTRASTABLE_JOURNAL;
  try {
    delete process.env.ULTRASTABLE_JOURNAL;
    const a = openDb(path.join(dir, 'a.db'));
    assert.equal(a.raw.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
    assert.equal(a.raw.prepare('PRAGMA busy_timeout').get().timeout, 5000);
    a.close();
    process.env.ULTRASTABLE_JOURNAL = 'WAL';
    const b = openDb(path.join(dir, 'b.db'));
    assert.equal(b.raw.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    b.close();
  } finally {
    if (was === undefined) delete process.env.ULTRASTABLE_JOURNAL; else process.env.ULTRASTABLE_JOURNAL = was;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('US-14-R06: migrations are applied in file order and applying the same directory twice leaves one set of tables and the same rows', () => {
  const files = { '0002_b.sql': 'CREATE TABLE IF NOT EXISTS b (id INTEGER PRIMARY KEY, a_id INTEGER);', '0001_a.sql': 'CREATE TABLE IF NOT EXISTS a (id INTEGER PRIMARY KEY); INSERT OR IGNORE INTO a (id) VALUES (1);' };
  withMigrations(files, dir => {
    const file = path.join(dir, 'store.db');
    const first = openDb(file, dir); first.close();
    const second = openDb(file, dir);
    assert.deepEqual(second.raw.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(r => r.name), ['a', 'b']);
    assert.equal(second.raw.prepare('SELECT COUNT(*) AS n FROM a').get().n, 1);
    second.close();
  });
  assert.throws(() => openDb(':memory:', '/no/such/dir'), /ENOENT/);
});
