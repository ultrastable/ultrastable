// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { ensureItem } from '../src/tick.js';
import { unknownsStep, pickQuestions, UNKNOWNS_DDL } from '../src/unknowns.js';

const cfg = JSON.parse(readFileSync(new URL('../../../doctrine/unknowns.json', import.meta.url), 'utf8'));
const ctx = d => ({ nowIso: `2026-11-${d} 12:00:00`, notes: [] });

test('files at most max_new_per_run plus items, each with an inverted question', async () => {
  const db = makeDb();
  for (const id of ['A', 'B']) await ensureItem(db, { id, kind: 'work', owner_role: 'operations', title: id, done_check: 'x', closing_probe: 'manual' });
  const r = await unknownsStep(db, ctx('17'), cfg, ensureItem);
  assert.equal(r.filed.length, cfg.max_new_per_run);
  const row = db.raw.prepare(`SELECT kind, title FROM items WHERE id=?`).get(r.filed[0]);
  assert.equal(row.kind, 'plus'); assert.match(row.title, /Question the unknown/);
});

test('a question is not repeated within cadence and returns after it', async () => {
  const db = makeDb();
  await ensureItem(db, { id: 'A', kind: 'work', owner_role: 'operations', title: 'A', done_check: 'x', closing_probe: 'manual' });
  const a = (await unknownsStep(db, ctx('17'), cfg, ensureItem)).filed;
  assert.deepEqual((await unknownsStep(db, ctx('17'), cfg, ensureItem)).filed, [], 'the daily reserve is spent');
  const b = (await unknownsStep(db, ctx('18'), cfg, ensureItem)).filed;
  assert.equal(b.length, cfg.max_new_per_day);
  assert.equal(a.filter(x => b.includes(x)).length, 0);
  const asked = db.raw.prepare('SELECT key, at FROM unknown_questions').all();
  const keys = pickQuestions(cfg, [{ id: 'A', kind: 'default' }], asked, '2026-11-30 00:00:00').map(q => q.key);
  assert.ok(keys.length > 0);
});

test('no doctrine configured files nothing', async () => {
  assert.deepEqual(await unknownsStep(makeDb(), ctx('17'), null, ensureItem), { filed: [] });
});

test('SCHEMA-SELF-1: the DDL the Worker carries equals the migration and the step creates its own table', async () => {
  const norm = x => x.replace(/\s+/g, ' ').trim();
  const mig = readFileSync(new URL('../migrations/0017_unknowns.sql', import.meta.url), 'utf8').split('\n').filter(l => !l.startsWith('--')).join('\n').split(';').map(norm).filter(Boolean);
  assert.deepEqual(mig, UNKNOWNS_DDL.map(norm));
  const db = makeDb(); db.raw.exec('DROP TABLE unknown_questions');
  await ensureItem(db, { id: 'A', kind: 'work', owner_role: 'operations', title: 'A', done_check: 'x', closing_probe: 'manual' });
  assert.equal((await unknownsStep(db, ctx('17'), cfg, ensureItem)).filed.length, cfg.max_new_per_run);
});

test('ORIGINATE-CAP-1: a question the cap refused is not recorded as asked', async () => {
  const db = makeDb();
  await ensureItem(db, { id: 'A', kind: 'work', owner_role: 'operations', title: 'A', done_check: 'x', closing_probe: 'manual' });
  const r = await unknownsStep(db, ctx('17'), cfg, async () => false);
  assert.deepEqual(r.filed, []);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM unknown_questions').get().n, 0);
});

test('the reserve files questions even when the general originate cap is spent', async () => {
  const db = makeDb();
  await ensureItem(db, { id: 'A', kind: 'work', owner_role: 'operations', title: 'A', done_check: 'x', closing_probe: 'manual' });
  db.raw.exec("INSERT INTO budget_ledger (day, kind, units, calls, refused) VALUES ('2026-11-17','originated',0,999,0) ON CONFLICT(day, kind) DO UPDATE SET calls=999");
  const r = await unknownsStep(db, ctx('17'), cfg, (d, item, o) => ensureItem(d, item, { ...o, now: Date.parse('2026-11-17T12:00:00Z') }));
  assert.equal(r.filed.length, cfg.max_new_per_day);
});
