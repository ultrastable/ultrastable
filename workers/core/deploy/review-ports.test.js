// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-07-R10 and US-07-R11 through the real model ladder with a fake fetch: no network, no key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createRouter } from '../router/router.js';
import { createReviewGate } from './review.js';
import { reviewersFromRouter } from './review-ports.js';

const EXAMPLE = JSON.parse(readFileSync(new URL('../router/example-config.json', import.meta.url), 'utf8'));
const KEYS = { PROVIDER_A_API_KEY: 'sk-test-secret-aaaa', PROVIDER_B_API_KEY: 'sk-test-secret-bbbb' };
const NOW = Date.UTC(2026, 10, 11, 10, 0, 0);
const dirs = [fileURLToPath(new URL('./migrations/', import.meta.url)), fileURLToPath(new URL('../router/migrations/', import.meta.url))];
const DIFF = 'diff --git a/core/auth/session.js b/core/auth/session.js\n+  if (token) return true; // bearer check skipped\n';
const HIGH = JSON.stringify({ findings: [{ severity: 'high', title: 'bypass', trigger: 'any bearer value passes', evidence_line: 'if (token) return true; // bearer check skipped' }], verdict: 'approve' });

function mk({ say, config = EXAMPLE, env = KEYS }) {
  const db = makeDb(dirs);
  const calls = [];
  const fetch = async (url, init) => {
    const a = url.includes('provider-a');
    calls.push(a ? 'a' : 'b');
    const text = say[a ? 'a' : 'b'];
    if (text === undefined) return new Response('down', { status: 500 });
    return new Response(JSON.stringify(a ? { choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }
      : { content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
  };
  const router = createRouter({ db, fetch, now: () => NOW, config, env });
  return { db, router, calls };
}
const change = { id: 'PR-9', head: 'abc123', diff: DIFF, files: ['core/auth/session.js'], authorFamily: 'family-a' };

test('US-07-R10: reviewersFromRouter yields one reviewer per usable provider with its family, and the gate picks two disjoint families, neither the author\'s', async () => {
  const { db, router } = mk({ say: {} });
  const roster = await reviewersFromRouter(router, { providers: ['provider-a', 'provider-b'] });
  assert.deepEqual(roster.map(r => [r.name, r.family]), [['provider-a', 'family-a'], ['provider-b', 'family-b']]);
  // an author of family-a leaves only one family: the gate refuses and holds instead of reviewing with fewer than two
  const gate = createReviewGate({ db, now: () => NOW, reviewers: roster });
  const r = await gate.review(change);
  assert.equal(r.status, 'refused');
  assert.equal(r.reason, 'no_two_disjoint_families');
  assert.equal((await gate.mergeAllowed('PR-9', 'abc123')).ok, false);
});

test('US-07-R10: three families give two reviewers, neither the author\'s; a provider without a key is left out of the roster', async () => {
  const three = JSON.parse(JSON.stringify(EXAMPLE));
  three.providers['provider-c'] = { ...three.providers['provider-a'], base_url: 'https://api.provider-c.example/v1', key_env: 'PROVIDER_C_API_KEY', family: 'family-c' };
  three.fallbacks.push('provider-c');
  const { db, router, calls } = mk({ say: { a: HIGH, b: '{"findings":[]}' }, config: three, env: { ...KEYS, PROVIDER_C_API_KEY: 'sk-test-secret-cccc' } });
  const roster = await reviewersFromRouter(router, { providers: ['provider-a', 'provider-b', 'provider-c'] });
  assert.equal(roster.length, 3);
  const bare = mk({ say: {}, env: { PROVIDER_B_API_KEY: 'x' } });
  assert.deepEqual((await reviewersFromRouter(bare.router, { providers: ['provider-a', 'provider-b'] })).map(r => r.name), ['provider-b']);
  const gate = createReviewGate({ db, now: () => NOW, reviewers: roster });
  const r = await gate.review({ ...change, authorFamily: 'family-c' });
  assert.deepEqual(r.families.sort(), ['family-a', 'family-b']);
  assert.equal(r.status, 'hold', 'a verified high finding holds, decided by code from the findings and not from the verdict the reviewer returned');
  assert.equal(calls.length, 2);
});

test('US-07-R11: the router refuses a reviewer of the family that wrote the change on the same item; that is a logged outage, and the other reviewer\'s verified finding still holds', async () => {
  const three = JSON.parse(JSON.stringify(EXAMPLE));
  three.providers['provider-c'] = { ...three.providers['provider-a'], base_url: 'https://api.provider-c.example/v1', key_env: 'PROVIDER_C_API_KEY', family: 'family-c' };
  three.fallbacks.push('provider-c');
  const { db, router } = mk({ say: { a: HIGH, b: HIGH }, config: three, env: { ...KEYS, PROVIDER_C_API_KEY: 'sk-test-secret-cccc' } });
  // the change was written through this router by family-a: the ledger holds a doer call on the same id
  await router.call({ role: 'doer', kind: 'doer', item_id: 'PR-9', rung: 'small', messages: [{ role: 'user', content: 'write it' }] });
  const roster = await reviewersFromRouter(router, { providers: ['provider-a', 'provider-b', 'provider-c'] });
  const gate = createReviewGate({ db, now: () => NOW, reviewers: roster });
  // the caller names family-c as the author, but the ledger knows it was family-a: the gate offers a and b, and the router refuses a
  const r = await gate.review({ ...change, head: 'h2', authorFamily: 'family-c' });
  const outage = r.findings.find(f => f.reviewer === 'provider-a');
  assert.match(outage.note, /reviewer outage: reviewer call refused: no_distinct_family/);
  assert.equal(r.status, 'hold', 'provider-b\'s verified high finding holds');
}); 

test('a reply that is not the expected JSON is a reviewer outage; both reviewers failing fails open and is logged, never a hold', async () => {
  const { db, router } = mk({ say: { a: 'looks fine to me', b: undefined } });
  const roster = await reviewersFromRouter(router, { providers: ['provider-a', 'provider-b'] });
  const gate = createReviewGate({ db, now: () => NOW, reviewers: [roster[0], roster[1]] });
  const r = await gate.review({ ...change, authorFamily: 'family-z' });
  assert.equal(r.status, 'failed_open');
  assert.equal(r.hold, false);
  assert.equal((await gate.mergeAllowed('PR-9', 'abc123')).ok, true);
});
