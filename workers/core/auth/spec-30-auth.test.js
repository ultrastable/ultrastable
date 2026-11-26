// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-30 (owner actions and credentials), section 4.5: who the owner is, read from the repository and never typed (OWNER-AUTH-1), and the keyless
// proof that a workflow run belongs to the repository (Actions OIDC). Each test names the requirement it proves (US-00-R03). Keys are generated for the
// test and thrown away; the clock is injected; no network is used (the key set is passed in or fetched from a fake).
import test from 'node:test';
import assert from 'node:assert/strict';
import { roleFor, pickVerifiedEmail, maskEmail, issueSession, readSession, canWrite } from './index.js';
import { verifyOidc, ISSUER } from './actions-oidc.js';

const NOW = Date.parse('2026-11-26T12:00:00Z');

test('US-30-R44: the owner is whoever GitHub says administers the repository, the code goes to the primary verified address read at send time, and the screen shows it masked', () => {
  assert.equal(roleFor({ permission: 'admin' }), 'owner'); assert.equal(roleFor({ orgRole: 'admin' }), 'owner');
  for (const p of ['write', 'maintain', 'read', 'none', undefined]) assert.equal(roleFor({ permission: p }), 'viewer', String(p));
  assert.equal(roleFor(), 'viewer'); assert.equal(roleFor({ orgRole: 'member' }), 'viewer');
  const emails = [{ email: 'a@users.noreply.github.com', verified: true, primary: true }, { email: 'b@example.org', verified: true }, { email: 'c@example.org', verified: true, primary: true }, { email: 'd@example.org', verified: false, primary: true }];
  assert.equal(pickVerifiedEmail(emails), 'c@example.org', 'a primary verified address wins');
  assert.equal(pickVerifiedEmail(emails.filter(e => !e.primary || e.email.startsWith('a'))), 'b@example.org', 'else the first verified one');
  assert.equal(pickVerifiedEmail([emails[0], emails[3]]), null, 'a noreply or unverified address is never used'); assert.equal(pickVerifiedEmail(null), null); assert.equal(pickVerifiedEmail([null, {}]), null);
  assert.equal(maskEmail('alice@example.org'), 'a***@example.org'); assert.equal(maskEmail('not-an-address'), ''); assert.equal(maskEmail(null), '');
});

test('US-30-R44: a session is signed, expires after eight hours, carries only the login and role, and is never accepted when forged, expired, malformed or read without a key', async () => {
  const key = 'k'.repeat(32);
  await assert.rejects(issueSession({ login: 'o', role: 'owner' }), /a session needs a key and a login/); await assert.rejects(issueSession({ key }), /a session needs a key and a login/);
  const tok = await issueSession({ login: 'octocat', role: 'owner', key, now: NOW });
  const s = await readSession(tok, { key, now: NOW + 1000 });
  assert.deepEqual([s.login, s.role, s.exp, canWrite(s)], ['octocat', 'owner', NOW + 8 * 3600e3, true]);
  assert.equal((await readSession(tok, { key, now: NOW + 8 * 3600e3 - 1 })).login, 'octocat'); assert.equal(await readSession(tok, { key, now: NOW + 8 * 3600e3 }), null, 'at the expiry it is over');
  assert.equal((await readSession(await issueSession({ login: 'o', role: 'owner', key, now: NOW, ttlMs: 1000 }), { key, now: NOW + 1001 })), null, 'ttlMs shortens it');
  const [body, sig] = tok.split('.'), forged = Buffer.from(JSON.stringify({ login: 'octocat', role: 'owner', exp: NOW + 99e9 })).toString('base64url');
  for (const bad of [forged + '.' + sig, body + '.' + sig.slice(0, -2) + 'AA', body, '', 'x.y', null]) assert.equal(await readSession(bad, { key, now: NOW }), null, String(bad).slice(0, 12));
  assert.equal(await readSession(tok, { key: 'z'.repeat(32), now: NOW }), null, 'another key never authenticates'); assert.equal(await readSession(tok, { now: NOW }), null, 'no key never authenticates');
  const viewer = await readSession(await issueSession({ login: 'v', role: 'anything-else', key, now: NOW }), { key, now: NOW });
  assert.deepEqual([viewer.role, canWrite(viewer), canWrite(null), canWrite({ role: 'viewer' })], ['viewer', false, false, false], 'any role but owner is a viewer');
});

const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
async function oidc(claims = {}, head = {}, tamper = false) {
  const k = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', k.publicKey)), kid: 'kid-1' };
  const h = b64u({ alg: 'RS256', kid: 'kid-1', ...head }), p = b64u({ iss: ISSUER, aud: 'ultrastable', exp: Math.floor(NOW / 1000) + 300, repository: 'acme/app', ...claims });
  const sig = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k.privateKey, new TextEncoder().encode(h + '.' + p))).toString('base64url');
  return { token: h + '.' + p + '.' + (tamper ? sig.slice(0, -3) + 'AAA' : sig), jwks: [jwk] };
}

test('US-30-R56: a workflow run proves itself with the token GitHub minted for it, no stored secret: signature, issuer, audience, expiry and repository are all checked, and a malformed token is refused before any network call', async () => {
  const ask = { audience: 'ultrastable', repository: 'acme/app', now: NOW };
  const good = await oidc(); const ok = await verifyOidc(good.token, { ...ask, jwks: good.jwks });
  assert.equal(ok.ok, true); assert.equal(ok.claims.repository, 'acme/app');
  let fetched = 0; const f = async () => { fetched++; return { json: async () => ({ keys: [] }) }; };
  for (const t of ['', 'a.b', 'a.b.c.d', 'not.a.jwt', null]) assert.deepEqual(await verifyOidc(t, { ...ask, fetch: f }), { ok: false, reason: 'malformed token' }, String(t));
  assert.equal(fetched, 0, 'nothing is fetched for a token that cannot be read');
  const refuse = async (claims, head, reason, opts = {}) => { const x = await oidc(claims, head, opts.tamper); assert.deepEqual(await verifyOidc(x.token, { ...ask, jwks: opts.jwks ?? x.jwks }), { ok: false, reason }, reason); };
  await refuse({}, { alg: 'HS256' }, 'alg'); await refuse({ iss: 'https://evil.example' }, {}, 'issuer'); await refuse({ aud: 'someone-else' }, {}, 'audience');
  await refuse({ exp: Math.floor(NOW / 1000) - 1 }, {}, 'expired'); await refuse({ exp: 0 }, {}, 'expired'); await refuse({ repository: 'acme/other' }, {}, 'repository');
  await refuse({}, { kid: 'kid-9' }, 'unknown key'); await refuse({}, {}, 'signature', { tamper: true });
  const other = await oidc(); await refuse({}, {}, 'signature', { jwks: other.jwks.map(j => ({ ...j, kid: 'kid-1' })) });
  const urls = []; const g = await oidc(); const viaFetch = await verifyOidc(g.token, { ...ask, fetch: async u => { urls.push(String(u)); return { json: async () => ({ keys: g.jwks }) }; } });
  assert.equal(viaFetch.ok, true); assert.deepEqual(urls, [ISSUER + '/.well-known/jwks'], 'the key set is read from the issuer');
});
