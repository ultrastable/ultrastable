// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate } from './index.js';

const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1' };
const ISS = 'https://token.actions.githubusercontent.com', ORIGIN = 'https://gate.example';
const NOW = 1_800_000_000_000;
async function token(over = {}, key = kp.privateKey) {
  const h = enc({ alg: 'RS256', kid: 'k1' }), p = enc({ iss: ISS, aud: ORIGIN, exp: NOW / 1000 + 300, repository: 'org/app', ref: 'refs/heads/main', sha: 'abc', run_id: '7', ...over });
  const sig = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + p))).toString('base64url');
  return h + '.' + p + '.' + sig;
}
function setup({ cfOk = true, readBack = true, readStatus = 200, multipart = false, rule = {} } = {}) {
  const calls = [];
  const fetch = async (u, init = {}) => {
    calls.push({ u: String(u), method: init.method || 'GET', body: init.body });
    if (String(u).endsWith('/.well-known/jwks')) return new Response(JSON.stringify({ keys: [jwk] }));
    if (String(u).endsWith('/content/v2')) return new Response(!readBack ? 'other' : multipart ? '--b\r\nContent-Disposition: form-data; name="worker.js"\r\n\r\nBUNDLE\r\n--b--\r\n' : 'BUNDLE', { status: readStatus });
    return new Response(JSON.stringify({ success: cfOk, errors: [] }), { status: cfOk ? 200 : 400 });
  };
  const gate = createGate({ fetch, now: () => NOW, config: { rules: [{ repo: 'org/app', refs: ['refs/heads/main'], script: 'app-web', ...rule }], accountId: 'acct', token: 't' } });
  return { gate, calls };
}
async function post(gate, tok, script = 'app-web') {
  const f = new FormData(); f.append('script', script); f.append('worker.js', new Blob(['BUNDLE']), 'worker.js');
  return gate.handle(new Request(ORIGIN + '/deploy', { method: 'POST', headers: tok ? { authorization: 'Bearer ' + tok } : {}, body: f }));
}

test('a valid run token for an allowed repo, ref and script deploys and reads back', async () => {
  const { gate, calls } = setup(); const r = await post(gate, await token());
  assert.equal(r.status, 200); const b = await r.json();
  assert.equal(b.deployed, true); assert.equal(b.run, '7'); assert.match(b.sha256, /^[0-9a-f]{64}$/);
  assert.ok(calls.some(c => c.method === 'PUT'));
});
test('no token, wrong audience, expired and forged tokens are refused before any upload', async () => {
  const { gate, calls } = setup();
  assert.equal((await post(gate, null)).status, 401);
  assert.equal((await post(gate, await token({ aud: 'https://other' }))).status, 401);
  assert.equal((await post(gate, await token({ exp: NOW / 1000 - 5 }))).status, 401);
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  assert.equal((await post(gate, await token({}, other.privateKey))).status, 401);
  assert.ok(!calls.some(c => c.method === 'PUT'));
});
test('another repo, another ref or another script is forbidden', async () => {
  const { gate, calls } = setup();
  assert.equal((await post(gate, await token({ repository: 'org/evil' }))).status, 403);
  assert.equal((await post(gate, await token({ ref: 'refs/heads/feature' }))).status, 403);
  assert.equal((await post(gate, await token(), 'other-script')).status, 403);
  assert.ok(!calls.some(c => c.method === 'PUT'));
});
test('a failed upload or a read-back mismatch is an error, never reported as deployed', async () => {
  assert.equal((await post(setup({ cfOk: false }).gate, await token())).status, 502);
  assert.equal((await post(setup({ readBack: false }).gate, await token())).status, 502);
});
test('read-back: a multipart copy verifies; a read the token cannot make is deployed but unverified, never a mismatch', async () => {
  const ok = await post(setup({ multipart: true }).gate, await token());
  assert.equal(ok.status, 200); assert.equal((await ok.json()).verified, true);
  const un = await post(setup({ readStatus: 403 }).gate, await token());
  assert.equal(un.status, 200); const j = await un.json(); assert.equal(j.verified, false); assert.equal(j.readback_status, 403);
});
test('per-rule compatibility flags are sent and send_email bindings are kept', async () => {
  const { gate, calls } = setup({ rule: { compat_flags: ['nodejs_compat'] } });
  assert.equal((await post(gate, await token())).status, 200);
  const meta = JSON.parse(await calls.find(c => c.method === 'PUT').body.get('metadata').text());
  assert.deepEqual(meta.compatibility_flags, ['nodejs_compat']);
  assert.ok(meta.keep_bindings.includes('send_email'));
});

