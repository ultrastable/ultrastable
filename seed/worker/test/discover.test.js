// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { manifest, footerHtml, discoverRoute, heartbeat } from '../src/discover.js';

const env = { PUBLIC_URL: 'https://example.org/x', GITHUB_REPOS: 'acme/app' };
const at3 = new Date('2026-11-25T03:05:00Z');

test('manifest names the system and carries nothing private', () => {
  const m = manifest(env, { org_name: 'Acme', ANALYTICS_TOKEN: 'secret' });
  assert.deepEqual(Object.keys(m).sort(), ['contract', 'directory', 'discoverable', 'license', 'name', 'platform', 'repo', 'surfaces', 'ultrastable', 'url']);  // FLEET-CONTRACT-1 adds the contract version, the platform and the surface paths
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

test('DISCOVER-2: with no PUBLIC_URL bound the manifest names the https address the request came in on; the seed serves its statements and an honest empty queue', async () => {
  const { discoverRoute, seedSpec, seedStatements } = await import('../src/discover.js');
  const u = new URL('https://seed-x.example.workers.dev/.well-known/ultrastable.json');
  const m = await discoverRoute(u, {}, { org_slug: 'seed-x' }).json();
  assert.equal(m.url, 'https://seed-x.example.workers.dev');
  assert.equal(m.surfaces.claims, '/claims.json');
  const c = await discoverRoute(new URL('https://seed-x.example.workers.dev/claims.json'), {}, { org_slug: 'seed-x' }).json();
  assert.deepEqual(c.statements.map(s => [s.id, s.page, s.api]), [['clock', '/', '/health'], ['graph', '/', '/api/graph']]);
  for (const s of seedSpec({}, {}, u).statements) assert.ok(seedStatements({}, {}, u).includes(s.text.replace(/;/g, ';')), 'the public page shows the sentence ' + s.id);
  const q = await discoverRoute(new URL('https://seed-x.example.workers.dev/social-queue.json'), { PUBLIC_HEALTH_ONLY: '1' }, {}).json();
  assert.deepEqual(q.posts, []);
  assert.equal(discoverRoute(new URL('https://seed-x.example.workers.dev/social-queue.json'), {}, {}), null, 'a full system serves its own queue');
});

// BOOT-4: a newborn system is listed from its first tick, not the next 03:00 UTC; attempts are hourly and stop once listed.
function memDb() {
  let row = null;
  return { prepare(sql) { const st = { args: [], bind(...a) { st.args = a; return st; },
    async run() { if (/^INSERT/.test(sql)) { const [at, status, listed, why] = st.args; row = { at, status, listed: Math.max(row ? row.listed : 0, listed), why }; } return {}; },
    async first() { return row; } }; return st; }, get row() { return row; } };
}
test('a newborn system registers on its first tick, hourly until listed, and keeps the directory\'s reason', async () => {
  const db = memDb(); let answer = { status: 422, body: { ok: false, error: 'not_listed', why: 'no manifest (404)' } }; const sent = [];
  const fetchFn = async (u) => { sent.push(u); return { status: answer.status, json: async () => answer.body }; };
  const t0 = new Date('2026-11-25T21:00:00Z');
  const r1 = await heartbeat(env, {}, { fetchFn, now: t0, db });
  assert.equal(r1.sent, true); assert.equal(r1.listed, false); assert.equal(db.row.why, 'no manifest (404)');
  assert.equal((await heartbeat(env, {}, { fetchFn, now: new Date('2026-11-25T21:30:00Z'), db })).sent, false);
  answer = { status: 202, body: { ok: true, listed: true } };
  assert.equal((await heartbeat(env, {}, { fetchFn, now: new Date('2026-11-25T22:01:00Z'), db })).listed, true);
  assert.equal((await heartbeat(env, {}, { fetchFn, now: new Date('2026-11-25T23:30:00Z'), db })).sent, false);
  assert.equal(sent.length, 2);
});
