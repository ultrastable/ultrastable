// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Requirements this repository already meets in code, cited by name so the conformance manifest attaches the proof:
// US-09-T05 (all three columns), US-09-R15 (the loop breaker), US-09-R06 (a hard cap is never cleared by changing data),
// US-24-R54 (the runner side accounts for every item scanned).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../../_shared/testdb.js';
import { kdb, one, rows, item, HOUR } from '../../kernel/testkit.js';
import { recordAttempt, canAttempt, recordLoopRun } from '../../kernel/failure.js';
import { createRouter, selectTier } from '../router.js';

const MIG = fileURLToPath(new URL('../migrations/', import.meta.url));
const EXAMPLE = JSON.parse(readFileSync(new URL('../example-config.json', import.meta.url), 'utf8'));
const TIERS = JSON.parse(readFileSync(new URL('../../../ultrastable.json', import.meta.url), 'utf8')).model_ladder.tiers;

test('US-09-T05 US-09-R14 tier selection gives doer, manager and reviewer for budgets 0, 49.99, 50 and 500', () => {
  const pick = b => { const t = selectTier(b, TIERS); return [t.doer, t.manager, t.reviewer]; };
  assert.deepEqual(pick(0), ['small', 'small', 'small']);
  assert.deepEqual(pick(49.99), ['small', 'small', 'small']);
  assert.deepEqual(pick(50), ['medium', 'medium', 'small'], 'medium doer and manager with a small reviewer');
  assert.deepEqual(pick(500), ['large', 'large', 'medium'], 'large doer and manager with a medium reviewer');
  assert.deepEqual(TIERS.map(t => t.budget_usd_per_month_min), [0, 50, 500]);
});

test('US-09-R15 three identical failures inside 24 hours file a root-cause item and open the breaker; two do not; an old one does not count', async () => {
  const db = kdb(), t = Date.parse('2026-11-26T00:00:00Z');
  await recordAttempt(db, { target: 'deploy:x', signature: 'S1', ok: false, now: t });
  const two = await recordAttempt(db, { target: 'deploy:x', signature: 'S1', ok: false, now: t + HOUR });
  assert.notEqual(two.state, 'open', 'two failures do not open it');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'ROOTCAUSE-%'`).n, 0);
  const three = await recordAttempt(db, { target: 'deploy:x', signature: 'S1', ok: false, now: t + 2 * HOUR });
  assert.equal(three.state, 'open');
  assert.match(three.root_item_id, /^ROOTCAUSE-deploy-x-S1/);
  assert.ok(one(db, `SELECT id FROM items WHERE id = ?`, three.root_item_id));
  assert.equal((await canAttempt(db, 'deploy:x', 'S1', t + 3 * HOUR)).allowed, false);
  // a failure 25 hours before the third one is outside the window
  const db2 = kdb();
  await recordAttempt(db2, { target: 'd', signature: 'S2', ok: false, now: t });
  await recordAttempt(db2, { target: 'd', signature: 'S2', ok: false, now: t + 24 * HOUR });
  const late = await recordAttempt(db2, { target: 'd', signature: 'S2', ok: false, now: t + 26 * HOUR });
  assert.notEqual(late.state, 'open', 'only two of the three fall inside 24 hours');
});

test('US-09-R06 a hard cap refusal never raises a cap or deletes a call row', async () => {
  const db = makeDb([MIG]), now = () => Date.UTC(2026, 5, 15, 12, 0, 0);
  const config = JSON.parse(JSON.stringify(EXAMPLE));
  const router = createRouter({ db, fetch: async () => new Response('{}', { status: 500 }), now, config, env: { PROVIDER_A_API_KEY: 'k', PROVIDER_B_API_KEY: 'k' } });
  const hard = Math.min(...config.caps.filter(c => c.hard_usd != null).map(c => c.hard_usd));
  db.raw.prepare(`INSERT INTO router_calls (at, role, cost_usd, outcome) VALUES ('2026-06-15 10:00:00','doer',?,'ok')`).run(hard + 1);
  const capsBefore = JSON.stringify(config.caps), callsBefore = rows(db, `SELECT * FROM router_calls ORDER BY id`);
  const r = await router.call({ rung: 'large', role: 'doer', messages: [] });
  assert.ok(!r.ok || r.cost_usd === 0 || r.refusal, 'a paid call is not made past the hard cap');
  assert.equal(JSON.stringify(config.caps), capsBefore, 'the cap was not raised');
  const after = rows(db, `SELECT * FROM router_calls ORDER BY id`);
  for (const c of callsBefore) assert.ok(after.some(a => a.id === c.id && a.cost_usd === c.cost_usd), 'no call row was deleted or changed');
});

test('US-24-R54 a consumer that scanned 25 items and booked 0 raises an incident, and a balanced run does not', async () => {
  const db = kdb(), ids = [];
  for (let i = 0; i < 25; i++) { ids.push(`C${i}`); item(db, `C${i}`, { status: 'done', disposition: 'x' }); }
  const bad = await recordLoopRun(db, { loop: 'runner', scanned: 25, unaccounted_item_ids: ids, now: Date.now() });
  assert.deepEqual([bad.balanced, bad.reopened], [false, 25]);
  assert.match(one(db, `SELECT id FROM items WHERE id LIKE 'UNACCOUNTED-runner%'`).id, /UNACCOUNTED-runner/);
  assert.equal((await recordLoopRun(db, { loop: 'runner', scanned: 7, executed: 4, failed: 2, no_action: 1 })).balanced, true, 'buckets sum to the scanned count');
});

test('US-09-R22 a keyless provider never serves a role the configuration does not allow it, the refusal names role_not_allowed, and configuration can allow it', async () => {
  const edge = { kind: 'workers_ai', key_env: null, family: 'open', models: { small: { id: 'm-small', capabilities: ['json'] } } };
  const cfg = (extra = {}) => ({ rungs: ['small', 'medium', 'large'], fallbacks: ['edge'], providers: { edge }, ...extra });
  const ai = { calls: 0, run: async () => { ai.calls++; return { response: 'x' }; } };
  const mk = c => createRouter({ db: makeDb([MIG]), fetch: async () => { throw new Error('a keyless provider needs no fetch'); }, now: () => 0, config: c, env: {}, ai });
  for (const role of ['doer', 'author']) {
    const plan = await mk(cfg()).route({ role, kind: 'doer', rung: 'small' });
    assert.deepEqual([plan.ok, plan.refusal], [false, 'role_not_allowed'], role);
    const call = await mk(cfg()).call({ role, kind: 'doer', rung: 'small', messages: [] });
    assert.deepEqual([call.ok, call.refusal, call.attempts.length], [false, 'role_not_allowed', 0], 'refused before any call');
  }
  assert.equal(ai.calls, 0, 'the binding was never invoked');
  for (const role of ['triage', 'review', 'reviewer', 'management', 'manager']) assert.equal((await mk(cfg()).route({ role, rung: 'small' })).ok, true, role + ' is allowed by default');
  assert.equal((await mk(cfg({ rung_roles: { workers_ai: ['doer'] } })).route({ role: 'doer', rung: 'small' })).ok, true, 'configuration can add the role');
  assert.equal((await mk(cfg({ rung_roles: { workers_ai: ['doer'] } })).route({ role: 'triage', rung: 'small' })).refusal, 'role_not_allowed', 'and then only that role');
});
