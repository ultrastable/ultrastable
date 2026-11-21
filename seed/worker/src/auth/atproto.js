// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// REACH-1: the atproto OAuth profile (Bluesky): PAR + PKCE + DPoP with an ES256 key, nonce retry, DID to PDS resolution. Modules take `fetch` as an argument.
const b64u = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = s => new TextEncoder().encode(s);
const rand = n => b64u(crypto.getRandomValues(new Uint8Array(n)));

export async function newDpopKey() { const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']); return crypto.subtle.exportKey('jwk', k.privateKey); }

export async function dpopProof(jwk, { htm, htu, nonce, access }) {
  const pub = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  const head = { typ: 'dpop+jwt', alg: 'ES256', jwk: pub };
  const body = { jti: rand(12), htm, htu: String(htu).split('#')[0].split('?')[0], iat: Math.floor(Date.now() / 1000) };
  if (nonce) body.nonce = nonce;
  if (access) body.ath = b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc(access))));
  const input = b64u(enc(JSON.stringify(head))) + '.' + b64u(enc(JSON.stringify(body)));
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return input + '.' + b64u(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(input))));
}

// One DPoP request with the server nonce dance: a 400/401 carrying DPoP-Nonce is retried once with that nonce. Returns { res, nonce }.
export async function dpopFetch(f, url, { method = 'POST', headers = {}, body, jwk, nonce, access }) {
  let n = nonce, res;
  for (let i = 0; i < 2; i++) {
    const h = { ...headers, DPoP: await dpopProof(jwk, { htm: method, htu: url, nonce: n, access }) };
    if (access) h.authorization = 'DPoP ' + access;
    res = await f(url, { method, headers: h, body });
    const nn = res.headers && res.headers.get && res.headers.get('dpop-nonce');
    if (nn) n = nn;
    if (i === 0 && nn && (res.status === 400 || res.status === 401) && nn !== nonce) continue;
    break;
  }
  return { res, nonce: n };
}

export async function authServer(issuer, f) {
  const r = await f(issuer.replace(/\/$/, '') + '/.well-known/oauth-authorization-server', { headers: { accept: 'application/json' } });
  const m = r.ok ? await r.json() : null;
  return m && m.pushed_authorization_request_endpoint && m.authorization_endpoint && m.token_endpoint && m.issuer === issuer.replace(/\/$/, '') ? m : null;
}

// did:plc and did:web to the PDS URL, then the PDS must name this issuer as its authorization server (spec: the sub must be bound to the server that issued it).
export async function pdsForDid(did, f) {
  let url = null;
  if (did.startsWith('did:plc:')) url = 'https://plc.directory/' + did;
  else if (did.startsWith('did:web:') && !did.slice(8).includes(':')) url = 'https://' + decodeURIComponent(did.slice(8)) + '/.well-known/did.json';
  if (!url) return null;
  const r = await f(url, { headers: { accept: 'application/json' } });
  const d = r.ok ? await r.json() : null;
  const s = d && (d.service || []).find(x => x.id === '#atproto_pds');
  return s && String(s.serviceEndpoint).startsWith('https://') ? String(s.serviceEndpoint).replace(/\/$/, '') : null;
}
export async function pdsIssuer(pds, f) {
  const r = await f(pds + '/.well-known/oauth-protected-resource', { headers: { accept: 'application/json' } });
  const j = r.ok ? await r.json() : null;
  return j && j.authorization_servers ? j.authorization_servers : [];
}

// CONFIDENTIAL-CLIENT-1 (2026-11-20, atproto OAuth spec, "Tokens and Session Lifetime"): a public client's session and refresh tokens are limited to 2 weeks; a
// confidential client (private_key_jwt) may keep a session without limit and its refresh tokens last up to 180 days. A one-year connection therefore needs a
// client key. The key is generated once, kept sealed, and its public half is served at /.well-known/oauth-client/bluesky-jwks.json.
export async function newClientKey() { const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']); const jwk = await crypto.subtle.exportKey('jwk', k.privateKey); return { ...jwk, kid: 'us-' + rand(6), alg: 'ES256', use: 'sig', key_ops: ['sign'] }; }
export const publicJwk = j => ({ kty: j.kty, crv: j.crv, x: j.x, y: j.y, kid: j.kid, alg: 'ES256', use: 'sig' });
export async function clientAssertion(jwk, { clientId, aud }) {
  const head = { typ: 'JWT', alg: 'ES256', kid: jwk.kid }, t = Math.floor(Date.now() / 1000);
  const input = b64u(enc(JSON.stringify(head))) + '.' + b64u(enc(JSON.stringify({ iss: clientId, sub: clientId, aud, jti: rand(12), iat: t, exp: t + 60 })));
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return input + '.' + b64u(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(input))));
}
export const assertionFields = async (jwk, clientId, aud) => jwk ? { client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: await clientAssertion(jwk, { clientId, aud }) } : {};

// LEGACY-CLIENT-1 (2026-11-21): a session is bound to the client id it was issued to, and the auth server re-reads that client's metadata on every refresh. When
// bluesky.json was switched to private_key_jwt, the live public-client session could no longer refresh (HTTP 400 every hour since 19:11 on 2026-11-20) and posting stopped.
// bluesky.json therefore stays the public client it was when those sessions began; new sign-ins use bluesky-c.json (confidential, 180-day refresh tokens).
export const CLIENT_PATH = { public: '/.well-known/oauth-client/bluesky.json', confidential: '/.well-known/oauth-client/bluesky-c.json' };
export const clientMetadata = (origin, jwk, confidential = false) => ({ client_id: origin + (confidential ? CLIENT_PATH.confidential : CLIENT_PATH.public), client_name: 'Ultrastable', client_uri: origin, application_type: 'web',
  redirect_uris: [origin + '/connect/bluesky/callback'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: 'atproto transition:generic',
  ...(confidential && jwk ? { token_endpoint_auth_method: 'private_key_jwt', token_endpoint_auth_signing_alg: 'ES256', jwks_uri: origin + '/.well-known/oauth-client/bluesky-jwks.json' } : { token_endpoint_auth_method: 'none' }), dpop_bound_access_tokens: true });

export const refreshForm = (refresh, clientId) => new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId }).toString();
