// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// REACH-1: point-and-click links for the social channels. The owner opens one link and signs in on the service's own page; everything else is behind the scenes.
//   GET /connect                       every channel and service with its status and one button
//   GET /connect/bluesky[/start|/callback]   atproto OAuth: PAR + PKCE + DPoP against bsky.social (or the account's own PDS), no handle, no password, no app password
//   GET /connect/mastodon[/start|/callback]  OAuth with programmatic app registration (POST /api/v1/apps) on any instance, default mastodon.social
//   GET /.well-known/oauth-client/bluesky.json   our atproto client metadata document
// Tokens are sealed per tenant in the credential store; the publisher in ../social.js reads them. Disconnect is handled by the generic connector route.
import * as store from './store.js';
import { html } from '../ui.js';
import { connectorStatus, pkce, safeUrl } from './connectors.js';
import { getToken } from './index.js';
import { connectionsScreen, doneScreen, failScreen } from './consent.js';
import { makeConnectorState, checkConnectorState } from './state.js';
import { newDpopKey, dpopFetch, authServer, pdsForDid, pdsIssuer, clientMetadata, newClientKey, publicJwk, assertionFields } from './atproto.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const form = o => new URLSearchParams(o).toString();
const rand = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const KEY = { bluesky: 'oauth:bluesky', mastodon: 'oauth:mastodon' };
const CLIENT_KEY = 'oauth:bluesky-client';  // the sealed signing key of our atproto client; one per tenant, made on first use, never replaced
async function clientJwk(env, tenant) {
  const m = await store.material(env.DB, env, tenant, CLIENT_KEY);
  if (m && m.secret && m.secret.jwk) return m.secret.jwk;
  const jwk = await newClientKey();
  await store.put(env.DB, env, tenant, CLIENT_KEY, { secret: { jwk }, meta: { kind: 'client-key', kid: jwk.kid }, status: 'ok' });
  return jwk;
}
const host = s => { const h = String(s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''); return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? h : null; };

// CONNECT-ONCE-1: a sign-in that still works is never started again, and a start that arrives twice (a double tap, a browser that fetches the link ahead of
// the tap) continues the sign-in already under way. The second start used to replace the first one's secrets, so the approval that came back matched nothing
// and was answered "already used" with no record. START_REUSE_MS is how long a started sign-in is continued instead of replaced.
export const START_REUSE_MS = { mastodon: 10 * 60 * 1000, bluesky: 60 * 1000 };
const b64url = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const challengeOf = async verifier => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
async function connected(env, tenant, key, f, now) {
  try {
    const m = await store.material(env.DB, env, tenant, key);
    if (!m || m.status === 'pending' || !m.access) return false;
    if (!m.expiresAt && m.status === 'ok') return true;  // a token with no expiry
    return Boolean((await getToken(env.DB, env, tenant, key, { fetch: f, now })).ok);
  } catch (e) { console.error('connect-once', key, e && e.message); return false; }
}
const refused = async (env, tenant, key, title, why, say, retry) => { await store.event(env.DB, tenant, key, 'failed', 'callback: ' + why); return failScreen(title, say, retry); };

const consent = (title, who, will, action, extra = '') => html(title, `<h1>${esc(title)}</h1><div class="card"><b>What happens next</b><ul>${will.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
<p class="mut">One-time approval. The system keeps it renewed and you can disconnect at any time.</p></div>
<form method="GET" action="${esc(action)}"><button type="submit">Continue with ${esc(who)}</button>${extra}</form>
<p class="mut">You sign in on ${esc(who)}'s own page. Nothing to copy, paste or configure.</p>`);
const other = (name, ph) => `<details><summary class="mut">Use a different server</summary><p><input name="${name}" placeholder="${esc(ph)}" aria-label="server"></p></details>`;

