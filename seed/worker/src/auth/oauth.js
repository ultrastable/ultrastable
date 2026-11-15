// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// AUTH-1 adapter: generic OAuth 2.0 for any host system. Auth-code and device flows obtain a refresh token once (one consent); every later access token comes from the refresh grant.
// Provider config (token_url, client_id, scopes, device_url) lives in credentials.meta; client secret and refresh token are sealed.
const form = o => new URLSearchParams(o).toString();
export const oauth = {
  id: 'oauth',
  async mint(m, { fetch: f = fetch, now = Date.now() } = {}) {
    if (!m || !m.secret || !m.secret.refresh_token) return { ok: false, error: 'no refresh token (consent has not completed)' };
    const body = { grant_type: 'refresh_token', refresh_token: m.secret.refresh_token, client_id: m.meta.client_id };
    if (m.secret.client_secret) body.client_secret = m.secret.client_secret;
    if (m.meta.resource) body.resource = m.meta.resource;  // CONNECT-1: RFC 8707 audience for MCP servers
    const r = await f(m.meta.token_url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form(body) });
    if (!r.ok) return { ok: false, error: `refresh HTTP ${r.status}` };
    const j = await r.json();
    if (!j.access_token) return { ok: false, error: 'refresh response had no access_token' };
    return { ok: true, token: j.access_token, expiresAt: now + (Number(j.expires_in) || 3600) * 1000, rotatedRefresh: j.refresh_token || null };
  },
  // Device flow: start returns the code a person confirms once; poll exchanges it for tokens.
  async deviceStart(meta, { fetch: f = fetch } = {}) {
    const r = await f(meta.device_url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form({ client_id: meta.client_id, scope: (meta.scopes || []).join(' ') }) });
    if (!r.ok) throw new Error('device start HTTP ' + r.status);
    return r.json();
  },
  async devicePoll(meta, deviceCode, { fetch: f = fetch } = {}) {
    const r = await f(meta.token_url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form({ client_id: meta.client_id, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    return r.json();  // { error: 'authorization_pending' } until the person confirms, then { access_token, refresh_token }
  },
};
