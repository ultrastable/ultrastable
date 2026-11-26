// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-33, the credential-free deploy route: a CI run proves itself with its identity token and the gateway, which alone holds the deploy credential,
// uploads only what a rule allows, reads it back, and answers read-only questions with names, never values. Cloudflare and the issuer's keys are injected fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate } from './index.js';

const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1' };
const ISS = 'https://token.actions.githubusercontent.com', ORIGIN = 'https://gate.example', NOW = 1_800_000_000_000;
async function token(over = {}) {
  const h = enc({ alg: 'RS256', kid: 'k1' }), p = enc({ iss: ISS, aud: ORIGIN, exp: NOW / 1000 + 300, repository: 'org/app', ref: 'refs/heads/main', sha: 'abc', run_id: '7', ...over });
  const sig = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(h + '.' + p))).toString('base64url');
  return h + '.' + p + '.' + sig;
}
function setup({ rule = {}, readStatus = 200, settings = {} } = {}) {
  const calls = [];
  const fetch = async (u, init = {}) => {
    const url = String(u); calls.push({ url, method: init.method || 'GET', body: init.body });
    if (url.endsWith('/.well-known/jwks')) return new Response(JSON.stringify({ keys: [jwk] }));
    if (url.endsWith('/content/v2')) return new Response(readStatus === 200 ? 'BUNDLE' : 'denied', { status: readStatus });
    if (url.endsWith('/settings')) return new Response(JSON.stringify({ result: { bindings: [{ type: 'plain_text', name: 'MODE', text: 'a secret value' }, { type: 'secret_text', name: 'KEY' }], compatibility_date: '2026-10-01', compatibility_flags: ['x'], ...settings } }));
    if (url.includes('/workers/domains')) return new Response(JSON.stringify({ result: [{ hostname: 'app.example' }] }));
    if (/\/(schedules|subdomain|deployments)/.test(url) || url.includes('/d1/')) return new Response(JSON.stringify({ result: { schedules: [{ cron: '*/10 * * * *' }], enabled: true, deployments: [{ id: 'd1', created_on: 'now' }] } }));
    return new Response(JSON.stringify({ success: true, errors: [] }));
  };
  const gate = createGate({ fetch, now: () => NOW, config: { rules: [{ repo: 'org/app', refs: ['refs/heads/main'], script: 'app-web', ...rule }], accountId: 'acct', token: 'cf-secret', readback_waits_ms: [0] } });
  return { gate, calls };
}
const upload = async (gate, tok, script = 'app-web') => { const f = new FormData(); f.append('script', script); f.append('worker.js', new Blob(['BUNDLE']), 'worker.js'); return gate.handle(new Request(ORIGIN + '/deploy', { method: 'POST', headers: tok ? { authorization: 'Bearer ' + tok } : {}, body: f })); };
const metaOf = async (calls) => JSON.parse(await calls.find(c => c.method === 'PUT').body.get('metadata').text());

test('US-33-R98: the deploy gateway answers only POST /deploy and the read-only GET /state and /posture to a run that proves itself, uploads only what its rule allows with only the bindings the rule grants, and reports a deploy it could not read back as unverified', async () => {
  const { gate, calls } = setup();
  assert.equal((await gate.handle(new Request(ORIGIN + '/health'))).status, 200); assert.equal((await gate.handle(new Request(ORIGIN + '/nope'))).status, 404); assert.equal((await gate.handle(new Request(ORIGIN + '/deploy'))).status, 404, 'a deploy is a POST');
  assert.equal((await gate.handle(new Request(ORIGIN + '/state?script=app-web'))).status, 401, 'no token, no read'); assert.equal((await upload(gate, null)).status, 401);
  // the upload: its metadata names exactly what the gateway allows, and the credential never leaves it
  const ok = await upload(gate, await token()); assert.equal(ok.status, 200); const b = await ok.json(); assert.deepEqual([b.deployed, b.verified, b.run, b.sha], [true, true, '7', 'abc']); assert.match(b.sha256, /^[0-9a-f]{64}$/);
  const meta = await metaOf(calls); assert.equal(meta.main_module, 'worker.js'); assert.deepEqual(meta.keep_bindings, ['kv_namespace', 'plain_text', 'secret_text', 'service', 'd1', 'durable_object_namespace', 'send_email', 'ai']); assert.equal(meta.bindings, undefined, 'a rule without ai adds no binding of its own');
  assert.deepEqual(meta.observability, { enabled: true, head_sampling_rate: 1 }); assert.ok(calls.some(c => c.url.endsWith('/subdomain') && c.method === 'POST'), 'a new script answers on workers.dev unless its rule says not');
  const aiRule = setup({ rule: { ai: true, workers_dev: false, compat: '2026-11-01', compat_flags: ['nodejs_compat'] } }); await upload(aiRule.gate, await token());
  const m2 = await metaOf(aiRule.calls); assert.deepEqual(m2.bindings, [{ type: 'ai', name: 'AI' }]); assert.equal(m2.compatibility_date, '2026-11-01'); assert.deepEqual(m2.compatibility_flags, ['nodejs_compat']); assert.ok(!aiRule.calls.some(c => c.url.endsWith('/subdomain')), 'workers_dev: false: no public address is made');
  // a read the token cannot make is reported, never called a mismatch and never called verified
  const noRead = await upload(setup({ readStatus: 403 }).gate, await token()); const nb = await noRead.json(); assert.deepEqual([noRead.status, nb.deployed, nb.verified, nb.readback_status], [200, true, false, 403]);
  // the read-only questions: allowed only for a script a rule names, and a value never leaves
  const s = setup(); const wrong = await s.gate.handle(new Request(ORIGIN + '/state?script=other', { headers: { authorization: 'Bearer ' + await token() } })); assert.equal(wrong.status, 403);
  const st = await (await s.gate.handle(new Request(ORIGIN + '/state?script=app-web', { headers: { authorization: 'Bearer ' + await token() } }))).json();
  assert.deepEqual(st.bindings, [{ type: 'plain_text', name: 'MODE' }, { type: 'secret_text', name: 'KEY' }].sort((a, c) => (a.name + a.type).localeCompare(c.name + c.type))); assert.ok(!JSON.stringify(st).includes('a secret value') && !JSON.stringify(st).includes('cf-secret'), 'names only: no binding value, no secret, no credential');
  assert.deepEqual([st.script, st.found, st.crons], ['app-web', true, ['*/10 * * * *']]); assert.match(st.sha256, /^[0-9a-f]{64}$/);
  const strangerPosture = await s.gate.handle(new Request(ORIGIN + '/posture', { headers: { authorization: 'Bearer ' + await token({ repository: 'org/evil' }) } })); assert.equal(strangerPosture.status, 403);
});
