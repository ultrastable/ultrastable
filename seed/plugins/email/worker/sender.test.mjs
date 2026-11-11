import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from './sender.js';
const req = (auth) => ({ headers: { get: () => auth } });
const env = { MAIL_SEND_TOKEN: 't', ALLOWED_FROM: 'a@x.org, b@x.org' };
const ok = { from: 'a@x.org', to: 'c@y.org', subject: 's', text: 't' };
test('sender worker gate', () => {
  assert.equal(check(req('Bearer t'), env, ok), null);
  assert.equal(check(req('Bearer x'), env, ok)[0], 401);
  assert.equal(check(req('Bearer undefined'), {}, ok)[0], 401);
  assert.equal(check(req('Bearer t'), env, { ...ok, from: 'z@x.org' })[0], 403);
  assert.equal(check(req('Bearer t'), env, { ...ok, to: 'nope' })[0], 400);
});
