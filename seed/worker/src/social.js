// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// REACH-1: the server-side publisher. Reads the public calendar and gate (social/calendar.json, social/gate.json in the repository), posts the due item to every channel linked
// through /connect/bluesky and /connect/mastodon, and records each post in D1. Caps, kill switch, paused channels and mode come from the gate file. Modules take db, env, fetch, now.
import * as store from './auth/store.js';
import { dpopFetch, refreshForm, assertionFields } from './auth/atproto.js';

const RAW = repo => `https://raw.githubusercontent.com/${repo}/main/social/`;
const DDL = "CREATE TABLE IF NOT EXISTS social_posted (id TEXT NOT NULL, channel TEXT NOT NULL, at TEXT NOT NULL, ref TEXT, arm TEXT, PRIMARY KEY (id, channel))";
const MIGRATE = ['ALTER TABLE social_posted ADD COLUMN status TEXT', 'ALTER TABLE social_posted ADD COLUMN attempts INTEGER DEFAULT 1'];  // POST-READBACK-1: a row says what was observed, not what was sent

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

// SOCIAL-BUFFER-1: LinkedIn, X and Substack have no open posting API; Buffer's GraphQL API (api.buffer.com) fronts them. One linked Buffer account carries every channel
// it holds. LinkedIn and Substack go to the queue, X shares now (the cadence the earlier Buffer layer used). Text is plain; the 280-character fit applies to X only.
const bgql = async (f, token, query) => { const r = await f('https://api.buffer.com', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ query }) }); if (!r.ok) throw new Error('buffer HTTP ' + r.status); return r.json(); };
export async function bufferChannels(token, f) {
  const o = await bgql(f, token, '{ account { organizations { id } } }'); const org = (((o.data || {}).account || {}).organizations || [])[0];
  if (!org) return [];
  const c = await bgql(f, token, '{ channels(input: { organizationId: ' + JSON.stringify(org.id) + ' }) { id service isDisconnected } }');
  return ((c.data || {}).channels || []).filter(x => !x.isDisconnected);
}
export async function postBuffer(token, text, f, short, only) {
  const out = {};
  for (const ch of await bufferChannels(token, f)) {
    const svc = /substack/i.test(ch.service) ? 'substack' : ch.service;
    if (only && only.length && !only.includes(svc)) continue;  // a retry re-sends only the services that failed
    const t = svc === 'twitter' ? String(short || text).slice(0, 280) : text;
    const mode = svc === 'twitter' ? 'shareNow' : 'addToQueue';
    const r = await bgql(f, token, 'mutation { createPost(input: { text: ' + JSON.stringify(t) + ', channelId: ' + JSON.stringify(ch.id) + ', schedulingType: automatic, mode: ' + mode + ' }) { ... on PostActionSuccess { post { id status } } ... on MutationError { message } } }');
    const cp = (r.data || {}).createPost;
    out[svc] = cp && cp.post ? cp.post.id : 'failed: ' + String((cp && cp.message) || 'no post').slice(0, 100);
  }
  return out;
}

export async function postRelay(env, p, f, only) {
  const r = await f(env.SOCIAL_RELAY_URL + '/relay/post', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.SOCIAL_RELAY_TOKEN }, body: JSON.stringify({ text: p.long || p.text, short: p.text, channels: only && only.length ? only : ['mastodon', 'linkedin', 'twitter', 'substack', 'facebook', 'instagram'] }) });
  if (!r.ok) throw new Error('relay HTTP ' + r.status);
  return (await r.json()).results || {};
}

// POST-READBACK-1: a post is published only when its public URL is fetched and confirmed. Everything else is recorded for what it is:
// verified (read back), queued (accepted by Buffer, not yet published), unverified (sent, no public URL to read), failed (error, no channel, refused).
export async function readBack(kind, ref, f) {
  try {
    if (kind === 'bluesky') { const r = await f('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=' + encodeURIComponent(ref)); return r.ok && ((await r.json()).posts || []).length === 1; }
    if (kind === 'mastodon') { const m = /^https:\/\/([^/]+)\/@[^/]+\/(\d+)/.exec(String(ref)); if (!m) return false; const r = await f('https://' + m[1] + '/api/v1/statuses/' + m[2]); return r.ok && String((await r.json()).id) === m[2]; }
  } catch (e) { /* allow-silent: a read-back that cannot reach the network is "unverified", recorded as such, never as published */ }
  return false;
}
export async function classifyRelay(results, f) {
  const out = {};
  for (const [svc, v] of Object.entries(results || {})) {
    const st = String((v && v.status) || '');
    if (svc === 'mastodon' && v && v.url) out[svc] = { status: (await readBack('mastodon', v.url, f)) ? 'verified' : 'unverified', ref: v.url };
    else if (/^(scheduled|queued|draft|buffer)$/.test(st)) out[svc] = { status: 'queued', ref: v.id || '' };
    else if (/^(sent|ok)$/.test(st)) out[svc] = { status: 'unverified', ref: v.id || '' };
    else out[svc] = { status: 'failed', ref: String(v && (v.error || st) || 'no result').slice(0, 120) };
  }
  return out;
}

// Order of what posts next: the weekly meta-story, then a tenant's changed items, then a tenant's backlog in hierarchy order, then platform events, then evergreen.
export const priority = p => (p.arm === 'meta-story' ? 0 : String(p.arm || '').startsWith('ps-') ? (p.kind === 'event' ? 1 : 2) : p.kind === 'event' ? 3 : 4);

