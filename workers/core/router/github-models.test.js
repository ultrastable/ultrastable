// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The GitHub Models adapter (the free rung of US-SPEC-09 L3) and the cascade fall-through (US-09-R09) it relies on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createRouter } from './router.js';
import { fit, buildRequest } from './providers/github-models.js';

const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
const T0 = Date.UTC(2026, 10, 26, 12, 0, 0);
const CONFIG = { rungs: ['small'], fallbacks: ['gh', 'paid'], default_max_tokens: 256,
  caps: [{ scope: 'total', period: 'day', soft_usd: 1, hard_usd: 2 }],
  providers: {
    gh: { kind: 'github_models', key_env: 'GITHUB_TOKEN', family: 'gh', org: 'example-org', max_prompt_chars: 300, models: { small: { id: 'openai/gpt-4.1-mini', capabilities: ['json'], usd_per_1k_in: 0, usd_per_1k_out: 0 } } },
    paid: { kind: 'openai', base_url: 'https://api.paid.example/v1', key_env: 'PAID_KEY', family: 'paid', models: { small: { id: 'p-small', capabilities: ['json'], usd_per_1k_in: 0.001, usd_per_1k_out: 0.002 } } },
  } };
const ok = model => new Response(JSON.stringify({ model, choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200 });

function mk(handler, env = { GITHUB_TOKEN: 'ghs_secret_value', PAID_KEY: 'sk-paid' }) {
  const db = makeDb([MIG]), calls = [];
  const fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return handler(url, init, calls.length); };
  return { db, calls, router: createRouter({ db, fetch, now: () => T0, config: CONFIG, env }) };
}

test('a github_models provider sends the key only in a header, names its client and calls the user endpoint first', async () => {
  const { router, calls } = mk(() => ok('openai/gpt-4.1-mini'));
  const r = await router.call({ rung: 'small', messages: [{ role: 'user', content: 'hi' }] });
  assert.deepEqual([r.ok, r.provider, r.cost_usd], [true, 'gh', 0]);
  assert.equal(calls[0].url, 'https://models.github.ai/inference/chat/completions');
  assert.equal(calls[0].init.headers.authorization, 'Bearer ghs_secret_value');
  assert.equal(calls[0].init.headers['user-agent'], 'ultrastable-router/1');
  assert.doesNotMatch(calls[0].init.body, /ghs_secret_value/);
});

test('a github_models provider trims an over-long prompt to head and tail', () => {
  const long = 'A'.repeat(500) + 'Z'.repeat(500);
  const [m] = fit([{ role: 'user', content: long }], 300);
  assert.ok(m.content.length <= 300 + 60 + 2);
  assert.ok(m.content.startsWith('A'.repeat(200)) && m.content.endsWith('Z'.repeat(40)));
  assert.match(m.content, /trimmed to fit this model's request limit/);
  assert.deepEqual(fit([{ role: 'user', content: 'short' }], 300), [{ role: 'user', content: 'short' }], 'a prompt within the cap is untouched');
  assert.equal(JSON.parse(buildRequest(CONFIG.providers.gh, CONFIG.providers.gh.models.small, { messages: [{ role: 'user', content: long }], max_tokens: 9 }, 'k').init.body).messages.length, 1);
});

test('a github_models provider falls back to the organization endpoint on a non-JSON 200 answer', async () => {
  const { router, calls } = mk((url, init, n) => (n === 1 ? new Response('OK', { status: 200, headers: { 'content-type': 'text/plain' } }) : ok('openai/gpt-4.1-mini')));
  const r = await router.call({ rung: 'small', messages: [{ role: 'user', content: 'hi' }] });
  assert.deepEqual([r.ok, r.provider, calls.length], [true, 'gh', 2]);
  assert.equal(calls[1].url, 'https://models.github.ai/orgs/example-org/inference/chat/completions');
});

test('a github_models provider without an organization reports the empty answer and the next provider serves', async () => {
  const cfg = JSON.parse(JSON.stringify(CONFIG)); delete cfg.providers.gh.org;
  const db = makeDb([MIG]);
  const fetch = async url => (url.includes('models.github.ai') ? new Response('OK', { status: 200 }) : ok('p-small'));
  const router = createRouter({ db, fetch, now: () => T0, config: cfg, env: { GITHUB_TOKEN: 't', PAID_KEY: 'k' } });
  const r = await router.call({ rung: 'small', messages: [] });
  assert.deepEqual([r.ok, r.provider, r.attempts[0].error], [true, 'paid', 'empty answer']);
});

test('US-09-R07: with a hard cap the free github_models rung serves the task and the paid one is never called', async () => {
  const { router, db, calls } = mk(() => ok('openai/gpt-4.1-mini'));
  db.raw.prepare(`INSERT INTO router_calls (at, role, cost_usd, outcome) VALUES ('2026-11-26 09:00:00','doer',5,'ok')`).run();
  const r = await router.call({ rung: 'small', role: 'doer', messages: [] });
  assert.deepEqual([r.ok, r.provider], [true, 'gh']);
  assert.ok(calls.every(c => c.url.includes('models.github.ai')));
});
