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
