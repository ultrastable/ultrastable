// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for the email adapters' read-only probes (US-21-R25). Fake fetch, no network; a probe never delivers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudflareEmail } from './channels/cloudflare-email.js';
import { smtpRelayHttp } from './channels/smtp-relay-http.js';
import { guardPorts } from './port.js';

const fetchOf = (handler) => { const calls = []; const f = async (url, init = {}) => { calls.push({ url: String(url), method: init.method }); const r = handler(String(url)); return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 }); }; f.calls = calls; return f; };

test('US-21-R25: the cloudflare-email probe verifies the token with a GET and never sends', async () => {
  const f = fetchOf(() => ({ json: { success: true, result: { status: 'active' } } }));
  const ch = cloudflareEmail({ fetch: f, config: { accountId: 'acct', from: 'a@example.org' }, env: { EMAIL_PROVIDER_TOKEN: 'tok-secret-12345' } });
  assert.deepEqual(await ch.probe(), { ok: true, detail: 'token active' });
  assert.deepEqual(f.calls, [{ url: 'https://api.cloudflare.com/client/v4/accounts/acct/tokens/verify', method: 'GET' }]);
  const dead = cloudflareEmail({ fetch: fetchOf(() => ({ json: { success: true, result: { status: 'expired' } } })), config: { accountId: 'acct', from: 'a@example.org' }, env: { EMAIL_PROVIDER_TOKEN: 'tok-secret-12345' } });
  await assert.rejects(() => dead.probe(), /token not verified/);
  const bad = cloudflareEmail({ fetch: fetchOf(() => ({ status: 403 })), config: { accountId: 'acct', from: 'a@example.org' }, env: { EMAIL_PROVIDER_TOKEN: 'tok-secret-12345' } });
  await assert.rejects(() => bad.probe(), e => /status 403/.test(e.message) && !e.message.includes('tok-secret'));
  await assert.rejects(() => cloudflareEmail({ fetch: f, config: { accountId: 'a', from: 'x@example.org' }, env: {} }).probe(), /EMAIL_PROVIDER_TOKEN is not set/);
});

test('US-21-R25: the relay adapter has a probe only when the host names an https verify endpoint; guardPorts forwards it', async () => {
  const f = fetchOf(() => ({ json: {} }));
  const cfg = { endpoint: 'https://relay.example.org/send', from: 'a@example.org' };
  assert.equal(smtpRelayHttp({ fetch: f, config: cfg, env: { EMAIL_PROVIDER_TOKEN: 't' } }).probe, undefined);
  assert.equal(smtpRelayHttp({ fetch: f, config: { ...cfg, verifyEndpoint: 'http://relay.example.org/v' }, env: { EMAIL_PROVIDER_TOKEN: 't' } }).probe, undefined);
  const ch = smtpRelayHttp({ fetch: f, config: { ...cfg, verifyEndpoint: 'https://relay.example.org/verify' }, env: { EMAIL_PROVIDER_TOKEN: 't' } });
  assert.deepEqual(await ch.probe(), { ok: true, detail: 'relay reachable' });
  assert.deepEqual(f.calls, [{ url: 'https://relay.example.org/verify', method: 'GET' }]);
  const ports = guardPorts({ channel: ch, senderLine: 'Sent by Example Org' });
  assert.equal(typeof ports.email.probe, 'function');
  assert.equal(guardPorts({ channel: smtpRelayHttp({ fetch: f, config: cfg, env: {} }), senderLine: 'x' }).email.probe, undefined);
});
