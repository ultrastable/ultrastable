// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// AUTH-1: the credential layer. getToken(provider) returns a live access token for a tenant, minting or refreshing it when the cached one is within the margin of its expiry.
// refreshDue(db) runs on every tick: it re-mints expiring tokens and records a credential_events row for each outcome, so an expiry is a probe result, never a surprise.
import { githubApp } from './github-app.js';
import { oauth } from './oauth.js';
import { cloudflare } from './cloudflare.js';
import * as store from './store.js';
export const ADAPTERS = { 'github-app': githubApp, oauth, cloudflare };
export const MARGIN_MS = 10 * 60 * 1000;
export const adapterFor = provider => ADAPTERS[provider.split(':')[0]];

export async function getToken(db, env, tenant, provider, opts = {}) {
  const now = opts.now || Date.now();
  const m = await store.material(db, env, tenant, provider);
  if (m && m.access && m.expiresAt && Date.parse(m.expiresAt) - now > MARGIN_MS) return { ok: true, token: m.access, cached: true };
  const a = adapterFor(provider);
  if (!a) return { ok: false, error: 'unknown provider ' + provider };
  const r = await a.mint(m, { ...opts, env, now });
  if (!r.ok) {
    await store.put(db, env, tenant, provider, { status: 'failed', error: r.error });
    await store.event(db, tenant, provider, 'failed', r.error);
    return r;
  }
  await store.put(db, env, tenant, provider, { access: r.token || null, expiresAt: r.expiresAt || null, status: 'ok', error: null, ...(r.rotatedRefresh ? { secret: { ...m.secret, refresh_token: r.rotatedRefresh } } : {}) });
  await store.event(db, tenant, provider, m && m.access ? 'refreshed' : 'minted', r.expiresAt ? 'expires ' + new Date(r.expiresAt).toISOString() : 'no expiry');
  return { ok: true, token: r.token, cached: false };
}

export async function refreshDue(db, env, opts = {}) {
  const now = opts.now || Date.now();
  const rows = (await db.prepare('SELECT tenant, provider, expires_at, status FROM credentials').all()).results || [];
  const out = [];
  for (const r of rows) {
    const due = r.status !== 'ok' || !r.expires_at || Date.parse(r.expires_at) - now <= MARGIN_MS;
    if (!due) { out.push({ ...r, action: 'fresh' }); continue; }
    const res = await getToken(db, env, r.tenant, r.provider, { ...opts, now });
    out.push({ tenant: r.tenant, provider: r.provider, action: res.ok ? 'renewed' : 'failed', error: res.error });
  }
  return out;
}

// Probe for the failure registry: every credential row is ok and no cached token lapses within the margin.
export async function probe(db, now = Date.now()) {
  const rows = (await db.prepare('SELECT tenant, provider, expires_at, status FROM credentials').all()).results || [];
  const bad = rows.filter(r => r.status === 'failed' || (r.expires_at && Date.parse(r.expires_at) <= now));
  return { ok: bad.length === 0, credentials: rows.length, bad: bad.map(r => `${r.tenant}/${r.provider}`) };
}
