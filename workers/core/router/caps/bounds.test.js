// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-09-R04 (one bound over steps, tokens, wall-clock time and spend), R05 (the overage is a priority-0 item) and R07 (a bound
// never ends a task that has a free rung under a spend cap).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../../_shared/testdb.js';
import { createRouter } from '../router.js';
import { createBounds } from './bounds.js';

const MIG = fileURLToPath(new URL('../migrations/', import.meta.url));
const EXAMPLE = JSON.parse(readFileSync(new URL('../example-config.json', import.meta.url), 'utf8'));
const KEYS = { PROVIDER_A_API_KEY: 'k-a', PROVIDER_B_API_KEY: 'k-b' };
const T0 = Date.UTC(2026, 5, 15, 12, 0, 0);

function mk(config = EXAMPLE, usage = { prompt_tokens: 100, completion_tokens: 50 }) {
  const db = makeDb([MIG]), clock = { t: T0 }, sent = [];
  const fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage }), { status: 200 }); };
  return { db, clock, sent, router: createRouter({ db, fetch, now: () => clock.t, config, env: KEYS }) };
}
const rec = [];
const lastCall = db => db.raw.prepare(`SELECT * FROM router_calls ORDER BY id DESC LIMIT 1`).get();

test('US-09-R04: an iteration is refused when its step bound is spent', async () => {
  const { router, db, sent, clock } = mk();
  const b = createBounds({ steps: 2 }, { now: () => clock.t });
  assert.equal((await router.call({ rung: 'small', bounds: b, messages: [] })).ok, true);
  assert.equal((await router.call({ rung: 'small', bounds: b, messages: [] })).ok, true);
  const r = await router.call({ rung: 'small', bounds: b, messages: [] });
  assert.deepEqual([r.ok, r.refusal, r.exceeded], [false, 'bound_exceeded', 'steps']);
  assert.equal(sent.length, 2, 'no provider was called for the refused step');
  assert.deepEqual([lastCall(db).outcome, lastCall(db).error], ['refused', 'bound_exceeded:steps']);
});

test('US-09-R04: an iteration is refused when its token bound is spent and max_tokens is clamped to what remains', async () => {
  const { router, sent, clock } = mk();
  const b = createBounds({ tokens: 400 }, { now: () => clock.t });
  await router.call({ rung: 'small', bounds: b, max_tokens: 4000, messages: [] });
  assert.equal(sent[0].max_tokens, 400, 'clamped to the whole bound');
  assert.equal(b.check().remaining.tokens, 250, '150 tokens were used');
  await router.call({ rung: 'small', bounds: b, max_tokens: 4000, messages: [] });
  assert.equal(sent[1].max_tokens, 250);
  await router.call({ rung: 'small', bounds: b, max_tokens: 4000, messages: [] });
  const r = await router.call({ rung: 'small', bounds: b, messages: [] });
  assert.deepEqual([r.refusal, r.exceeded], ['bound_exceeded', 'tokens']);
});

test('US-09-R04: config.max_tokens_per_call caps every call', async () => {
  const { router, sent } = mk({ ...EXAMPLE, max_tokens_per_call: 64 });
  await router.call({ rung: 'small', max_tokens: 5000, messages: [] });
  assert.equal(sent[0].max_tokens, 64);
});

test('US-09-R04: an iteration past its wall-clock bound is refused before a provider call (injected clock)', async () => {
  const { router, sent, clock } = mk();
  const b = createBounds({ wall_ms: 30000 }, { now: () => clock.t });
  assert.equal((await router.call({ rung: 'small', bounds: b, messages: [] })).ok, true);
  clock.t += 31000;
  const r = await router.call({ rung: 'small', bounds: b, messages: [] });
  assert.deepEqual([r.refusal, r.exceeded, sent.length], ['bound_exceeded', 'wall', 1]);
  const d = await router.call({ rung: 'small', deadline_ms: clock.t - 1, messages: [] });
  assert.deepEqual([d.refusal, d.exceeded], ['bound_exceeded', 'wall'], 'an absolute deadline in the past is the same refusal');
});

test('US-09-R04: an iteration past its spend bound is refused, and the exceeded bound is recorded once', async () => {
  const { router, clock } = mk(EXAMPLE, { prompt_tokens: 1000, completion_tokens: 1000 });
  const rows = [];
  const b = createBounds({ usd: 0.001 }, { now: () => clock.t, record: r => rows.push(r) });
  assert.equal((await router.call({ rung: 'small', bounds: b, messages: [] })).ok, true); // 0.0002 + 0.0008 = 0.001
  const r = await router.call({ rung: 'small', bounds: b, messages: [] });
  assert.deepEqual([r.refusal, r.exceeded], ['bound_exceeded', 'spend']);
  b.check(); b.check();
  assert.equal(rows.length, 1);
  assert.match(rows[0].what, /spend/);
});

test('US-09-R04: a bound is a number, at least one is required, and an unknown key is refused', () => {
  assert.throws(() => createBounds({}), /at least one bound/);
  assert.throws(() => createBounds({ minutes: 3 }), /not a bound/);
  assert.throws(() => createBounds({ steps: -1 }), /negative/);
});

test('US-09-R05: at a hard cap the router files one priority-0 SPEND item and no paid call, and closes it when spend falls below the cap', async () => {
  const { router, db, clock, sent } = mk({ ...EXAMPLE, caps: [EXAMPLE.caps[1]] }); // doer, per day, hard 3
  db.raw.prepare(`INSERT INTO router_calls (at, role, cost_usd, outcome) VALUES ('2026-06-15 10:00:00','doer',3.5,'ok')`).run();
  const r = await router.call({ rung: 'small', role: 'doer', messages: [] });
  assert.equal(r.refusal, 'hard_cap');
  await router.route({ rung: 'small', role: 'doer' });
  const items = db.raw.prepare(`SELECT * FROM items WHERE id LIKE 'SPEND-%'`).all();
  assert.equal(items.length, 1, 'one item however often the route is asked');
  assert.deepEqual([items[0].id, items[0].priority, items[0].status], ['SPEND-role:doer:day', 0, 'open']);
  assert.ok(items[0].closing_probe && items[0].done_check);
  assert.equal(sent.length, 0);
  clock.t += 24 * 3600000; // the next day: the per-day cap has reset
  const again = await router.route({ rung: 'small', role: 'doer' });
  assert.equal(again.ok, true);
  const closed = db.raw.prepare(`SELECT status, disposition FROM items WHERE id='SPEND-role:doer:day'`).get();
  assert.equal(closed.status, 'done');
  assert.match(closed.disposition, /below the hard cap/);
});

test('US-09-R07: bounds never end a task that has a free rung under a spend cap', async () => {
  const a = EXAMPLE.providers['provider-a'];
  const free = { id: 'a-free', capabilities: ['json'], usd_per_1k_in: 0, usd_per_1k_out: 0 };
  const config = { ...EXAMPLE, providers: { ...EXAMPLE.providers, 'provider-a': { ...a, models: { ...a.models, small: free } } } };
  const { router, db, clock } = mk(config);
  db.raw.prepare(`INSERT INTO router_calls (at, role, cost_usd, outcome) VALUES ('2026-06-15 10:00:00','doer',99,'ok')`).run();
  const b = createBounds({ steps: 5, tokens: 10000 }, { now: () => clock.t });
  const r = await router.call({ rung: 'large', role: 'doer', bounds: b, messages: [] });
  assert.deepEqual([r.ok, r.model], [true, 'a-free']);
});
