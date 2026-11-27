// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from '../_shared/testdb.js';
import { createRouter, ensure, RETIRE_MS } from './index.js';

const NOW = Date.UTC(2026, 10, 17, 12);
const free = (id, over = {}) => ({ id, model: id, tier: 'free', ...over });
const setup = (replies, config = {}, extra = []) => {
  const db = makeDb(), calls = [];
  const ai = { run: async (model) => { calls.push(model); const r = replies[model]; if (r instanceof Error) throw r; return { response: r }; } };
  return { db, calls, r: createRouter({ db, ai, models: [free('cheap'), free('mid', { neurons_out: 0.5 }), ...extra], now: () => NOW, config }) };
};

test('caches and dedupes: the second identical call and a concurrent one cost no model call', async () => {
  const { r, calls } = setup({ cheap: 'a fine answer', mid: 'x' });
  const [a, b] = await Promise.all([r.call({ kind: 'k', prompt: 'p' }), r.call({ kind: 'k', prompt: 'p' })]);
  assert.equal(a.text, 'a fine answer'); assert.equal(b.text, 'a fine answer');
  assert.equal((await r.call({ kind: 'k', prompt: 'p' })).cached, true);
  assert.equal(calls.length, 1);
});
test('a free reply that fails the gate escalates to the next free model, not to paid', async () => {
  const { r, calls } = setup({ cheap: '', mid: 'good' }, {}, [{ id: 'big', model: 'big', tier: 'paid', usd_out_per_m: 15, run: async () => { throw new Error('must not run'); } }]);
  const x = await r.call({ prompt: 'q' });
  assert.deepEqual([x.model, x.escalated, x.usd], ['mid', true, 0]); assert.deepEqual(calls, ['cheap', 'mid']);
});
test('paid never runs at cap 0; runs once free fails and a cap allows it; refuses past the cap', async () => {
  let paidCalls = 0;
  const paid = { id: 'big', model: 'big', tier: 'paid', usd_in_per_m: 3, usd_out_per_m: 15, run: async () => { paidCalls++; return { response: 'paid answer', usage: { prompt_tokens: 100, completion_tokens: 100 } }; } };
  const a = setup({ cheap: '', mid: '' }, { monthly_usd_cap: 0 }, [paid]);
  await assert.rejects(a.r.call({ prompt: 'q' }), /monthly cap/); assert.equal(paidCalls, 0);
  const b = setup({ cheap: '', mid: '' }, { monthly_usd_cap: 0.01 }, [paid]);
  const x = await b.r.call({ prompt: 'one', maxTokens: 100 }); assert.equal(x.model, 'big'); assert.ok(x.usd > 0);
  await assert.rejects(b.r.call({ prompt: 'two', maxTokens: 800 }), /monthly cap/); assert.equal(paidCalls, 1);
  assert.ok((await b.r.report()).month_usd <= 0.01);
});
test('learns: a free model that keeps failing a kind is dropped from that kind', async () => {
  const { r, calls } = setup({ cheap: '', mid: 'ok' });
  for (let i = 0; i < 8; i++) await r.call({ kind: 'k', prompt: 'p' + i });
  calls.length = 0; await r.call({ kind: 'k', prompt: 'new' });
  assert.deepEqual(calls, ['mid']);
});
test('the task verify() is part of the gate, and the daily free-neuron cap stops free calls', async () => {
  const { r } = setup({ cheap: 'not json', mid: '{"a":1}' });
  const x = await r.call({ prompt: 'j', verify: t => { try { JSON.parse(t); return true; } catch { return 'not json'; } } });
  assert.equal(x.model, 'mid');
  const c = setup({ cheap: 'hello there' }, { neurons_day_cap: 0 });
  await assert.rejects(c.r.call({ prompt: 'z' }), /daily free neurons/);
});

test('US-09-R21 US-09-T11: a deprecated model is retired after one refusal and charged nothing, the next model answers, and it is probed again after the window', async () => {
  const db = makeDb(); await ensure(db);
  let t = NOW; const seen = [];
  const ai = { run: async model => { seen.push(model); if (model === 'gone') throw new Error('5028: gone was deprecated on 2026-11-20. See the model catalog.'); return { response: 'answer' }; } };
  const r = createRouter({ db, ai, now: () => t, models: [free('gone', { neurons_out: 0.01 }), free('live')] });
  assert.equal((await r.call({ kind: 'k', prompt: 'one '.repeat(400), cache: false })).model, 'live');
  const row = db.raw.prepare(`SELECT neurons, ok FROM airouter_calls WHERE model='gone'`).get();
  assert.deepEqual([row.neurons, row.ok], [0, 0], 'no model ran, so nothing is charged');
  assert.ok(db.raw.prepare(`SELECT 1 AS x FROM airouter_retired WHERE model='gone'`).get());
  seen.length = 0; await r.call({ kind: 'k', prompt: 'two', cache: false });
  assert.deepEqual(seen, ['live'], 'the retired model is not called inside the window');
  t += RETIRE_MS + 1000; seen.length = 0; await r.call({ kind: 'k', prompt: 'three', cache: false });
  assert.equal(seen[0], 'gone', 'after the window it is probed again');
  assert.equal(RETIRE_MS, 7 * 864e5);
});

test('US-09-R21: a governor refusal is charged nothing; a model that answered badly still is', async () => {
  const db = makeDb(); await ensure(db);
  const ai = { run: async model => { if (model === 'refused') throw new Error('AI budget: lean mode allows one model call per tick'); return { response: '' }; } };
  const r = createRouter({ db, ai, now: () => NOW, models: [free('refused'), free('empty')] });
  await assert.rejects(() => r.call({ kind: 'k', prompt: 'p '.repeat(500), cache: false }), /no model passed/);
  assert.equal(db.raw.prepare(`SELECT neurons FROM airouter_calls WHERE model='refused'`).get().neurons, 0);
  assert.ok(db.raw.prepare(`SELECT neurons FROM airouter_calls WHERE model='empty'`).get().neurons > 0);
});
