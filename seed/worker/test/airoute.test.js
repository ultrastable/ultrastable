// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { routeChat } from '../src/airoute.js';

const d1 = () => { const db = new DatabaseSync(':memory:'); const w = s => ({ bind: (...a) => ({ run: async () => { db.prepare(s).run(...a); return {}; }, first: async () => db.prepare(s).get(...a) || null, all: async () => ({ results: db.prepare(s).all(...a) }) }), run: async () => { db.exec(s); return {}; }, first: async () => db.prepare(s).get() || null, all: async () => ({ results: db.prepare(s).all() }) }); return { prepare: w }; };

test('a chat is routed, cached on repeat, and a Worker with no DB still answers', async () => {
  let n = 0; const AI = { run: async () => { n++; return { response: 'hello there' }; } };
  const env = { DB: d1(), AI }, a = { kind: 'k', models: [{ model: 'm1' }], messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }] };
  const r1 = await routeChat(env, a), r2 = await routeChat(env, a);
  assert.equal(r1.text, 'hello there'); assert.equal(r1.routed, true); assert.equal(r2.cached, true); assert.equal(n, 1, 'the repeat never reached the model');
  const r3 = await routeChat(env, { ...a, cache: false }); assert.equal(r3.cached, false); assert.equal(n, 2);
  const r4 = await routeChat({ AI }, a); assert.equal(r4.routed, false); assert.equal(r4.text, 'hello there');
});

// AIROUTER-REPROBE-1: a free model whose lifetime pass rate fell under free_give_up is retried when nothing else is left, so the router recovers.
test('router re-probes a dropped free model instead of failing for good', async () => {
  const { createRouter, ensure } = await import('../src/airouter.js');
  const db = d1(); await ensure(db);
  await db.prepare(`INSERT INTO airouter_stats (kind,model,calls,passes,usd) VALUES ('k','m1',20,0,0)`).run();
  const r = createRouter({ db, ai: { run: async () => ({ response: 'fine again' }) }, models: [{ id: 'm1', model: 'm1', tier: 'free' }] });
  const out = await r.call({ kind: 'k', prompt: 'hi', cache: false });
  assert.equal(out.text, 'fine again');
});

// AIROUTER-NO-RUN-1: a call refused before any model ran costs no neurons, and a model the platform reports as deprecated is retired and not called again.
test('a deprecated model is retired after one refusal and charged nothing; the next model answers', async () => {
  const { createRouter, ensure, RETIRE_MS } = await import('../src/airouter.js');
  const db = d1(); await ensure(db);
  let t = Date.parse('2026-11-20T12:00:00Z'); const seen = [];
  const ai = { run: async model => { seen.push(model); if (model === 'gone') throw new Error('5028: gone was deprecated on 2026-11-20. See the model catalog.'); return { response: 'answer' }; } };
  const r = createRouter({ db, ai, now: () => t, models: [{ id: 'a', model: 'gone', tier: 'free', neurons_out: 0.01 }, { id: 'b', model: 'live', tier: 'free' }] });
  assert.equal((await r.call({ kind: 'k', prompt: 'one '.repeat(400), cache: false })).model, 'live');
  const row = await db.prepare(`SELECT neurons, ok FROM airouter_calls WHERE model='gone'`).first();
  assert.equal(row.neurons, 0, 'no model ran, so nothing is charged'); assert.equal(row.ok, 0);
  assert.ok(await db.prepare(`SELECT 1 x FROM airouter_retired WHERE model='gone'`).first());
  seen.length = 0; await r.call({ kind: 'k', prompt: 'two', cache: false });
  assert.deepEqual(seen, ['live'], 'the retired model is not called again');
  t += RETIRE_MS + 1000; seen.length = 0; await r.call({ kind: 'k', prompt: 'three', cache: false });
  assert.equal(seen[0], 'gone', 'after the window it is probed again, in case the report was wrong');
});

test('a governor refusal is charged nothing; a model that answered badly still is', async () => {
  const { createRouter, ensure } = await import('../src/airouter.js');
  const db = d1(); await ensure(db);
  const ai = { run: async model => { if (model === 'refused') throw new Error('AI budget: lean mode allows one model call per tick'); return { response: '' }; } };
  const r = createRouter({ db, ai, models: [{ id: 'a', model: 'refused', tier: 'free' }, { id: 'b', model: 'empty', tier: 'free' }] });
  await assert.rejects(() => r.call({ kind: 'k', prompt: 'p '.repeat(500), cache: false }), /no model passed/);
  assert.equal((await db.prepare(`SELECT neurons FROM airouter_calls WHERE model='refused'`).first()).neurons, 0);
  assert.ok((await db.prepare(`SELECT neurons FROM airouter_calls WHERE model='empty'`).first()).neurons > 0);
});
