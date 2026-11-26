// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from '../_shared/testdb.js';
import { runTick } from '../src/tick.js';
import { MIGRATIONS_DIR, registerProduct, recordReading, runCycle, shipPlus, decidePlus, plusStep, createPlusProposer, parseReply, planProblem } from './index.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-09T12:00:00Z'), HOUR = 3600e3, DAY = 24 * HOUR;
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const reply = (o = {}) => JSON.stringify({ title: 'Add a today summary', prediction: { metric: 'requests_per_day', direction: 'up', size: 0.1 }, guard: 'error_page_rate', angle: 'summary on the home page',
  additive: true, changes: 1, doer: 'staff: site/home.js', revert_path: 'remove the summary block', done_check: 'the summary renders', evidence: 'usage flat for 3 weeks', ...o });
async function setup(names = ['desk']) {
  const db = makeDb([MIGRATIONS_DIR]);
  for (const n of names) {
    await registerProduct(db, { product: n, program: 'REACH', usage_metric: 'requests_per_day', quality_measure: 'error_page_rate', now: NOW - 30 * DAY });
    await recordReading(db, { product: n, measure: 'requests_per_day', value: 1240, now: NOW }); await recordReading(db, { product: n, measure: 'error_page_rate', value: 0.8, now: NOW });
  }
  return db;
}

