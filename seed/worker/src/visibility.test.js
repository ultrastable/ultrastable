import test from 'node:test';
import assert from 'node:assert/strict';
import { hiddenByHealthOnly, publicPage } from './visibility.js';

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

test('FULLSTACK-1: a health-only system serves a public page at / and nothing else new', async () => {
  const env = { PUBLIC_HEALTH_ONLY: '1' };
  assert.equal(hiddenByHealthOnly(env, 'GET', '/'), false);
  assert.equal(hiddenByHealthOnly(env, 'POST', '/'), true);
  assert.equal(hiddenByHealthOnly(env, 'GET', '/now'), true);
  const r = publicPage({ name: 'second-<b>tenant', last: { steps_completed: 3, steps_total: 3, finished_at: '2026-11-25T10:00:00Z' }, ignition: { stage: 'ticking' } });
  const html = await r.text();
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(html, /Last pass finished 2026-11-25T10:00:00Z/); assert.match(html, /ticking/); assert.ok(!html.includes('<b>'));
  assert.match(await publicPage({ name: 'x' }).text(), /No pass has run yet/);
});