export async function runSocial({ db, env, fetch: f = fetch, now = Date.now(), tenant = 'default', repo = 'ultrastable/ultrastable' }) {
  await store.ensureSchema(db); await db.prepare(DDL).run();
  for (const q of MIGRATE) { try { await db.prepare(q).run(); } catch (e) { /* allow-silent: the column already exists */ } }
  const channels = {};
  for (const [ch, key] of [['bluesky', 'oauth:bluesky'], ['mastodon', 'oauth:mastodon'], ['buffer', 'oauth:buffer']]) {
    const m = await store.material(db, env, tenant, key); if (m && m.status !== 'pending' && (ch === 'bluesky' ? m.secret && m.secret.refresh_token : m.access)) channels[ch] = m;  // an unfinished sign-in (no token) is not a channel: it would only spend calls
  }
  if (env.SOCIAL_RELAY_TOKEN && env.SOCIAL_RELAY_URL) channels.relay = { relay: true };  // SOCIAL-RELAY-1: the owner's existing Buffer and Mastodon logins, reached through a token-gated relay that never exposes them
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
  const d = new Date(now), today = d.toISOString().slice(0, 10), rows = (await db.prepare('SELECT id, channel, at, status, attempts FROM social_posted').all()).results || [];
  const days = new Set(rows.filter(r => r.at.slice(0, 10) === today).map(r => r.id)), wk = new Set(rows.filter(r => weekKey(new Date(r.at)) === weekKey(d)).map(r => r.id));
  if (days.size >= gate.max_posts_per_day || wk.size >= gate.max_posts_per_week) return { skipped: 'rate limit' };
  const done = (id, ch) => rows.some(r => r.id === id && r.channel === ch && (r.status == null || r.status !== 'failed' || r.attempts >= 3));  // a failed channel is retried up to 3 times; queued, unverified and verified rows are not re-sent
  const relayDone = id => { const rr = rows.filter(r => r.id === id && r.channel.startsWith('relay:')); return rr.length > 0 ? rr.every(r => r.status !== 'failed' || r.attempts >= 3) : done(id, 'relay'); };  // per-service rows override a legacy channel='relay' row, which only said the relay was called
  const bufferDone = id => { const rr = rows.filter(r => r.id === id && r.channel.startsWith('buffer:')); return rr.length > 0 && rr.every(r => r.status !== 'failed' || r.attempts >= 3); };  // SOCIAL-MODULE-1: one row per Buffer service, so each is verified and retried on its own
  const posted = new Set((cal.posts || []).map(x => x.id).filter(id => Object.keys(channels).every(ch => ch === 'relay' ? relayDone(id) : ch === 'buffer' ? bufferDone(id) : done(id, ch))));
  const due = (cal.posts || []).filter(p => !posted.has(p.id) && p.date <= today).sort((a, b) => priority(a) - priority(b));
  if (!due.length) return { skipped: 'nothing due' };
  const p = due[0], out = {};
  const rec = async (ch, ref, status, ex) => {
    const n = ((rows.find(r => r.id === p.id && r.channel === ch) || {}).attempts || 0) + 1;
    await db.prepare('INSERT INTO social_posted (id, channel, at, ref, arm, status, attempts) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id, channel) DO UPDATE SET at=excluded.at, ref=excluded.ref, status=excluded.status, attempts=excluded.attempts').bind(p.id, ch, new Date(now).toISOString(), String(ref || '').slice(0, 400), p.arm || null, status, n).run();
    out[ch] = status + (status === 'failed' ? ': ' + String(ref).slice(0, 100) : '');
    if (status !== 'verified') await store.event(db, tenant, 'oauth:' + ch, status, String(ref).slice(0, 120));
  };
  for (const [ch, m] of Object.entries(channels)) {
    if (ch === 'buffer' ? bufferDone(p.id) : ch !== 'relay' && done(p.id, ch)) continue;
    try {
      if (ch === 'buffer') {
        const failed = rows.filter(r => r.id === p.id && r.channel.startsWith('buffer:') && r.status === 'failed').map(r => r.channel.slice(7));
        for (const [svc, id] of Object.entries(await postBuffer(m.access, p.long || p.text, f, p.text, failed))) await rec('buffer:' + svc, id, /^failed/.test(id) ? 'failed' : 'queued');  // queued until reconcileBuffer reads the public post back
        continue;
      }
      if (ch === 'relay') {
        const failed = rows.filter(r => r.id === p.id && r.channel.startsWith('relay:') && r.status === 'failed').map(r => r.channel.slice(6));
        const stale = rows.filter(r => r.id === p.id && r.channel.startsWith('relay:') && r.status === 'failed').map(r => (/queued ([0-9a-f]{24})/.exec(String(r.ref)) || [])[1]).filter(Boolean);
        if (stale.length) { try { await f(env.SOCIAL_RELAY_URL + '/relay/cancel', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.SOCIAL_RELAY_TOKEN }, body: JSON.stringify({ ids: stale }) }); } catch (e) { /* allow-silent: a failed cancel only risks a duplicate post; the retry below still goes out and the miss shows in the relay response */ } }  // POST-READBACK-2: a queued Buffer entry that never published is cancelled before its replacement shares now
        const res = await classifyRelay(await postRelay(env, p, f, failed), f);  // a retry re-sends only the services that failed
        for (const [svc, v] of Object.entries(res)) await rec('relay:' + svc, v.ref, v.status);
        continue;
      }
      const ref = ch === 'mastodon' ? await postMastodon(m, p.text, p.id, f) : await postBluesky(db, env, tenant, m, p.text, f, now);
      await rec(ch, ref, (await readBack(ch, ref, f)) ? 'verified' : 'unverified');
    } catch (e) { await rec(ch, String(e && e.message || e), 'failed'); }
  }
  return { id: p.id, results: out };
}
