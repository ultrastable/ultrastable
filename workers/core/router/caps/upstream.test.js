// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Router additions of US-SPEC-09: the ladder matrix through a port (R08), a retired model (410) heals to its successor, the resolved
// upstream is recorded per call and a guard whose target is dearer is refused (US-24-R53).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../../_shared/testdb.js';
import { createRouter } from '../router.js';
import { guardAllowed, costChangeProbe, mismatches, unitCost } from './upstream.js';

const MIG = fileURLToPath(new URL('../migrations/', import.meta.url));
const EXAMPLE = JSON.parse(readFileSync(new URL('../example-config.json', import.meta.url), 'utf8'));
const KEYS = { PROVIDER_A_API_KEY: 'k-a', PROVIDER_B_API_KEY: 'k-b' };
const T0 = Date.UTC(2026, 10, 26, 12, 0, 0), DAY = 86400000;

function mk({ handler, matrix, config = EXAMPLE } = {}) {
  const db = makeDb([MIG]), clock = { t: T0 }, sent = [];
  const fetch = async (url, init) => {
    const isA = url.includes('provider-a'); sent.push({ isA, model: JSON.parse(init.body).model });
    const r = handler ? handler(isA, JSON.parse(init.body)) : null;
    if (r) return r;
    const body = isA ? { model: JSON.parse(init.body).model, choices: [{ message: { content: 'a' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }
      : { model: JSON.parse(init.body).model, content: [{ type: 'text', text: 'b' }], usage: { input_tokens: 10, output_tokens: 5 } };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { db, clock, sent, router: createRouter({ db, fetch, now: () => clock.t, config, env: KEYS, matrix }) };
}

test('US-09-R08: with a matrix port the router offers only models admitted and canary-passing for the class', async () => {
  const { router } = mk({ matrix: async ({ task_class }) => (task_class === 'triage' ? [{ model: 'b-small' }] : []) });
  const p = await router.route({ rung: 'small', task_class: 'triage' });
  assert.deepEqual([p.ok, p.matrix, p.candidates.map(c => c.model)], [true, 'applied', ['b-small']]);
  const open = await router.route({ rung: 'small', task_class: 'unadmitted' });
  assert.deepEqual([open.matrix, open.candidates.length], ['none', 2], 'an empty matrix falls back to configured capabilities and the plan says so');
  assert.equal((await router.route({ rung: 'small' })).matrix, 'none', 'no task class, no matrix');
  const refused = await mk({ matrix: async () => [{ model: 'nothing-configured' }] }).router.route({ rung: 'small', task_class: 'x' });
  assert.deepEqual([refused.ok, refused.refusal], [false, 'no_capable_provider'], 'an admitted model nobody configured is not routable');
});

test('a 410 retires the model for 7 days, costs nothing and the next candidate serves; the successor is the next rung of the provider', async () => {
  const { router, db, clock, sent } = mk({ handler: (isA, body) => (isA && body.model === 'a-small' ? new Response('model a-small is deprecated', { status: 410 }) : null) });
  const r = await router.call({ rung: 'small', messages: [] });
  assert.deepEqual([r.ok, r.provider, r.attempts.length], [true, 'provider-b', 1]);
  assert.equal(r.attempts[0].retired, 'a-small');
  assert.equal(db.raw.prepare(`SELECT cost_usd FROM router_calls WHERE outcome='error'`).get().cost_usd, 0);
  assert.equal(db.raw.prepare(`SELECT is_on FROM router_switches WHERE name='model:a-small'`).get().is_on, 1);
  const before = sent.length;
  const plan = await router.route({ rung: 'small' });
  assert.deepEqual(plan.candidates.map(c => [c.provider, c.model, c.successor_of ?? null]), [['provider-a', 'a-medium', 'a-small'], ['provider-b', 'b-small', null]]);
  assert.equal(sent.length, before, 'routing alone calls nothing');
  clock.t += 8 * DAY;
  assert.equal((await router.route({ rung: 'small' })).candidates[0].model, 'a-small', 'the retirement lapses after 7 days and the model is probed again');
});

test('the resolved upstream is stored per call and a mismatch with the configured id is listed', async () => {
  const { router, db } = mk({ handler: (isA, body) => (isA ? new Response(JSON.stringify({ model: body.model + '-2026-11-01', choices: [{ message: { content: 'a' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 }) : null) });
  await router.call({ rung: 'small', messages: [] });
  const row = db.raw.prepare(`SELECT requested, resolved, provider FROM router_upstream`).get();
  assert.deepEqual({ ...row }, { requested: 'a-small', resolved: 'a-small-2026-11-01', provider: 'provider-a' });
  assert.deepEqual((await mismatches(db)).map(m => [m.requested, m.resolved]), [['a-small', 'a-small-2026-11-01']]);
  const { router: r2, db: d2 } = mk();
  await r2.call({ rung: 'small', messages: [] });
  assert.deepEqual(await mismatches(d2), [], 'an exact match is not a mismatch');
});

test('US-24-R53: a guard whose resolved target is dearer than the status quo is refused; one never probed is refused too', async () => {
  const { db, router } = mk({ handler: (isA, body) => (isA ? new Response(JSON.stringify({ model: body.model === 'a-small' ? 'a-large' : body.model, choices: [{ message: { content: 'a' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 }) : null) });
  assert.equal((await guardAllowed({ db, config: EXAMPLE, guard: { model: 'a-small' }, status_quo: { model: 'a-medium' } })).reason, 'resolved_upstream_unprobed');
  await router.call({ rung: 'small', messages: [] });   // a-small is served by a-large: the alias hides a dearer model
  await router.call({ rung: 'medium', messages: [] });  // a-medium is served by itself
  const bad = await guardAllowed({ db, config: EXAMPLE, guard: { model: 'a-small' }, status_quo: { model: 'a-medium' } });
  assert.deepEqual([bad.ok, bad.reason, bad.guard.resolved], [false, 'target_dearer_than_status_quo', 'a-large']);
  assert.ok(bad.guard.unit_cost > bad.status_quo.unit_cost);
  const probe = await costChangeProbe({ db, now: () => T0, config: EXAMPLE, change: { name: 'route triage to the small rung', model: 'a-small', status_quo: 'a-medium' } });
  assert.equal(probe.kept, false);
  assert.deepEqual({ ...db.raw.prepare(`SELECT change_name, kept, reason FROM router_cost_probes`).get() }, { change_name: 'route triage to the small rung', kept: 0, reason: 'target_dearer_than_status_quo' });
  assert.equal((await guardAllowed({ db, config: EXAMPLE, guard: { model: 'a-medium' }, status_quo: { model: 'a-medium' } })).ok, true);
  assert.equal(unitCost(EXAMPLE, 'no-such-model'), null);
});
