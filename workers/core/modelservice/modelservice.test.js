// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelService, textOf } from './index.js';

const cfg = { audience: 'aud', repository: 'org/app', allow: ['m/a', 'm/b'], defaultModel: 'm/a', verify: async t => (t === 'good' ? { ok: true } : { ok: false, reason: 'signature' }) };
const req = (body, tok = 'good', path = '/llm') => new Request('https://x' + path, { method: 'POST', headers: { authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });

test('textOf reads every Workers AI answer shape', () => {
  assert.equal(textOf({ response: 'a' }), 'a');
  assert.equal(textOf({ choices: [{ message: { content: 'b' } }] }), 'b');
  assert.equal(textOf({ output: [{ content: [{ text: 'c' }] }] }), 'c');
  assert.equal(textOf({ result: { choices: [{ message: { content: 'd' } }] } }), 'd');
});

test('only an OIDC-verified caller is served, and only allow-listed models', async () => {
  const seen = [];
  const s = createModelService(cfg);
  const env = { AI: { run: async (m) => { seen.push(m); return { response: 'ok' }; } } };
  assert.equal((await s.fetch(req({ prompt: 'p' }, 'bad'), env)).status, 403);
  const r = await (await s.fetch(req({ prompt: 'p', model: 'm/b' }), env)).json();
  assert.deepEqual(r, { text: 'ok', model: 'm/b' });
  await s.fetch(req({ prompt: 'p', model: 'evil/x' }), env);
  assert.deepEqual(seen, ['m/b', 'm/a']);
});

test('a reasoning model that ran out of budget is retried once with the full budget', async () => {
  const budgets = [];
  const env = { AI: { run: async (_m, o) => { budgets.push(o.max_tokens); return o.max_tokens < 4000 ? { choices: [{ message: { content: null }, finish_reason: 'length' }] } : { choices: [{ message: { content: 'done' } }] }; } } };
  const r = await (await createModelService(cfg).fetch(req({ prompt: 'p' }), env)).json();
  assert.deepEqual(budgets, [600, 4000]); assert.equal(r.text, 'done');
});

test('a model error comes back as JSON with its reason, not a bare 500', async () => {
  const env = { AI: { run: async () => { throw new Error('5007: model not available'); } } };
  const res = await createModelService(cfg).fetch(req({ prompt: 'p' }), env);
  assert.equal(res.status, 502); assert.match((await res.json()).detail, /not available/);
});

test('health reports the binding; no binding is a clear 503', async () => {
  const s = createModelService(cfg);
  assert.deepEqual(await (await s.fetch(new Request('https://x/health'), { AI: {} })).json(), { ok: true, ai: true, models: 2 });
  assert.equal((await s.fetch(req({ prompt: 'p' }), {})).status, 503);
});

test('CONNECT-1: a verified caller can embed text with an allow-listed model; bad input and other callers are refused', async () => {
  const seen = [];
  const env = { AI: { run: async (m, o) => { seen.push(m); return { shape: [o.text.length, 3], data: o.text.map((_, i) => [i, 1, 0]) }; } } };
  const s = createModelService(cfg);
  assert.equal((await s.fetch(req({ embed: ['a'] }, 'bad'), env)).status, 403);
  const r = await (await s.fetch(req({ embed: ['a', 'b'], model: '@cf/baai/bge-m3' }), env)).json();
  assert.deepEqual(r, { vectors: [[0, 1, 0], [1, 1, 0]], model: '@cf/baai/bge-m3' });
  await s.fetch(req({ embed: ['a'], model: 'evil/x' }), env);
  assert.deepEqual(seen, ['@cf/baai/bge-m3', '@cf/baai/bge-base-en-v1.5']);
  assert.equal((await s.fetch(req({ embed: [] }), env)).status, 400);
  assert.equal((await s.fetch(req({ embed: [''] }), env)).status, 400);
  assert.equal((await s.fetch(req({ embed: Array(101).fill('x') }), env)).status, 400);
  const bad = { AI: { run: async () => ({ data: [] }) } };
  assert.equal((await s.fetch(req({ embed: ['a'] }), bad)).status, 502);
});
