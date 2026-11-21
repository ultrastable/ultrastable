// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// CONNECT-1: link any service the way Google and Microsoft do it: one consent click, a callback, tokens sealed per tenant, refresh and revoke by the system. Nobody pastes a token.
//   GET  /connect/<provider>            consent screen (what will happen, one button)
//   GET  /connect/<provider>/start      PKCE + signed state, redirect to the provider's own consent page
//   GET  /connect/<provider>/callback   code exchange, sealed storage, done screen
//   POST /connect/<provider>/disconnect revoke at the provider (RFC 7009 when offered) and delete the sealed credential
//   GET  /connect/mcp?server=<url>      remote MCP server as client: RFC 9728 discovery, RFC 8414 metadata, PKCE, CIMD or DCR registration
//   GET  /auth/connectors               JSON status listing for the dashboard (no secrets)
//   GET  /.well-known/oauth-client/ultrastable.json   our Client ID Metadata Document
// Registered providers need an OAuth app only when the provider has no open registration; that is the single owner card 'oauth-apps' (IDENTITY-BOUND). MCP servers need none.
import * as store from './store.js';
import { consentScreen, doneScreen, failScreen, connectionsScreen } from './consent.js';
import { makeConnectorState, checkConnectorState } from './state.js';

export const REGISTRY = {
  google: { title: 'Google', type: 'oauth', authorize: 'https://accounts.google.com/o/oauth2/v2/authorize', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke',
    scopes: ['openid', 'email', 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/calendar.events'], extra: { access_type: 'offline', prompt: 'consent' }, env: 'OAUTH_GOOGLE' },
  microsoft: { title: 'Microsoft', type: 'oauth', authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['offline_access', 'openid', 'email', 'User.Read', 'Files.ReadWrite', 'Calendars.ReadWrite'], extra: {}, env: 'OAUTH_MICROSOFT' },
  buffer: { title: 'Buffer', type: 'oauth', authorize: 'https://auth.buffer.com/auth', token: 'https://auth.buffer.com/token', scopes: ['posts:read', 'posts:write', 'account:read', 'offline_access'], extra: { prompt: 'consent' }, env: 'OAUTH_BUFFER', dcr: 'https://auth.buffer.com/reg' },  // SOCIAL-MODULE-1: Buffer's own OAuth 2 (authorization code with PKCE, public client: no secret). The app registers itself at Buffer's registration endpoint (RFC 7591), so no owner step exists
  linkedin: { title: 'LinkedIn', type: 'oauth', authorize: 'https://www.linkedin.com/oauth/v2/authorization', token: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: ['openid', 'profile', 'w_member_social'], extra: {}, env: 'OAUTH_LINKEDIN' },  // THOUGHT-1: posts white papers on the owner's own LinkedIn; tokens last 60 days with no refresh, so getToken reports expiry
  bluesky: { title: 'Bluesky', type: 'social', connect: '/connect/bluesky' },  // REACH-1: atproto OAuth in social.js
  mastodon: { title: 'Mastodon', type: 'social', connect: '/connect/mastodon' },  // REACH-1: app registration + OAuth in social.js
  github: { title: 'GitHub', type: 'github-app', connect: '/connect/github' },  // the GitHub App manifest flow in routes.js
  mcp: { title: 'Remote MCP server', type: 'mcp' },
};
export const providerKey = id => 'oauth:' + id;
export const mcpKey = server => 'oauth:mcp:' + new URL(server).host;

const form = o => new URLSearchParams(o).toString();
const rand = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const b64u = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const pkce = async () => { const verifier = b64u(crypto.getRandomValues(new Uint8Array(32))); return { verifier, challenge: b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))) }; };

// Outbound fetches only to public https hosts (SSRF guard); tests may pass allowInsecure for a fake provider on localhost. // server-side only: SSRF guard, loopback is rejected, never a host
export function safeUrl(u, allowInsecure = false) {
  let x; try { x = new URL(u); } catch (_) { return null; }
  if (allowInsecure) return x;
  const h = x.hostname;
  if (x.protocol !== 'https:' || x.username || x.password) return null;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || !h.includes('.')) return null; // server-side only: SSRF guard, loopback is rejected, never a host
  return x;
}