export async function handleSocial(request, env, { tenant = 'default', fetch: f = fetch, now = Date.now(), allowInsecure = false } = {}) {
  const url = new URL(request.url), origin = url.origin, path = url.pathname.replace(/\/$/, '');
  if (path === '/.well-known/oauth-client/bluesky-jwks.json') return Response.json({ keys: [publicJwk(await clientJwk(env, tenant))] }, { headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } });
  if (path === '/.well-known/oauth-client/bluesky.json') return Response.json(clientMetadata(origin, await clientJwk(env, tenant)), { headers: { 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' } });
  if (path === '/connect') return connectionsScreen(await connectorStatus(env.DB, env, tenant));
  const m = /^\/connect\/(bluesky|mastodon)(?:\/(start|callback))?$/.exec(path); if (!m) return null;
  const id = m[1], step = m[2] || 'consent', title = id === 'bluesky' ? 'Bluesky' : 'Mastodon', retry = '/connect/' + id;
  try {
    if (step !== 'callback' && await connected(env, tenant, KEY[id], f, now)) return doneScreen(title + ' is connected', 'Nothing to do. The connection is working and the system keeps it renewed.');
    if (step === 'consent') {
      return id === 'bluesky'
        ? consent('Connect Bluesky', 'Bluesky', ['Send you to Bluesky to sign in and approve posting.', 'Store the resulting access sealed, in this system only.', 'Renew it automatically until you disconnect.'], '/connect/bluesky/start', other('server', 'bsky.social'))
        : consent('Connect Mastodon', 'mastodon.social', ['Register Ultrastable as an app on your server, with no setup from you.', 'Send you to the server to sign in and approve posting.', 'Store the access sealed, in this system only.'], '/connect/mastodon/start', other('instance', 'your.instance.example'));
    }
    if (id === 'mastodon') return mastodon(step, url, origin, env, tenant, f, now, allowInsecure, retry);
    return bluesky(step, url, origin, env, tenant, f, now, allowInsecure, retry);
  } catch (e) {
    try { await store.event(env.DB, tenant, KEY[id], 'failed', String(e && e.message || e)); } catch (_) { console.error('social event', e && e.message); }
    console.error('social', e && e.message);
    return failScreen('Connect ' + title, 'Something went wrong. The system recorded it and you can try again.', retry);
  }
}

async function mastodon(step, url, origin, env, tenant, f, now, insecure, retry) {
  const key = KEY.mastodon, redirect = origin + '/connect/mastodon/callback';
  if (step === 'start') {
    const inst = host(url.searchParams.get('instance')) || 'mastodon.social', base = 'https://' + inst;
    if (!safeUrl(base, insecure)) return failScreen('Connect Mastodon', 'That does not look like a public server address.', retry);
    const prev = await store.material(env.DB, env, tenant, key), pp = prev && prev.status === 'pending' && prev.secret && prev.secret.pending;
    if (pp && pp.at && now - pp.at < START_REUSE_MS.mastodon && prev.meta.instance === inst && prev.meta.client_id) {
      const state = await makeConnectorState(env, tenant, key, pp.nonce, now);
      return Response.redirect(base + '/oauth/authorize?' + form({ response_type: 'code', client_id: prev.meta.client_id, redirect_uri: redirect, scope: 'write:statuses profile', state, code_challenge: await challengeOf(pp.verifier), code_challenge_method: 'S256' }), 302);
    }
    const r = await f(base + '/api/v1/apps', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_name: 'Ultrastable', redirect_uris: redirect, scopes: 'write:statuses profile', website: origin }) });
    const app = r.ok ? await r.json() : null;
    if (!app || !app.client_id) return failScreen('Connect Mastodon', inst + ' did not accept the registration.', retry);
    const { verifier, challenge } = await pkce(), nonce = rand(8);
    await store.put(env.DB, env, tenant, key, { secret: { client_secret: app.client_secret, pending: { nonce, verifier, at: now } }, meta: { kind: 'oauth', provider: 'mastodon', instance: inst, token_url: base + '/oauth/token', client_id: app.client_id }, status: 'pending' });
    const state = await makeConnectorState(env, tenant, key, nonce, now);
    await store.event(env.DB, tenant, key, 'consent', 'registered on ' + inst);
    return Response.redirect(base + '/oauth/authorize?' + form({ response_type: 'code', client_id: app.client_id, redirect_uri: redirect, scope: 'write:statuses profile', state, code_challenge: challenge, code_challenge_method: 'S256' }), 302);
  }
  const st = await checkConnectorState(env, url.searchParams.get('state'), now);
  if (!st || st.t !== tenant) return refused(env, tenant, key, 'Connect Mastodon', 'state expired or for another tenant', 'That approval link expired.', retry);
  if (url.searchParams.get('error')) return refused(env, tenant, key, 'Connect Mastodon', 'provider answered ' + String(url.searchParams.get('error')).replace(/[^a-z_]/g, '').slice(0, 40), 'The approval was not completed.', retry);
  const cur = await store.material(env.DB, env, tenant, key);
  if (!cur || !cur.secret || !cur.secret.pending || cur.secret.pending.nonce !== st.n) return refused(env, tenant, key, 'Connect Mastodon', 'approval does not match the sign-in under way', 'That approval link was already used.', retry);
  const r = await f(cur.meta.token_url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: redirect, client_id: cur.meta.client_id, client_secret: cur.secret.client_secret, code_verifier: cur.secret.pending.verifier }) });
  const j = r.ok ? await r.json() : null;
  if (!j || !j.access_token) { await store.event(env.DB, tenant, key, 'failed', 'token exchange HTTP ' + r.status); return failScreen('Connect Mastodon', 'The server did not finish the connection.', retry); }
  await store.put(env.DB, env, tenant, key, { secret: { client_secret: cur.secret.client_secret }, access: j.access_token, status: 'ok', error: null });  // Mastodon tokens do not expire; revoked on the server by disconnecting there
  await store.event(env.DB, tenant, key, 'connected', cur.meta.instance);
  return doneScreen('Mastodon connected', 'Done. The system now posts for you on ' + cur.meta.instance + '.');
}