test('US-04-R19, US-04-R06: a proposer reply with a stated prediction, guard, angle, doer and revert path is filed as a plus, before the change is made', async () => {
  const db = await setup(); const calls = [];
  const propose = createPlusProposer({ complete: async (r) => { calls.push(r); return { text: '```json\n' + reply() + '\n```' }; } });
  const out = await runCycle(db, { now: NOW, propose });
  assert.deepEqual([out[0].kind, out[0].issue_id], ['plus', 'PLUS-desk-1']); assert.match(out[0].predicted_outcome, /^requests_per_day up 10% within 168 h$/);
  const l = one(db, `SELECT status, metric, guard, angle, doer, revert_path FROM plus_ledger WHERE id = 1`);
  assert.deepEqual({ ...l }, { status: 'filed', metric: 'requests_per_day', guard: 'error_page_rate', angle: 'summary on the home page', doer: 'staff: site/home.js', revert_path: 'remove the summary block' });
  assert.equal(calls.length, 1); assert.deepEqual([calls[0].role, calls[0].kind], ['manager', 'plus']);
  assert.match(calls[0].messages[1].content, /Evidence: \{"product":"desk"/); assert.match(one(db, `SELECT done_check FROM items WHERE id = 'PLUS-desk-1'`).done_check, /the summary renders/);
});

test('US-04-R10, US-04-R19: a reply that repeats the angle that missed is refused and the writing falls back to a work item', async () => {
  const db = await setup();
  await db.prepare(`UPDATE plus_product_registry SET misses_in_row = 1`).bind().run();
  await db.prepare(`INSERT INTO plus_ledger (product, kind, title, angle, status, created_at) VALUES ('desk', 'plus', 'old', 'Summary on the home page!', 'reverted', '2026-11-01 00:00:00')`).bind().run();
  const propose = createPlusProposer({ complete: async () => reply() , maxRetries: 0 });
  const out = await runCycle(db, { now: NOW, propose });
  assert.match(out[0].refused, /repeats the one that missed/); assert.equal(out[0].filed, 'PLUSWRITE-desk-20261109');
  assert.match(one(db, `SELECT title FROM items WHERE id = 'PLUSWRITE-desk-20261109'`).title, /last attempt refused: the proposer's reply was refused: the angle repeats/);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM plus_ledger WHERE status = 'filed'`).n, 0);
});

test('US-04-R08, US-04-R19: a reply whose guard equals its outcome measure, or names an unmeasured measure, is refused', async () => {
  const ev = { product: 'desk', usage: { measure: 'requests_per_day', value: 1240 }, guard: { measure: 'error_page_rate', value: 0.8 }, avoid_angle: null };
  assert.match(planProblem(JSON.parse(reply({ guard: 'requests_per_day' })), { kind: 'plus', evidence: ev }), /guard measure must differ/);
  assert.match(planProblem(JSON.parse(reply({ prediction: { metric: 'conversions', direction: 'up', size: 0.1 } })), { kind: 'plus', evidence: ev }), /must be a measure with a fresh reading: requests_per_day, error_page_rate/);
  assert.match(planProblem(JSON.parse(reply()), { kind: 'plus', evidence: { ...ev, usage: { measure: 'requests_per_day', value: null } } }), /must be a measure with a fresh reading: error_page_rate/);
  assert.match(planProblem(JSON.parse(reply({ prediction: { metric: 'requests_per_day', direction: 'up', size: 10 } })), { kind: 'plus', evidence: ev }), /fraction/);
  assert.equal(planProblem(JSON.parse(reply()), { kind: 'plus', evidence: ev }), null);
});

test('US-04-R06, US-04-R19: a plus must be additive and a single change; a simplify cycle may remove', async () => {
  const ev = { product: 'desk', usage: { measure: 'requests_per_day', value: 1 }, guard: { measure: 'error_page_rate', value: 1 } };
  assert.match(planProblem(JSON.parse(reply({ additive: false })), { kind: 'plus', evidence: ev }), /additive/);
  assert.match(planProblem(JSON.parse(reply({ changes: 3 })), { kind: 'plus', evidence: ev }), /single change/);
  assert.equal(planProblem(JSON.parse(reply({ additive: false, changes: 3 })), { kind: 'simplify', evidence: ev }), null);
  for (const [k, re] of [['doer', /doer/], ['revert_path', /revert_path/], ['angle', /angle/], ['title', /title/]]) assert.match(planProblem(JSON.parse(reply({ [k]: '' })), { kind: 'plus', evidence: ev }), re);
  assert.deepEqual(Object.keys(parseReply('no object here')), ['error']); assert.match(parseReply('{ nope }').error, /not valid JSON/); assert.match(parseReply('[1]').error, /holds no JSON object|not a JSON object/);
});

test('US-04-R19: one retry carries the refusal back to the model and the corrected reply is filed', async () => {
  const db = await setup(); const calls = [];
  const propose = createPlusProposer({ complete: async (r) => { calls.push(r); return calls.length === 1 ? { text: reply({ doer: '' }) } : reply(); } });
  const out = await runCycle(db, { now: NOW, propose });
  assert.equal(out[0].issue_id, 'PLUS-desk-1'); assert.equal(calls.length, 2);
  assert.match(calls[1].messages.at(-1).content, /Your last reply was refused: doer is missing/);
  assert.throws(() => createPlusProposer({}), /complete port/);
});

test('US-04-R19: a model failure files the PLUSWRITE item and does not error the tick; the daily cap stops calls', async () => {
  const db = await setup(['desk', 'blog']);
  const down = createPlusProposer({ complete: async () => { throw new Error('model unavailable'); } });
  const r = await runTick(db, { config: { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy }, now: NOW, extraSteps: [plusStep({ propose: down })] });
  assert.deepEqual(r.errors, []);
  assert.match(one(db, `SELECT title FROM items WHERE id = 'PLUSWRITE-desk-20261109'`).title, /model unavailable/);
  assert.equal((await createPlusProposer({ complete: async () => ({ ok: false, error: 'no key' }) })({ product: 'desk', kind: 'plus', evidence: { usage: {}, guard: {} } }).catch(e => e.message)), 'the model could not be called: no key');
  // the cap: one plus a day for two due products asks the model once
  const db2 = await setup(['a', 'b']); let calls = 0;
  const ok = createPlusProposer({ complete: async () => { calls++; return reply(); } });
  const out = await runCycle(db2, { now: NOW, config: { daily_cap: 1 }, propose: ok });
  assert.equal(calls, 1); assert.deepEqual(out.map(x => x.issue_id ? 'filed' : 'capped'), ['filed', 'capped']);
  // and the filed plus travels on: shipped, then decided after its window
  await shipPlus(db2, 1, { evidence: 'deploy probed', now: NOW });
  await recordReading(db2, { product: 'a', measure: 'requests_per_day', value: 1400, now: NOW + 7 * DAY }); await recordReading(db2, { product: 'a', measure: 'error_page_rate', value: 0.7, now: NOW + 7 * DAY });
  assert.equal((await decidePlus(db2, 1, { now: NOW + 7 * DAY })).status, 'kept');
});
