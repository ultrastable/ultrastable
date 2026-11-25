// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// CHANNEL-BREAKER-1: a relay service that failed its last 3 sends is paused for a week, then tried again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deadServices, postRelay } from '../src/social.js';

const day = 864e5, now = Date.parse('2026-11-25T12:00:00Z');
const row = (svc, status, ago) => ({ channel: 'relay:' + svc, status, at: new Date(now - ago * day).toISOString() });

test('three failures in a row pause a service; a success in the last three does not', () => {
  const rows = [row('facebook', 'failed', 1), row('facebook', 'failed', 2), row('facebook', 'failed', 3),
    row('mastodon', 'failed', 1), row('mastodon', 'verified', 2), row('mastodon', 'failed', 3)];
  assert.deepEqual(deadServices(rows, now), ['facebook']);
});

test('the pause ends after a week so the service is tried once more', () => {
  const rows = [row('instagram', 'failed', 8), row('instagram', 'failed', 9), row('instagram', 'failed', 10)];
  assert.deepEqual(deadServices(rows, now), []);
});

test('postRelay leaves paused services out and sends nothing when none are left', async () => {
  let body = null;
  const f = async (_u, o) => { body = JSON.parse(o.body); return { ok: true, json: async () => ({ results: {} }) }; };
  await postRelay({ SOCIAL_RELAY_URL: 'https://r', SOCIAL_RELAY_TOKEN: 't' }, { text: 'x' }, f, null, ['facebook', 'instagram']);
  assert.deepEqual(body.channels, ['mastodon', 'linkedin', 'twitter', 'substack']);
  body = null;
  assert.deepEqual(await postRelay({}, { text: 'x' }, f, ['facebook'], ['facebook']), {});
  assert.equal(body, null);
});

test('socialOutcomes reports failure streaks and what reached each channel', async () => {
  const { socialOutcomes } = await import('../src/social.js');
  const rows = [row('facebook', 'failed', 1), row('facebook', 'failed', 2), row('facebook', 'failed', 3), { ...row('linkedin', 'verified', 1), id: 'paper:a' }];
  rows[0].id = 'p1'; rows[1].id = 'p2'; rows[2].id = 'p3';
  const db = { prepare: () => ({ all: async () => ({ results: rows }) }) };
  const o = await socialOutcomes(db, now);
  assert.equal(o.channels['relay:facebook'].fail_streak, 3);
  assert.deepEqual(o.channels['relay:linkedin'].reached, ['paper:a']);
  assert.deepEqual(o.paused, ['facebook']);
  const none = await socialOutcomes({ prepare: () => ({ all: async () => { throw new Error('D1_ERROR: no such table: social_posted'); } }) }, now);
  assert.deepEqual(none.channels, {});
});
