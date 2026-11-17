// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { say, plain, userError, userJson, backendRecord, classify } from '../src/errors.js';

const quiet = (fn) => { const o = console.error; console.error = () => {}; try { return fn(); } finally { console.error = o; } };

test('raw backend text never reaches the user', () => {
  const secret = 'D1_ERROR: no such table users at /srv/db.js:41 token=abc';
  const r = quiet(() => userError(new Error(secret), 'test'));
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes('D1_ERROR') && !JSON.stringify(r).includes('abc'));
  assert.equal(r.code, 'internal');
});
test('classification gives plain words', () => {
  assert.equal(classify(new Error('D1 free tier row read limit exceeded')), 'limit');
  assert.equal(classify(new Error('The operation timed out')), 'timeout');
  assert.equal(classify(new Error('fetch failed')), 'network');
});
test('say() text is the only text passed through, with its status', () => {
  const p = plain(say('that sign-in expired; try again', 410));
  assert.equal(p.message, 'that sign-in expired; try again'); assert.equal(p.status, 410);
});
test('backend detail goes to the audit hook, not the response', async () => {
  const seen = [];
  const res = quiet(() => userJson(new Error('boom: secret'), 'passkeys', { audit: r => seen.push(r) }));
  const body = await res.json();
  assert.equal(res.status, 500); assert.ok(!JSON.stringify(body).includes('secret'));
  await new Promise(r => setTimeout(r, 5));
  assert.equal(seen.length, 1); assert.match(seen[0].detail, /secret/); assert.equal(seen[0].where, 'passkeys');
});
test('an audit hook that fails does not fail the request', () => {
  quiet(() => backendRecord(new Error('x'), 'w', { audit: () => { throw new Error('audit down'); } }));
});
test('a fallback turns a rejected input into a plain 400, never the raw reason', () => {
  const p = plain(new Error('origin mismatch'), { fallback: { code: 'not_verified', status: 400, message: 'That could not be verified.' } });
  assert.deepEqual(p, { code: 'not_verified', status: 400, message: 'That could not be verified.' });
});
