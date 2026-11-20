// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// REACH-1: the server-side publisher. Reads the public calendar and gate (social/calendar.json, social/gate.json in the repository), posts the due item to every channel linked
// through /connect/bluesky and /connect/mastodon, and records each post in D1. Caps, kill switch, paused channels and mode come from the gate file. Modules take db, env, fetch, now.
import * as store from './auth/store.js';
import { dpopFetch, refreshForm, assertionFields } from './auth/atproto.js';

const RAW = repo => `https://raw.githubusercontent.com/${repo}/main/social/`;
const DDL = "CREATE TABLE IF NOT EXISTS social_posted (id TEXT NOT NULL, channel TEXT NOT NULL, at TEXT NOT NULL, ref TEXT, arm TEXT, PRIMARY KEY (id, channel))";
const weekKey = d => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); return t.getUTCFullYear() + '-' + Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };

export async function postMastodon(m, text, id, f) {
  const r = await f('https://' + m.meta.instance + '/api/v1/statuses', { method: 'POST', headers: { authorization: 'Bearer ' + m.access, 'content-type': 'application/json', 'idempotency-key': id }, body: JSON.stringify({ status: text, visibility: 'public' }) });
  if (!r.ok) throw new Error('mastodon HTTP ' + r.status);
  return (await r.json()).url || 'ok';
}

// Refreshes the DPoP-bound access token when it is within a minute of expiry; the new refresh token and nonce are sealed back.
export async function blueskyAccess(db, env, tenant, m, f, now) {
  if (m.access && m.expiresAt && Date.parse(m.expiresAt) - now > 60e3) return m;
  if (!m.secret.refresh_token) throw new Error('bluesky: no refresh token');
  const t = await dpopFetch(f, m.meta.token_url, { headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, jwk: m.secret.dpop_jwk, nonce: m.secret.nonce, body: refreshForm(m.secret.refresh_token, m.meta.client_id) + (m.secret.client_jwk ? '&' + new URLSearchParams(await assertionFields(m.secret.client_jwk, m.meta.client_id, m.meta.issuer)).toString() : '') });  // CONFIDENTIAL-CLIENT-1: a confidential client signs its refresh
  const j = t.res.ok ? await t.res.json() : null;
  if (!j || !j.access_token) { await store.put(db, env, tenant, 'oauth:bluesky', { status: 'error', error: 'refresh HTTP ' + t.res.status }); throw new Error('bluesky refresh HTTP ' + t.res.status); }
  const secret = { ...m.secret, nonce: t.nonce || m.secret.nonce, refresh_token: j.refresh_token || m.secret.refresh_token };
  await store.put(db, env, tenant, 'oauth:bluesky', { secret, access: j.access_token, expiresAt: now + (Number(j.expires_in) || 1800) * 1000, status: 'ok', error: null });
  return { ...m, secret, access: j.access_token };
}
export async function postBluesky(db, env, tenant, m0, text, f, now) {
  const m = await blueskyAccess(db, env, tenant, m0, f, now);
  const body = JSON.stringify({ repo: m.meta.did, collection: 'app.bsky.feed.post', record: { $type: 'app.bsky.feed.post', text, langs: ['en'], createdAt: new Date(now).toISOString() } });
  const r = await dpopFetch(f, m.meta.pds + '/xrpc/com.atproto.repo.createRecord', { headers: { 'content-type': 'application/json' }, body, jwk: m.secret.dpop_jwk, nonce: m.secret.nonce, access: m.access });
  if (!r.res.ok) throw new Error('bluesky HTTP ' + r.res.status);
  if (r.nonce && r.nonce !== m.secret.nonce) await store.put(db, env, tenant, 'oauth:bluesky', { secret: { ...m.secret, nonce: r.nonce } });
  return (await r.res.json()).uri || 'ok';
}

