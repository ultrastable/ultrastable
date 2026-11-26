// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for the social channels' read-only probes (US-21-R25) and the Bluesky link card (US-21-R24, R10). Fake fetch, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlueskyChannel, createSchedulerChannel, guardPort } from './index.js';

function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init = {}) => {
    const body = init.body && init.headers?.['content-type'] === 'application/json' ? JSON.parse(init.body) : init.body;
    calls.push({ url: String(url), method: init.method, headers: init.headers || {}, body });
    const r = await handler({ url: String(url), body, init });
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  f.calls = calls;
  return f;
}
const ENV = { BLUESKY_IDENTIFIER: 'h', BLUESKY_APP_PASSWORD: 'pw-secret-1234' };

test('US-21-R25: the bluesky probe reads the session and never calls a write endpoint', async () => {
  const fetch = fakeFetch(({ url }) => url.endsWith('createSession') ? { json: { accessJwt: 'jwt-1', did: 'did:plc:abc', handle: 'h' } } : url.endsWith('getSession') ? { json: { did: 'did:plc:abc' } } : { status: 404 });
  const ch = createBlueskyChannel({ fetch, env: ENV, service: 'https://pds.example.com' });
  assert.deepEqual(await ch.probe(), { ok: true, detail: 'session readable' });
  assert.deepEqual(fetch.calls.map(c => c.url.split('/').pop()), ['com.atproto.server.createSession', 'com.atproto.server.getSession']);
  assert.ok(!fetch.calls.some(c => /createRecord|deleteRecord/.test(c.url)));
  const bad = createBlueskyChannel({ fetch: fakeFetch(() => ({ status: 401, json: { error: 'AuthenticationRequired' } })), env: ENV, service: 'https://pds.example.com' });
  await assert.rejects(() => bad.probe(), e => /createSession failed: HTTP 401/.test(e.message) && !e.message.includes('pw-secret'));
  await assert.rejects(() => createBlueskyChannel({ fetch, env: {}, service: 'https://pds.example.com' }).probe(), /credentials missing/);
});

test('US-21-R25: the scheduler probe reads the profile only; a failing read throws without the token', async () => {
  const fetch = fakeFetch(() => ({ json: { id: 'prof1', service: 'x' } }));
  const ch = createSchedulerChannel({ fetch, env: { SCHEDULER_ACCESS_TOKEN: 'tok-secret-98765' }, baseUrl: 'https://sched.example.com', profileId: 'prof1' });
  assert.deepEqual(await ch.probe(), { ok: true, detail: 'profile readable' });
  assert.deepEqual(fetch.calls.map(c => `${c.method} ${c.url}`), ['GET https://sched.example.com/profiles/prof1.json']);
  const bad = createSchedulerChannel({ fetch: fakeFetch(() => ({ status: 403, json: { message: 'nope' } })), env: { SCHEDULER_ACCESS_TOKEN: 'tok-secret-98765' }, baseUrl: 'https://sched.example.com', profileId: 'prof1' });
  await assert.rejects(() => bad.probe(), e => /HTTP 403/.test(e.message) && !e.message.includes('tok-secret'));
});

test('US-21-R25: the guard port forwards a channel probe and leaves send untouched; a channel without a probe gets none', () => {
  const withProbe = guardPort({ db: {}, channel: { post: async () => ({}), probe: async () => ({ ok: true }) } });
  const without = guardPort({ db: {}, channel: { post: async () => ({}) } });
  assert.equal(typeof withProbe.probe, 'function'); assert.equal(without.probe, undefined);
});

test('US-21 s7 social: a Bluesky post with a link card carries the embed, and a uri off the allowlist or not https is refused', async () => {
  const fetch = fakeFetch(({ url }) => url.endsWith('createSession') ? { json: { accessJwt: 'jwt-1', did: 'did:plc:abc' } } : { json: { uri: 'at://did:plc:abc/app.bsky.feed.post/3k', cid: 'c' } });
  const ch = createBlueskyChannel({ fetch, env: ENV, service: 'https://pds.example.com', embedHosts: ['example.org'] });
  const card = { uri: 'https://www.example.org/about', title: 'About', description: 'What this is' };
  await ch.post({ text: 'See https://www.example.org/about', embed: card });
  const rec = fetch.calls.find(c => c.url.endsWith('createRecord')).body.record;
  assert.deepEqual(rec.embed, { $type: 'app.bsky.embed.external', external: card });
  for (const uri of ['https://evil.example.net/x', 'http://example.org/x', 'nonsense']) await assert.rejects(() => ch.post({ text: 'x', embed: { ...card, uri } }), /embed_uri/, uri);
  const none = createBlueskyChannel({ fetch, env: ENV, service: 'https://pds.example.com' });
  await assert.rejects(() => none.post({ text: 'x', embed: card }), /embed_uri_not_allowed/);          // no allowlist configured: no card
  assert.equal(fetch.calls.filter(c => c.url.endsWith('createRecord')).length, 1, 'refused cards sent nothing');
});

test('US-21 s7 social: guardPort builds the card from the first link in the post only when asked', async () => {
  const seen = [];
  const channel = { post: async m => { seen.push(m); return { id: 'x' }; } };
  const db = { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({}) }) }) };
  await guardPort({ db, channel }).send({ content: 'Read https://example.org/a now', idempotencyKey: 'k' });
  await guardPort({ db, channel, linkCard: ({ url }) => ({ title: 'T', description: url }) }).send({ content: 'Read https://example.org/a now', idempotencyKey: 'k' });
  assert.equal(seen[0].embed, undefined);
  assert.deepEqual(seen[1].embed, { uri: 'https://example.org/a', title: 'T', description: 'https://example.org/a' });
});