const appCreds = (env, def) => ({ id: env[def.env + '_CLIENT_ID'] || null, secret: env[def.env + '_CLIENT_SECRET'] || null });
const cimdUrl = origin => origin + '/.well-known/oauth-client/ultrastable.json';
export const cimdDocument = origin => ({ client_id: cimdUrl(origin), client_name: 'Ultrastable', client_uri: origin, redirect_uris: [origin + '/connect/mcp/callback'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' });

// ---- MCP authorization, client side: find the authorization server for a resource, then a client identity for it ----
async function getJson(f, url, init) { const r = await f(url, { headers: { accept: 'application/json' }, ...(init || {}) }); return r.ok ? r.json() : null; }
export async function discoverMcp(server, { fetch: f = fetch, allowInsecure = false } = {}) {
  const su = safeUrl(server, allowInsecure); if (!su) return { ok: false, error: 'server must be a public https URL' };
  let prmUrl = null;
  try {  // 1. an unauthenticated request answers 401 with resource_metadata in WWW-Authenticate (RFC 9728 s5.1)
    const r = await f(su.href, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
    const m = /resource_metadata="([^"]+)"/.exec((r.headers && r.headers.get && r.headers.get('www-authenticate')) || ''); if (m) prmUrl = m[1];
  } catch (_) { /* fall back to the well-known paths */ }
  const cands = prmUrl ? [prmUrl] : [`${su.origin}/.well-known/oauth-protected-resource${su.pathname === '/' ? '' : su.pathname}`, `${su.origin}/.well-known/oauth-protected-resource`];
  let prm = null; for (const c of cands) { if (!safeUrl(c, allowInsecure)) continue; prm = await getJson(f, c); if (prm && prm.authorization_servers) break; prm = null; }
  const asUrl = prm && prm.authorization_servers && prm.authorization_servers[0] || su.origin;  // no metadata: the server may be its own authorization server
  const asu = safeUrl(asUrl, allowInsecure); if (!asu) return { ok: false, error: 'authorization server is not a public https URL' };
  const p = asu.pathname === '/' ? '' : asu.pathname.replace(/\/$/, '');
  let meta = null;  // 2. RFC 8414, then OpenID Connect discovery
  for (const c of [`${asu.origin}/.well-known/oauth-authorization-server${p}`, `${asu.origin}/.well-known/openid-configuration${p}`, `${asu.origin}${p}/.well-known/openid-configuration`]) { meta = await getJson(f, c); if (meta && meta.authorization_endpoint && meta.token_endpoint) break; meta = null; }
  if (!meta) return { ok: false, error: 'no authorization server metadata found' };
  if (meta.code_challenge_methods_supported && !meta.code_challenge_methods_supported.includes('S256')) return { ok: false, error: 'server does not support PKCE S256' };
  return { ok: true, resource: (prm && prm.resource) || su.href, scopes: (prm && prm.scopes_supported) || [], as: meta };
}

async function registerClient(d, origin, f) {  // 3. Client ID Metadata Document when the server accepts it, dynamic registration otherwise; no owner step in either
  if (d.as.client_id_metadata_document_supported) return { ok: true, client_id: cimdUrl(origin), method: 'cimd' };
  if (!d.as.registration_endpoint) return { ok: false, error: 'server offers neither client metadata documents nor dynamic registration; it needs a registered app (owner card oauth-apps)' };
  const r = await f(d.as.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ client_name: 'Ultrastable', redirect_uris: [origin + '/connect/mcp/callback'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
  if (!r.ok) return { ok: false, error: 'dynamic registration HTTP ' + r.status };
  const j = await r.json(); return j.client_id ? { ok: true, client_id: j.client_id, client_secret: j.client_secret || null, method: 'dcr' } : { ok: false, error: 'registration returned no client_id' };
}

// ---- status listing for the dashboard: what is linked, what is waiting on the owner's one app registration ----
export async function connectorStatus(db, env, tenant) {
  await store.ensureSchema(db);
  const rows = (await db.prepare("SELECT provider, status, expires_at, last_error, updated_at, meta FROM credentials WHERE tenant = ?").bind(tenant).all()).results || [];
  const linked = rows.filter(r => r.provider.startsWith('oauth:') || r.provider === 'github-app').map(r => { const m = JSON.parse(r.meta || '{}'); return { provider: r.provider, kind: m.kind || (r.provider === 'github-app' ? 'github-app' : 'oauth'), server: m.server || null, status: r.status, expires_at: r.expires_at, last_error: r.last_error, updated_at: r.updated_at }; });
  const available = Object.entries(REGISTRY).map(([id, d]) => ({ id, title: d.title, type: d.type, connect: d.connect || '/connect/' + id,
    ready: d.type === 'oauth' ? !!(appCreds(env, d).id || d.dcr) : true, needs: d.type === 'oauth' && !d.dcr && !appCreds(env, d).id ? 'oauth-apps (owner registers the app once; the Worker does the rest)' : null,
    linked: linked.some(l => l.provider === providerKey(id) || (id === 'github' && l.provider === 'github-app')) }));
  return { linked, available };
}

export async function disconnect(db, env, tenant, provider, f = fetch) {
  const m = await store.material(db, env, tenant, provider); if (!m) return { ok: false, error: 'not connected' };
  let revoked = false; const rev = m.meta.revoke;
  if (rev && m.secret && m.secret.refresh_token) { try { const r = await f(rev, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ token: m.secret.refresh_token, client_id: m.meta.client_id }) }); revoked = r.ok; } catch (_) { /* local removal still happens */ } }
  await db.prepare('DELETE FROM credentials WHERE tenant = ? AND provider = ?').bind(tenant, provider).run();
  await store.event(db, tenant, provider, 'disconnected', revoked ? 'revoked at provider' : 'removed locally');
  return { ok: true, revoked };
}


// SOCIAL-MODULE-1: a provider with a registration endpoint (RFC 7591) gets its app registered by the Worker itself, once per redirect address, and the client id is kept.
async function dynamicClient(env, tenant, def, redirect, f) {
  const key = 'oauth:' + def.title.toLowerCase() + '-client', m = await store.material(env.DB, env, tenant, key);
  if (m && m.meta && m.meta.redirect === redirect && m.meta.client_id) return { ok: true, client_id: m.meta.client_id };
  const r = await f(def.dcr, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ client_name: 'Ultrastable', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
  if (!r.ok) { let b = ''; try { b = (await r.text()).replace(/\s+/g, ' ').slice(0, 160); } catch (_) { /* body unreadable, status still recorded */ } try { await store.event(env.DB, tenant, 'oauth:' + def.title.toLowerCase(), 'failed', 'registration HTTP ' + r.status + ' ' + b); } catch (_) { /* event log unavailable, error still returned */ } return { ok: false, error: 'registration HTTP ' + r.status }; }
  const j = await r.json(); if (!j.client_id) return { ok: false, error: 'registration returned no client_id' };
  await store.put(env.DB, env, tenant, key, { secret: { registered: true }, meta: { client_id: j.client_id, redirect }, status: 'ok' });
  return { ok: true, client_id: j.client_id };
}

const screenFor = (def, title, will) => ({ provider: def.title, title: 'Connect ' + title, button: 'Authorize on ' + def.title, will, why: 'This is a one-time approval. The system keeps access renewed and you can disconnect at any time.' });

export async function handleConnector(request, env, { tenant = 'default', fetch: f = fetch, now = Date.now(), allowInsecure = false } = {}) {
  const url = new URL(request.url), origin = url.origin, path = url.pathname;
  if (path === '/.well-known/oauth-client/ultrastable.json') return Response.json(cimdDocument(origin), { headers: { 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' } });
  if (path === '/connections') return connectionsScreen(await connectorStatus(env.DB, env, tenant));
  if (path === '/auth/connectors') return Response.json(await connectorStatus(env.DB, env, tenant));
  const m = /^\/connect\/([a-z0-9-]+)(?:\/(start|callback|disconnect))?$/.exec(path); if (!m) return null;
  const id = m[1], step = m[2] || 'consent', def = REGISTRY[id]; if (!def || def.type === 'github-app') return null;
  const retry = '/connect/' + id;
  try {
    if (step === 'disconnect') {
      if (request.method !== 'POST') return new Response('Use POST', { status: 405, headers: { allow: 'POST' } });
      const key = id === 'mcp' ? url.searchParams.get('provider') : providerKey(id);
      const r = await disconnect(env.DB, env, tenant, key, f); return r.ok ? doneScreen('Disconnected', def.title + ' is disconnected' + (r.revoked ? ' and its access was revoked.' : '.')) : failScreen('Disconnect', r.error, '/');
    }
    if (step === 'consent') {
      if (def.type === 'oauth' && !def.dcr && !appCreds(env, def).id) return failScreen('Connect ' + def.title, 'This connection is waiting for its one-time app registration, which the owner card "oauth-apps" tracks. Nothing is needed from you here.', '/');
      if (id === 'mcp') { const s = url.searchParams.get('server'); if (!safeUrl(s || '', allowInsecure)) return failScreen('Connect an MCP server', 'Give the address of a public https MCP server.', '/'); }
      const q = id === 'mcp' ? '?server=' + encodeURIComponent(url.searchParams.get('server')) : '';
      const host = id === 'mcp' ? new URL(url.searchParams.get('server')).host : def.title;
      return consentScreen({ ...screenFor(def, host, [`Send you to ${host} to sign in and approve access.`, 'Store the resulting access sealed, in this system only.', 'Renew it automatically until you disconnect.']), action: { method: 'GET', url: `/connect/${id}/start`, fields: id === 'mcp' ? { server: url.searchParams.get('server') } : {} } });
    }
    if (step === 'start') {
      let meta, key, authz, scopes, extra = {}, secret = {};
      if (id === 'mcp') {
        const server = url.searchParams.get('server'), d = await discoverMcp(server, { fetch: f, allowInsecure }); if (!d.ok) return failScreen('Connect an MCP server', d.error, retry);
        const reg = await registerClient(d, origin, f); if (!reg.ok) return failScreen('Connect an MCP server', reg.error, retry);
        key = mcpKey(server); authz = d.as.authorization_endpoint; scopes = d.scopes; extra = { resource: d.resource };
        meta = { kind: 'mcp', server, resource: d.resource, token_url: d.as.token_endpoint, revoke: d.as.revocation_endpoint || null, client_id: reg.client_id, scopes, registration: reg.method };
        if (reg.client_secret) secret.client_secret = reg.client_secret;
      } else {
        const c = appCreds(env, def); if (!c.id && def.dcr) { const d = await dynamicClient(env, tenant, def, `${origin}/connect/${id}/callback`, f); if (!d.ok) return failScreen('Connect ' + def.title, 'The system could not register with ' + def.title + ' and will retry on its own.', retry); c.id = d.client_id; }
        if (!c.id) return failScreen('Connect ' + def.title, 'Waiting for the one-time app registration (owner card oauth-apps).', '/');
        key = providerKey(id); authz = def.authorize; scopes = def.scopes; extra = def.extra;
        meta = { kind: 'oauth', provider: id, token_url: def.token, revoke: def.revoke || null, client_id: c.id, scopes }; if (c.secret) secret.client_secret = c.secret;
      }
      const { verifier, challenge } = await pkce(), nonce = rand(8);
      await store.put(env.DB, env, tenant, key, { secret: { ...secret, pending: { nonce, verifier } }, meta, status: 'pending' });
      const state = await makeConnectorState(env, tenant, key, nonce, now);
      const q = { response_type: 'code', client_id: meta.client_id, redirect_uri: `${origin}/connect/${id}/callback`, state, code_challenge: challenge, code_challenge_method: 'S256', ...extra };
      if (scopes && scopes.length) q.scope = scopes.join(' ');
      await store.event(env.DB, tenant, key, 'consent', 'redirected to ' + new URL(authz).host);
      return Response.redirect(authz + (authz.includes('?') ? '&' : '?') + form(q), 302);
    }
    // callback
    const st = await checkConnectorState(env, url.searchParams.get('state'), now);
    if (!st || st.t !== tenant) return failScreen('Connect ' + def.title, 'That approval link expired.', retry);
    if (url.searchParams.get('error')) { await store.event(env.DB, tenant, st.p, 'failed', 'provider said ' + url.searchParams.get('error')); return failScreen('Connect ' + def.title, 'The approval was not completed.', retry); }
    const cur = await store.material(env.DB, env, tenant, st.p);
    if (!cur || !cur.secret || !cur.secret.pending || cur.secret.pending.nonce !== st.n) return failScreen('Connect ' + def.title, 'That approval link was already used.', retry);  // one-time nonce
    const body = { grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: `${origin}/connect/${id}/callback`, client_id: cur.meta.client_id, code_verifier: cur.secret.pending.verifier };
    if (cur.secret.client_secret) body.client_secret = cur.secret.client_secret;
    if (cur.meta.resource) body.resource = cur.meta.resource;
    const r = await f(cur.meta.token_url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form(body) });
    const j = r.ok ? await r.json() : null;
    if (!j || !j.access_token) { await store.event(env.DB, tenant, st.p, 'failed', 'token exchange HTTP ' + r.status); return failScreen('Connect ' + def.title, 'The service did not finish the connection.', retry); }
    const { pending, ...keep } = cur.secret;
    await store.put(env.DB, env, tenant, st.p, { secret: { ...keep, ...(j.refresh_token ? { refresh_token: j.refresh_token } : {}) }, access: j.access_token, expiresAt: now + (Number(j.expires_in) || 3600) * 1000, status: 'ok', error: null });
    await store.event(env.DB, tenant, st.p, 'connected', j.refresh_token ? 'refresh token stored' : 'no refresh token issued');
    return doneScreen(def.title + ' connected', 'Done. The system keeps this connection renewed by itself.');
  } catch (e) {
    try { await store.event(env.DB, tenant, 'oauth:' + id, 'failed', String(e && e.message || e)); } catch (_) { /* recorded in logs below */ }
    console.error('connector', e && e.message);
    return failScreen('Connect ' + def.title, 'Something went wrong. The system recorded it and you can try again.', retry);
  }
}