// Order of what posts next: the weekly meta-story, then a tenant's changed items, then a tenant's backlog in hierarchy order, then platform events, then evergreen.
export const priority = p => (p.arm === 'meta-story' ? 0 : String(p.arm || '').startsWith('ps-') ? (p.kind === 'event' ? 1 : 2) : p.kind === 'event' ? 3 : 4);

export async function runSocial({ db, env, fetch: f = fetch, now = Date.now(), tenant = 'default', repo = 'ultrastable/ultrastable' }) {
  await store.ensureSchema(db); await db.prepare(DDL).run();
  const channels = {};
  for (const [ch, key] of [['bluesky', 'oauth:bluesky'], ['mastodon', 'oauth:mastodon']]) {
    const m = await store.material(db, env, tenant, key); if (m && m.status !== 'pending' && (ch === 'bluesky' ? m.secret && m.secret.refresh_token : m.access)) channels[ch] = m;  // an unfinished sign-in (no token) is not a channel: it would only spend calls
  }
  if (!Object.keys(channels).length) return { skipped: 'no channel connected' };  // no network call until an account is linked
  const base = RAW(env.SOCIAL_REPO || repo), get = async n => { const r = await f(base + n); if (!r.ok) throw new Error(n + ' HTTP ' + r.status); return r.json(); };
  const [gate, cal] = await Promise.all([get('gate.json'), get('calendar.json')]);
  // SOCIAL-TENANTS-1: a tenant publishes its own queue ({ posts: [{ id, date, text, kind, arm }] }) in its own voice; core only drains it within the gate's caps.
  // The gate lists the queue URLs (data, not code). A queue that cannot be read is skipped this run and never blocks the others.
  for (const url of gate.tenant_queues || []) { try { const r = await f(url); if (r.ok) cal.posts = [...(cal.posts || []), ...((await r.json()).posts || [])]; } catch (e) { /* allow-silent: a tenant queue that cannot be read is skipped this run and never blocks the others; it is read again next run */ } }
  if (gate.kill) return { skipped: 'kill switch' };
  if (gate.mode !== 'live') return { skipped: 'gate mode ' + gate.mode };
  if (gate.kill) return { skipped: 'kill switch' };
  if (gate.mode !== 'live') return { skipped: 'gate mode ' + gate.mode };
  for (const ch of gate.paused_channels || []) delete channels[ch];
  if (!Object.keys(channels).length) return { skipped: 'all channels paused' };
  const d = new Date(now), today = d.toISOString().slice(0, 10), rows = (await db.prepare('SELECT id, at FROM social_posted').all()).results || [];
  const days = new Set(rows.filter(r => r.at.slice(0, 10) === today).map(r => r.id)), wk = new Set(rows.filter(r => weekKey(new Date(r.at)) === weekKey(d)).map(r => r.id));
  if (days.size >= gate.max_posts_per_day || wk.size >= gate.max_posts_per_week) return { skipped: 'rate limit' };
  const posted = new Set(rows.map(r => r.id));
  const due = (cal.posts || []).filter(p => !posted.has(p.id) && p.date <= today).sort((a, b) => priority(a) - priority(b));
  if (!due.length) return { skipped: 'nothing due' };
  const p = due[0], out = {};
  for (const [ch, m] of Object.entries(channels)) {
    try {
      const ref = ch === 'mastodon' ? await postMastodon(m, p.text, p.id, f) : await postBluesky(db, env, tenant, m, p.text, f, now);
      await db.prepare('INSERT OR IGNORE INTO social_posted (id, channel, at, ref, arm) VALUES (?,?,?,?,?)').bind(p.id, ch, new Date(now).toISOString(), ref, p.arm || null).run();
      out[ch] = 'posted';
    } catch (e) { out[ch] = 'failed: ' + String(e && e.message || e).slice(0, 120); await store.event(db, tenant, 'oauth:' + ch, 'failed', out[ch]); }
  }
  return { id: p.id, results: out };
}
