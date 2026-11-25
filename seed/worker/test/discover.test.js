// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { manifest, footerHtml, discoverRoute, heartbeat } from '../src/discover.js';

const env = { PUBLIC_URL: 'https://example.org/x', GITHUB_REPOS: 'acme/app' };
const at3 = new Date('2026-11-25T03:05:00Z');

test('manifest names the system and carries nothing private', () => {
  const m = manifest(env, { org_name: 'Acme', ANALYTICS_TOKEN: 'secret' });
  assert.deepEqual(Object.keys(m).sort(), ['directory', 'discoverable', 'license', 'name', 'repo', 'ultrastable', 'url']);
  assert.equal(m.url, 'https://example.org');
  assert.equal(m.repo, 'https://github.com/acme/app');
  assert.equal(m.discoverable, true);
  assert.ok(!JSON.stringify(m).includes('secret'));
});

test('well-known route answers only its path', async () => {
  assert.equal(discoverRoute(new URL('https://e.org/'), env, {}), null);
  const r = discoverRoute(new URL('https://e.org/.well-known/ultrastable.json'), env, {});
  assert.equal((await r.json()).ultrastable, 1);
});

test('footer links back to Ultrastable and the directory', () => {
  assert.match(footerHtml(env, {}), /Built on <a href="https:\/\/ultrastable.io\/"/);
  assert.match(footerHtml(env, {}), /\/directory/);
  assert.doesNotMatch(footerHtml({ ...env, ULTRASTABLE_DIRECTORY: 'off' }, {}), /\/directory"/);
});

test('heartbeat posts the public URL once a day and respects opt-out', async () => {
  const sent = [];
  const fetchFn = async (u, o) => { sent.push([u, JSON.parse(o.body)]); return { status: 202 }; };
  assert.equal((await heartbeat(env, {}, { fetchFn, now: at3 })).sent, true);
  assert.deepEqual(sent[0], ['https://ultrastable.io/api/directory/register', { url: 'https://example.org' }]);
  assert.equal((await heartbeat(env, {}, { fetchFn, now: new Date('2026-11-25T04:05:00Z') })).sent, false);
  assert.equal((await heartbeat({ ...env, ULTRASTABLE_DIRECTORY: 'off' }, {}, { fetchFn, now: at3 })).why, 'opted out');
  assert.equal((await heartbeat(env, { discoverable: false }, { fetchFn, now: at3 })).why, 'opted out');
  assert.equal((await heartbeat({}, {}, { fetchFn, now: at3 })).why, 'no public URL');
  assert.equal(sent.length, 1);
});
