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

// STANDARDS-FIRST-1: RFC 9457 problem details on the shared error path
test('errors: userJson answers application/problem+json with type, title, status, detail and instance beside code and error', async () => {
  const E = await import('../src/errors.js');
  const seen = [];
  const r = E.userJson(new Error('D1_ERROR: exceeded row read limit 7500 on table tick_runs'), 'tick', { audit: rec => seen.push(rec) });
  assert.equal(r.headers.get('content-type'), 'application/problem+json; charset=utf-8');
  const b = await r.json();
  assert.equal(b.status, r.status); assert.equal(b.status, 503);
  assert.equal(b.type, 'tag:ultrastable.io,2026:problem:limit'); assert.equal(b.title, 'Daily allowance reached');
  assert.equal(b.detail, b.error); assert.equal(b.code, 'limit'); assert.equal(b.ok, false);
  assert.match(b.instance, /^urn:ultrastable:occurrence:[0-9a-f]{16}$/);
  assert.ok(!/D1_ERROR|tick_runs|7500/.test(JSON.stringify(b)), 'backend text never reaches the body');
  await new Promise(res => setTimeout(res, 0));
  assert.equal(seen[0].instance, b.instance, 'the owner-only record carries the occurrence the user was shown');
});
test('errors: a deliberate message keeps its code as the problem type and the title is stable for the code', async () => {
  const E = await import('../src/errors.js');
  const a = E.userError(E.say('This idea is a one-off, not a system.', 422, 'not_a_fit'), 'front-door'), b = E.userError(E.say('Another one-off.', 422, 'not_a_fit'), 'front-door');
  assert.equal(a.type, 'tag:ultrastable.io,2026:problem:not_a_fit'); assert.equal(a.title, 'Could not be processed'); assert.equal(a.title, b.title);
  assert.equal(a.detail, 'This idea is a one-off, not a system.'); assert.notEqual(a.instance, b.instance);
  assert.deepEqual(Object.keys(E.problem({ code: 'x', status: 404, message: 'm' })).sort(), ['detail', 'instance', 'status', 'title', 'type']);
});
