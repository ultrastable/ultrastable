// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// AUDIT-CHAIN-1: hash chain, sealing, tamper detection, indexed lookup, retention hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { record, seal, verify, trace, head, bloomBuild, bloomHas, redact, GENESIS } from '../src/auditchain.js';
import { pruneAll } from '../src/retention.js';
import { archiveRows } from '../src/auditchain.js';

const mem = (name = 'mem') => { const m = new Map(); return { name, m, async put(k, b) { if (m.has(k) && Buffer.compare(Buffer.from(m.get(k)), Buffer.from(b))) throw new Error('conflict'); m.set(k, Uint8Array.from(b)); }, async get(k) { return m.get(k) || null; } }; };
const DAY = 864e5, NOW = Date.parse('2026-11-17T12:00:00Z');
async function fill(db, n, daysAgo) { for (let i = 0; i < n; i++) await record(db, { at: NOW - daysAgo * DAY, kind: i % 2 ? 'deploy' : 'decision', actor: 'tick', ref: 'item-' + (i % 5), summary: 'event ' + i }, { now: NOW - daysAgo * DAY }); }

test('rows chain from genesis and verify', async () => {
  const db = makeDb(); await fill(db, 5, 0);
  const v = await verify(db, []); assert.equal(v.ok, true); assert.equal(v.hot.rows, 5);
  assert.equal((await head(db)).seq, 5);
});

test('secrets and contact details are removed before they rest', async () => {
  assert.equal(redact('mail a@b.io token ghp_' + 'a'.repeat(30) + ' https://x.io/p?q=1'), 'mail [removed] token [removed] https://x.io/p');
});

test('old rows seal to every sink, D1 shrinks to an index row, hot tail keeps chaining, deep verify passes', async () => {
  const db = makeDb(), a = mem('r2'), b = mem('github'); await fill(db, 12, 20); await fill(db, 3, 0);
  const r = await seal(db, [a, b], { now: NOW }); assert.equal(r.sealed, 12); assert.deepEqual(r.sinks, ['r2', 'github']);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM audit_log').first()).n, 3);
  await fill(db, 1, 0);
  const v = await verify(db, [a, b], { deep: true }); assert.equal(v.ok, true, JSON.stringify(v.bad)); assert.equal(v.deep_segments_read, 1);
  assert.equal((await seal(db, [a, b], { now: NOW })).sealed, 0);
});

test('nothing is deleted without a sink', async () => {
  const db = makeDb(); await fill(db, 4, 30);
  assert.equal((await seal(db, [], { now: NOW })).sealed, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM audit_log').first()).n, 4);
});

test('tampering with the archive, the D1 index or a hot row is detected', async () => {
  const db = makeDb(), a = mem(); await fill(db, 6, 20); await seal(db, [a], { now: NOW }); await fill(db, 2, 0);
  const key = [...a.m.keys()].find(k => k.includes('/seg/')), good = a.m.get(key);
  a.m.set(key, new Uint8Array([...good].map((x, i) => i === 20 ? x ^ 1 : x)));
  assert.equal((await verify(db, [a], { deep: true })).ok, false); a.m.set(key, good);
  assert.equal((await verify(db, [a], { deep: true })).ok, true);
  db.raw.exec("UPDATE audit_segments SET merkle_root = 'f'");
  assert.equal((await verify(db, [a])).ok, false);
  const db2 = makeDb(); await fill(db2, 3, 0); db2.raw.exec("UPDATE audit_log SET summary = 'rewritten' WHERE seq = 2");
  assert.equal((await verify(db2, [])).ok, false);
});

test('trace finds a ref in hot rows and in archived segments, skipping segments whose filter cannot match', async () => {
  const db = makeDb(), a = mem(); await fill(db, 10, 30); await seal(db, [a], { now: NOW });
  await record(db, { kind: 'deploy', actor: 'x', ref: 'unique-ref', summary: 'z' }, { now: NOW - 40 * DAY }); // out-of-order rec stays hot
  await fill(db, 3, 0);
  const t = await trace(db, [a], { ref: 'item-2' }); assert.ok(t.rows.length >= 3); assert.ok(t.rows.every(r => r.ref === 'item-2'));
  const none = await trace(db, [a], { ref: 'no-such-thing-xyz' }); assert.equal(none.rows.length, 0); assert.equal(none.segments_opened, 0);
  assert.ok(bloomHas(bloomBuild(new Set(['a', 'b'])), 'a'));
});

test('retention archives rows into the chain before deleting them, and deletes nothing if archiving fails', async () => {
  const db = makeDb(); db.raw.exec("CREATE TABLE outcomes2 (id INTEGER PRIMARY KEY, at TEXT, result TEXT)");
  db.raw.exec("INSERT INTO outcomes2 (at, result) VALUES ('2020-01-01 00:00:00','verified'),('2020-01-02 00:00:00','failed')");
  const rules = { max_rows_per_run: 10, tables: { outcomes2: { column: 'at', keep_days: 30, archive: true } } };
  const r = await pruneAll(db, { rules, now: NOW, archive: (t, rows) => archiveRows(db, t)(rows) });
  assert.equal(r.tables[0].deleted, 2); assert.equal((await head(db)).seq, 2);
  const row = await db.prepare('SELECT kind, data FROM audit_log WHERE seq = 1').first(); assert.equal(row.kind, 'archive:outcomes2'); assert.match(row.data, /verified/);
  db.raw.exec("INSERT INTO outcomes2 (at, result) VALUES ('2020-02-01 00:00:00','x')"); db.raw.exec("DELETE FROM retention_runs");
  const bad = await pruneAll(db, { rules, now: NOW, archive: async () => { throw new Error('boom'); } });
  assert.ok(bad.tables[0].error); assert.equal((await db.prepare('SELECT COUNT(*) n FROM outcomes2').first()).n, 1);
});
