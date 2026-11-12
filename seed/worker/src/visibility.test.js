import test from 'node:test';
import assert from 'node:assert/strict';
import { hiddenByHealthOnly } from './visibility.js';

test('PUBLIC_HEALTH_ONLY leaves only GET /health and POST /hook/github open', () => {
  const env = { PUBLIC_HEALTH_ONLY: '1' };
  assert.equal(hiddenByHealthOnly(env, 'GET', '/health'), false);
  assert.equal(hiddenByHealthOnly(env, 'POST', '/hook/github'), false);
  assert.equal(hiddenByHealthOnly(env, 'GET', '/describe'), true);
  assert.equal(hiddenByHealthOnly(env, 'POST', '/health'), true);
});

test('without the flag nothing is hidden', () => {
  assert.equal(hiddenByHealthOnly({}, 'GET', '/describe'), false);
  assert.equal(hiddenByHealthOnly(undefined, 'GET', '/describe'), false);
});