async function bluesky(step, url, origin, env, tenant, f, now, insecure, retry) {
  const key = KEY.bluesky, cid = origin + '/.well-known/oauth-client/bluesky.json', redirect = origin + '/connect/bluesky/callback';
  if (step === 'start') {
    const srv = host(url.searchParams.get('server')) || 'bsky.social', issuer = 'https://' + srv;
    if (!safeUrl(issuer, insecure)) return failScreen('Connect Bluesky', 'That does not look like a public server address.', retry);
    const prev = await store.material(env.DB, env, tenant, key), pp = prev && prev.status === 'pending' && prev.secret && prev.secret.pending;
    if (pp && pp.at && pp.go && now - pp.at < START_REUSE_MS.bluesky && prev.meta.issuer === issuer) return Response.redirect(pp.go, 302);
    const as = await authServer(issuer, f);
    if (!as) return failScreen('Connect Bluesky', srv + ' does not offer sign-in for apps.', retry);
    const jwk = await newDpopKey(), { verifier, challenge } = await pkce(), nonce = rand(8);
    const state = await makeConnectorState(env, tenant, key, nonce, now);
    const ck = await clientJwk(env, tenant);
    const par = await dpopFetch(f, as.pushed_authorization_request_endpoint, { headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, jwk,
      body: form({ ...(await assertionFields(ck, cid, as.issuer)), client_id: cid, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state, redirect_uri: redirect, scope: 'atproto transition:generic' }) });
    const pj = par.res.ok || par.res.status === 201 ? await par.res.json() : null;
    if (!pj || !pj.request_uri) { await store.event(env.DB, tenant, key, 'failed', 'PAR HTTP ' + par.res.status); return failScreen('Connect Bluesky', 'Bluesky did not accept the request.', retry); }
    await store.put(env.DB, env, tenant, key, { secret: { dpop_jwk: jwk, nonce: par.nonce || null, pending: { nonce, verifier, at: now, go: as.authorization_endpoint + '?' + form({ client_id: cid, request_uri: pj.request_uri }) } }, meta: { kind: 'oauth', provider: 'bluesky', issuer: as.issuer, token_url: as.token_endpoint, client_id: cid }, status: 'pending' });
    await store.event(env.DB, tenant, key, 'consent', 'redirected to ' + srv);
    return Response.redirect(as.authorization_endpoint + '?' + form({ client_id: cid, request_uri: pj.request_uri }), 302);
  }
  const st = await checkConnectorState(env, url.searchParams.get('state'), now);
  if (!st || st.t !== tenant) return refused(env, tenant, key, 'Connect Bluesky', 'state expired or for another tenant', 'That approval link expired.', retry);
  if (url.searchParams.get('error')) return refused(env, tenant, key, 'Connect Bluesky', 'provider answered ' + String(url.searchParams.get('error')).replace(/[^a-z_]/g, '').slice(0, 40), 'The approval was not completed.', retry);
  const cur = await store.material(env.DB, env, tenant, key);
  if (!cur || !cur.secret || !cur.secret.pending || cur.secret.pending.nonce !== st.n) return refused(env, tenant, key, 'Connect Bluesky', 'approval does not match the sign-in under way', 'That approval link was already used.', retry);
  if (url.searchParams.get('iss') !== cur.meta.issuer) return failScreen('Connect Bluesky', 'The answer came from an unexpected server.', retry);
  const ck = await clientJwk(env, tenant);
  const tok = await dpopFetch(f, cur.meta.token_url, { headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, jwk: cur.secret.dpop_jwk, nonce: cur.secret.nonce,
    body: form({ ...(await assertionFields(ck, cid, cur.meta.issuer)), grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: redirect, client_id: cid, code_verifier: cur.secret.pending.verifier }) });
  const j = tok.res.ok ? await tok.res.json() : null;
  if (!j || !j.access_token || !j.sub) { await store.event(env.DB, tenant, key, 'failed', 'token exchange HTTP ' + tok.res.status); return failScreen('Connect Bluesky', 'Bluesky did not finish the connection.', retry); }
  const pds = await pdsForDid(j.sub, f);
  if (!pds || !(await pdsIssuer(pds, f)).includes(cur.meta.issuer)) { await store.event(env.DB, tenant, key, 'failed', 'sub not bound to issuer'); return failScreen('Connect Bluesky', 'That account does not belong to the server that approved it.', retry); }
  await store.put(env.DB, env, tenant, key, { secret: { dpop_jwk: cur.secret.dpop_jwk, client_jwk: ck, nonce: tok.nonce || null, refresh_token: j.refresh_token || null }, meta: { did: j.sub, pds }, access: j.access_token, expiresAt: now + (Number(j.expires_in) || 1800) * 1000, status: 'ok', error: null });
  await store.event(env.DB, tenant, key, 'connected', j.sub);
  return doneScreen('Bluesky connected', 'Done. The system now posts for you on Bluesky and keeps the connection renewed.');
}
