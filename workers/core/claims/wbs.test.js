// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { parseWbs, formatWbs, wbsParent, attachWbs, wbsRollup, linkParentsByWbs } from './wbs.js';

const mig = fileURLToPath(new URL('./migrations/', import.meta.url));
const mk = () => ({ ctx: { db: makeDb([mig]), now: () => Date.parse('2026-03-02T12:00:00Z'), config: {} } });
const item = (ctx, id, status = 'open') => ctx.db.prepare(`INSERT INTO items (id,title,owner_role,done_check,status) VALUES (?,?,?,?,?)`).bind(id, id, 'staff', 'x', status).run();

test('US-08-R26: parseWbs accepts 4 and 5 segment codes and rejects 3, 6, empty segments and spaces', () => {
  assert.deepEqual(parseWbs('p1.prog.proj.phase'), { portfolio: 'p1', program: 'prog', project: 'proj', phase: 'phase', task: null, parts: ['p1', 'prog', 'proj', 'phase'] });
  assert.equal(parseWbs('a.b.c.d.e').task, 'e');
  for (const bad of ['a.b.c', 'a.b.c.d.e.f', 'a..c.d', 'a.b.c. d', '', null, 'a.b.c.d!']) assert.equal(parseWbs(bad), null, String(bad));
  assert.equal(formatWbs({ portfolio: 'a', program: 'b', project: 'c', phase: 'd' }), 'a.b.c.d');
  assert.throws(() => formatWbs({ portfolio: 'a', program: 'b' }), /portfolio, program/);
});

test('US-08-R26: wbsParent drops one level and stops at portfolio.program', () => {
  assert.equal(wbsParent('a.b.c.d.e'), 'a.b.c.d');
  assert.equal(wbsParent('a.b.c.d'), 'a.b.c');
  assert.equal(wbsParent('a.b.c'), 'a.b');
  assert.equal(wbsParent('a.b'), null);
});

test('US-08-R26: wbsRollup counts items by status under a prefix', async () => {
  const { ctx } = mk();
  for (const [id, st, code] of [['i1', 'done', 'p.g.j.ph1'], ['i2', 'open', 'p.g.j.ph1.t1'], ['i3', 'ready', 'p.g.j.ph2'], ['i4', 'open', 'p.g.jx.ph1'], ['i5', 'open', 'q.g.j.ph1']]) {
    await item(ctx, id, st); await attachWbs(ctx, id, code);
  }
  assert.deepEqual(await wbsRollup(ctx, 'p.g.j'), { prefix: 'p.g.j', total: 3, by_status: { done: 1, open: 1, ready: 1 } });   // p.g.jx is another project
  assert.deepEqual((await wbsRollup(ctx, 'p.g.j.ph1')).by_status, { done: 1, open: 1 });
  assert.equal((await wbsRollup(ctx, 'nothing')).total, 0);
});

test('US-08-R26: attaching the same code twice to one item is idempotent, an invalid code or unknown item is refused', async () => {
  const { ctx } = mk();
  await item(ctx, 'i1');
  await attachWbs(ctx, 'i1', 'a.b.c.d'); await attachWbs(ctx, 'i1', 'a.b.c.d');
  assert.equal((await ctx.db.prepare(`SELECT COUNT(*) AS n FROM claims_wbs`).bind().first()).n, 1);
  await attachWbs(ctx, 'i1', 'a.b.c.e');
  assert.equal((await ctx.db.prepare(`SELECT code FROM claims_wbs`).bind().first()).code, 'a.b.c.e');
  await assert.rejects(() => attachWbs(ctx, 'i1', 'a.b'), /not a WBS code/);
  await assert.rejects(() => attachWbs(ctx, 'nope', 'a.b.c.d'), /no such item/);
});

test('US-08-R26: linkParentsByWbs links an item to the item one level above and leaves a right link alone', async () => {
  const { ctx } = mk();
  for (const [id, code] of [['phase', 'a.b.c.d'], ['task', 'a.b.c.d.e'], ['lonely', 'x.y.z.w']]) { await item(ctx, id); await attachWbs(ctx, id, code); }
  assert.deepEqual((await linkParentsByWbs(ctx)).linked, [['task', 'phase']]);
  assert.deepEqual((await linkParentsByWbs(ctx)).linked, []);
});
