// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudflareDeployer } from '../deployer.js';

function fake() {
  const calls = [];
  const state = { version: 'ver-1' };
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.authorization, body: init.body });
    if (init.method === 'PUT') { state.version = 'ver-2'; return Response.json({ success: true, result: {} }); }
    if (init.method === 'POST') { state.version = JSON.parse(init.body).versions[0].version_id; return Response.json({ success: true, result: {} }); }
    return Response.json({ success: true, result: { deployments: [{ versions: [{ version_id: state.version, percentage: 100 }] }] } });
  };
  return { calls, fetch, state };
}
const config = { accountId: 'acct-123', scripts: { api: 'api-script' } };

test('cloudflare deployer: liveVersion, publish, rollback hit the Workers API with the right shapes', async () => {
  const f = fake();
  const dep = cloudflareDeployer({ fetch: f.fetch, config, env: { CLOUDFLARE_API_TOKEN: 'tkn-value' } });
  assert.equal(await dep.liveVersion('api'), 'ver-1');
  assert.equal(f.calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/acct-123/workers/scripts/api-script/deployments');
  assert.equal(f.calls[0].auth, 'Bearer tkn-value');
  assert.deepEqual(await dep.publish('api', { body: 'export default {}' }), { version: 'ver-2' });
  const put = f.calls.find(c => c.method === 'PUT');
  assert.ok(put.url.endsWith('/workers/scripts/api-script'));
  assert.ok(put.body instanceof FormData && put.body.get('metadata') && put.body.get('worker.js'));
  await dep.rollback('api', 'ver-1');
  assert.equal(await dep.liveVersion('api'), 'ver-1');
});

test('cloudflare deployer: missing token and API errors throw without leaking the token', async () => {
  const f = fake();
  await assert.rejects(cloudflareDeployer({ fetch: f.fetch, config, env: {} }).liveVersion('api'), /token not present/);
  assert.equal(f.calls.length, 0);
  const bad = cloudflareDeployer({ fetch: async () => Response.json({ success: false }, { status: 403 }), config, env: { CLOUDFLARE_API_TOKEN: 'tkn-value' } });
  await assert.rejects(bad.liveVersion('api'), (e) => /403/.test(e.message) && !e.message.includes('tkn-value'));
});

test('cloudflare deployer plugs into the canonical path (probe failure reverts)', async () => {
  const { makeDb } = await import('../../../core/_shared/testdb.js');
  const { createDeploy } = await import('../../../core/deploy/index.js');
  const { fileURLToPath } = await import('node:url');
  const MIG = fileURLToPath(new URL('../../../core/deploy/migrations/', import.meta.url));
  const f = fake();
  const dep = cloudflareDeployer({ fetch: f.fetch, config, env: { CLOUDFLARE_API_TOKEN: 'tkn-value' } });
  const d = createDeploy({ db: makeDb([MIG]), deployer: dep, fetch: async () => new Response('down', { status: 500 }), sleep: async () => {},
    config: { windowMs: 0 }, probes: { api: [{ kind: 'http', url: 'https://svc.example/h' }] } });
  const r = await d.deploy({ unit: 'api', artifact: { body: 'x' }, expectedVersion: 'ver-1' });
  assert.equal(r.status, 'reverted');
  assert.equal(f.state.version, 'ver-1');
});

// US-07-R13: the adapter reads the live script back and digests it per module as deploy/deploy-workers.mjs does, so core/deploy can
// compare what serves with what was published. Both answers of the content endpoint are covered: multipart (one part per module) and a
// single body keyed by its cf-entrypoint header.
test('US-07-R13: liveDigest reads the live script per module, for a multipart answer and for a single body keyed by cf-entrypoint', async () => {
  const { createHash } = await import('node:crypto');
  const hex = (s) => createHash('sha256').update(s).digest('hex');
  const seen = [];
  const multipart = () => { const f = new FormData(); f.append('worker.js', new Blob(['export default {}'], { type: 'application/javascript+module' }), 'worker.js'); f.append('lib.js', new Blob(['export const x = 1;'], { type: 'application/javascript+module' }), 'lib.js'); return new Response(f); };
  const single = () => new Response('export default { fetch() {} }', { headers: { 'content-type': 'application/javascript+module', 'cf-entrypoint': 'index.js' } });
  let answer = multipart;
  const fetch = async (url, init) => { seen.push({ url, method: init.method, auth: init.headers.authorization }); return answer(); };
  const dep = cloudflareDeployer({ fetch, config, env: { CLOUDFLARE_API_TOKEN: 'tkn-value' } });
  assert.deepEqual(await dep.liveDigest('api'), { 'worker.js': hex('export default {}'), 'lib.js': hex('export const x = 1;') });
  assert.equal(seen[0].url, 'https://api.cloudflare.com/client/v4/accounts/acct-123/workers/scripts/api-script/content/v2');
  assert.deepEqual([seen[0].method, seen[0].auth], ['GET', 'Bearer tkn-value']);
  answer = single;
  assert.deepEqual(await dep.liveDigest('api'), { 'index.js': hex('export default { fetch() {} }') });
  answer = () => new Response('nope', { status: 404 });
  await assert.rejects(dep.liveDigest('api'), (e) => /404/.test(e.message) && !e.message.includes('tkn-value'));
  await assert.rejects(cloudflareDeployer({ fetch, config, env: {} }).liveDigest('api'), /token not present/);
});

test('US-07-R13: through the canonical path, a live script equal to the published files keeps the deploy and a different one reverts it', async () => {
  const { createHash } = await import('node:crypto');
  const hex = (s) => createHash('sha256').update(s).digest('hex');
  const { makeDb } = await import('../../../core/_shared/testdb.js');
  const { createDeploy } = await import('../../../core/deploy/index.js');
  const { fileURLToPath } = await import('node:url');
  const MIG = fileURLToPath(new URL('../../../core/deploy/migrations/', import.meta.url));
  for (const tamper of [false, true]) {
    const state = { version: 'ver-1', body: 'old' };
    const fetch = async (url, init) => {
      if (init.method === 'PUT') { state.version = 'ver-2'; state.body = tamper ? 'served by someone else' : await init.body.get('worker.js').text(); return Response.json({ success: true, result: {} }); }
      if (init.method === 'POST') { state.version = JSON.parse(init.body).versions[0].version_id; return Response.json({ success: true, result: {} }); }
      if (url.endsWith('/content/v2')) return new Response(state.body, { headers: { 'content-type': 'application/javascript+module', 'cf-entrypoint': 'worker.js' } });
      return Response.json({ success: true, result: { deployments: [{ versions: [{ version_id: state.version, percentage: 100 }] }] } });
    };
    const dep = cloudflareDeployer({ fetch, config, env: { CLOUDFLARE_API_TOKEN: 'tkn-value' } });
    const db = makeDb([MIG]);
    const d = createDeploy({ db, deployer: dep, fetch: async () => new Response('ok'), sleep: async () => {}, config: { windowMs: 0 } });
    const body = 'export default { fetch() { return new Response("v2"); } }';
    const r = await d.deploy({ unit: 'api', artifact: { body, files: { 'worker.js': hex(body) } }, expectedVersion: 'ver-1' });
    assert.equal(r.status, tamper ? 'reverted' : 'kept', tamper ? 'a live script that differs is reverted' : 'the live script equals the published file');
    const check = db.raw.prepare('SELECT state FROM deploy_digest_checks ORDER BY rowid DESC LIMIT 1').get();
    assert.equal(check.state, tamper ? 'mismatch' : 'match');
  }
});