test('a rule with ai: true adds the Workers AI binding; without it no binding is added', async () => {
  const meta = async rule => { const { gate, calls } = setup({ rule }); await post(gate, await token()); return JSON.parse(await calls.find(c => c.method === 'PUT').body.get('metadata').text()); };
  assert.deepEqual((await meta({ ai: true })).bindings, [{ type: 'ai', name: 'AI' }]);
  assert.equal((await meta({})).bindings, undefined);
  assert.equal((await meta({ ai: 'yes' })).bindings, undefined);
});

test('a deploy enables workers.dev unless the rule sets workers_dev: false', async () => {
  const on = setup(); assert.equal((await post(on.gate, await token())).status, 200);
  const sd = on.calls.find(c => c.u.endsWith('/subdomain'));
  assert.equal(sd.method, 'POST'); assert.deepEqual(JSON.parse(sd.body), { enabled: true, previews_enabled: false });
  const off = setup({ rule: { workers_dev: false } }); assert.equal((await post(off.gate, await token())).status, 200);
  assert.equal(off.calls.some(c => c.u.endsWith('/subdomain')), false);
});

test('GET /state returns names and hashes for an allowed script, refuses others, and never returns values', async () => {
  const fetch = async u => {
    u = String(u);
    if (u.endsWith('/.well-known/jwks')) return new Response(JSON.stringify({ keys: [jwk] }));
    if (u.endsWith('/content/v2')) return new Response('BUNDLE');
    if (u.endsWith('/settings')) return new Response(JSON.stringify({ result: { compatibility_date: '2026-10-01', bindings: [{ type: 'secret_text', name: 'TOKEN', text: 'hunter2' }, { type: 'd1', name: 'DB', id: 'x' }] } }));
    if (u.endsWith('/schedules')) return new Response(JSON.stringify({ result: { schedules: [{ cron: '*/10 * * * *' }] } }));
    if (u.endsWith('/subdomain')) return new Response(JSON.stringify({ result: { enabled: true } }));
    if (u.includes('/workers/domains')) return new Response(JSON.stringify({ result: [{ hostname: 'app.example' }] }));
    if (u.endsWith('/workers/routes')) return new Response(JSON.stringify({ result: [{ pattern: 'app.example/*', script: 'app-web' }, { pattern: 'x/*', script: 'other' }] }));
    if (u.endsWith('/query')) return new Response(JSON.stringify({ result: [{ results: [{ file: '0001_a' }] }] }));
    if (u.endsWith('/deployments')) return new Response(JSON.stringify({ result: { deployments: [{ id: 'dep1', created_on: 't' }] } }));
    return new Response('{}', { status: 404 });
  };
  const gate = createGate({ fetch, now: () => NOW, config: { rules: [{ repo: 'org/app', refs: ['refs/heads/main'], script: 'app-web', zones: ['z1'], d1: ['db1'] }], accountId: 'acct', token: 't' } });
  const get = async (tok, script = 'app-web') => gate.handle(new Request(ORIGIN + '/state?script=' + script, { headers: tok ? { authorization: 'Bearer ' + tok } : {} }));
  const ok = await get(await token()); assert.equal(ok.status, 200);
  const body = await ok.text(); assert.ok(!body.includes('hunter2')); const s = JSON.parse(body);
  assert.equal(s.found, true); assert.match(s.sha256, /^[0-9a-f]{64}$/); assert.deepEqual(s.crons, ['*/10 * * * *']);
  assert.deepEqual(s.bindings, [{ type: 'd1', name: 'DB' }, { type: 'secret_text', name: 'TOKEN' }]); assert.equal(s.workers_dev, true);
  assert.deepEqual(s.domains, ['app.example']); assert.deepEqual(s.routes, ['app.example/*']); assert.deepEqual(s.migrations, { db1: ['0001_a'] });
  assert.equal((await get(null)).status, 401);
  assert.equal((await get(await token(), 'other')).status, 403);
  assert.equal((await get(await token({ repository: 'org/evil' }))).status, 403);
});
