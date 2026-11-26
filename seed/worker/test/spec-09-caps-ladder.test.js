// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-09 requirements that the seed meets in code, named by requirement so the specification can cite them:
// R04 (iteration bounds), R05 and R07 (a spent budget steers and never stops), R15 (the dispatch loop breaker),
// R10 (cost, hit and pass counts per kind and model), US-09 L0 (rules before a model).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeter, SubrequestBudgetError, LOOP_MAX_COST, capsFor } from '../src/subreq.js';
import { decide, governedAI, budgetConfig, allowance, _resetForTests } from '../src/budget.js';
import { loopBreak } from '../src/selfaudit.js';
import { ensureItem } from '../src/tick.js';
import { makeDb } from './d1shim.js';

test('US-09-R04: the subrequest meter refuses a call past its cap minus the reserve, and a loop is held to its share', async () => {
  const m = createMeter({ cap: 10, reserve: 2 });
  assert.equal(m.limit, 8);
  m.scope = { start: m.used, max: 3 };
  assert.deepEqual([m.take(), m.take(), m.take(), m.take()], [true, true, true, false], 'the loop share of 3 stops the fourth call');
  m.scope = null;
  for (let i = 0; i < 5; i++) assert.equal(m.take(), true);
  assert.equal(m.take(), false, 'the invocation limit of 8 stops the ninth');
  assert.equal(m.exhausted(), true);
  const wrapped = m.wrap(async () => 'x');
  await assert.rejects(wrapped(), e => e instanceof SubrequestBudgetError && /subrequest budget/.test(e.message));
  assert.ok(Object.values(LOOP_MAX_COST).every(n => n > 0 && n <= 50), 'every loop share fits the free plan cap');
  const paid = capsFor('paid');
  assert.equal(paid.rotate, false);
  assert.equal(paid.shares.handoffs, LOOP_MAX_COST.handoffs * 5, 'a paid plan raises each share fivefold');
});

test('US-09-R05 US-09-R07: past the day allowance the system crawls to one call an hour and is never frozen', async () => {
  const a = { ai_neurons_day: 1000, variable_usd_month: 10 };
  const crawl = decide(a, { ai_neurons_today: 1000, ai_usd_month_to_date: 0 });
  assert.deepEqual([crawl.mode, crawl.hourly], ['crawl', true]);
  assert.notEqual(crawl.mode, 'frozen');
  assert.equal(decide(a, { ai_neurons_today: 950, ai_usd_month_to_date: 0 }).mode, 'lean');
  assert.equal(decide(a, { ai_neurons_today: 0, ai_usd_month_to_date: 10 }).mode, 'crawl', 'a spent month crawls too');
});

test('US-09-R05: a budget of 0 is held inside the free allocation: a governed handle exists and the allowance has no paid part', async () => {
  _resetForTests();
  const db = makeDb(), calls = [];
  const ai = { async run(model) { calls.push(model); return { response: 'ok', usage: { prompt_tokens: 1000, completion_tokens: 500 } }; } };
  const now = Date.parse('2026-11-26T12:00:00Z');
  const g = await governedAI(db, ai, { config: {}, env: {}, now });
  assert.ok(g, 'the free allocation hands out a governed handle');
  const view = allowance(budgetConfig({}, {}), now);
  assert.ok(view.ai_neurons_day > 0 && view.variable_usd_month === 0);
});

test('US-09-R15: an item dispatched three times with no outcome is blocked and filed as a loop-break item', async () => {
  const db = makeDb();
  await ensureItem(db, { id: 'X-1', owner_role: 'operations', title: 't', done_check: 'd' });
  for (let i = 0; i < 2; i++) db.raw.prepare(`INSERT INTO dispatches (tick_id, role_id, item_id, model) VALUES (?, 'r', 'X-1', 'm')`).run(i);
  assert.deepEqual(await loopBreak(db, { nowIso: '2026-11-26 12:00:00', notes: [] }, 3, ensureItem), [], 'two dispatches: not yet');
  db.raw.prepare(`INSERT INTO dispatches (tick_id, role_id, item_id, model) VALUES (3, 'r', 'X-1', 'm')`).run();
  assert.deepEqual(await loopBreak(db, { nowIso: '2026-11-26 12:00:00', notes: [] }, 3, ensureItem), ['X-1']);
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id='X-1'`).get().status, 'blocked');
  assert.ok(db.raw.prepare(`SELECT 1 AS x FROM items WHERE id='LOOPBREAK-X-1'`).get());
});
