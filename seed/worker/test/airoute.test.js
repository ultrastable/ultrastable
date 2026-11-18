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
