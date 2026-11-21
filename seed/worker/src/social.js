// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// REACH-1: the server-side publisher. Reads the public calendar and gate (social/calendar.json, social/gate.json in the repository), posts the due item to every channel linked
// through /connect/bluesky and /connect/mastodon, and records each post in D1. Caps, kill switch, paused channels and mode come from the gate file. Modules take db, env, fetch, now.
import * as store from './auth/store.js';
import { dpopFetch, refreshForm, assertionFields } from './auth/atproto.js';

const RAW = repo => `https://raw.githubusercontent.com/${repo}/main/social/`;
const DDL = "CREATE TABLE IF NOT EXISTS social_posted (id TEXT NOT NULL, channel TEXT NOT NULL, at TEXT NOT NULL, ref TEXT, arm TEXT, PRIMARY KEY (id, channel))";
const DDL_FAILED = "CREATE TABLE IF NOT EXISTS social_failed (id TEXT NOT NULL, channel TEXT NOT NULL, at TEXT NOT NULL, error TEXT, PRIMARY KEY (id, channel))";  // THOUGHT-1: a failed send is retried once a day, not every tick
const weekKey = d => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); return t.getUTCFullYear() + '-' + Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };

export async function postMastodon(m, text, id, f) {
  const r = await f('https://' + m.meta.instance + '/api/v1/statuses', { method: 'POST', headers: { authorization: 'Bearer ' + m.access, 'content-type': 'application/json', 'idempotency-key': id }, body: JSON.stringify({ status: text, visibility: 'public' }) });
  if (!r.ok) throw new Error('mastodon HTTP ' + r.status);
  return (await r.json()).url || 'ok';
}

// THOUGHT-1: LinkedIn, posting as the member who connected at /connect/linkedin (scope w_member_social). Commentary uses LinkedIn's "little text"
// format, where these characters are markup and must be escaped. The API is versioned by month; a version LinkedIn no longer serves (or does not
// serve yet) answers 426 or 400, so the next older month is tried, at most four in all.
export const liEscape = t => String(t).replace(/[\\|{}@\[\]()<>#*_~]/g, c => '\\' + c);
export const liVersions = (now, pinned) => { const out = pinned ? [String(pinned)] : []; const d = new Date(now); for (let i = 1; out.length < 4; i++) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); const v = `${x.getUTCFullYear()}${String(x.getUTCMonth() + 1).padStart(2, '0')}`; if (!out.includes(v)) out.push(v); } return out; };
export async function postLinkedIn(m, text, url, f, now = Date.now(), pinned = null) {
  let sub = m.meta && m.meta.sub;
  if (!sub) { const u = await f('https://api.linkedin.com/v2/userinfo', { headers: { authorization: 'Bearer ' + m.access } }); if (!u.ok) throw new Error('linkedin userinfo HTTP ' + u.status); sub = (await u.json()).sub; }
  if (!sub) throw new Error('linkedin: no member id');
  const body = { author: 'urn:li:person:' + sub, commentary: liEscape(text), visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false };
  if (url) body.content = { article: { source: url, title: String(text).split('\n')[0].slice(0, 200) } };
  let last = 0;
  for (const v of liVersions(now, pinned)) {
    const r = await f('https://api.linkedin.com/rest/posts', { method: 'POST', headers: { authorization: 'Bearer ' + m.access, 'content-type': 'application/json', 'linkedin-version': v, 'x-restli-protocol-version': '2.0.0' }, body: JSON.stringify(body) });
    if (r.ok) return (r.headers && r.headers.get && r.headers.get('x-restli-id')) || 'ok';
    last = r.status; if (r.status !== 426 && r.status !== 400) break;
  }
  throw new Error('linkedin HTTP ' + last);
}

// Bluesky shows a URL as plain text unless the post carries a link facet with its UTF-8 byte range.
export function linkFacets(text) {
  const enc = new TextEncoder(), out = [];
  for (const mt of String(text).matchAll(/https?:\/\/[^\s]+/g)) {
    const start = enc.encode(text.slice(0, mt.index)).length;
    out.push({ index: { byteStart: start, byteEnd: start + enc.encode(mt[0]).length }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: mt[0] }] });
  }
  return out;
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
  const body = JSON.stringify({ repo: m.meta.did, collection: 'app.bsky.feed.post', record: { $type: 'app.bsky.feed.post', text, langs: ['en'], createdAt: new Date(now).toISOString(), ...(linkFacets(text).length ? { facets: linkFacets(text) } : {}) } });
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
export async function postBuffer(token, text, f, short) {
  const out = {};
  for (const ch of await bufferChannels(token, f)) {
    const svc = /substack/i.test(ch.service) ? 'substack' : ch.service, t = svc === 'twitter' ? String(short || text).slice(0, 280) : text;
    const mode = svc === 'twitter' ? 'shareNow' : 'addToQueue';
    const r = await bgql(f, token, 'mutation { createPost(input: { text: ' + JSON.stringify(t) + ', channelId: ' + JSON.stringify(ch.id) + ', schedulingType: automatic, mode: ' + mode + ' }) { ... on PostActionSuccess { post { id status } } ... on MutationError { message } } }');
    const cp = (r.data || {}).createPost;
    out[svc] = cp && cp.post ? cp.post.id : 'failed: ' + String((cp && cp.message) || 'no post').slice(0, 100);
  }
  return out;
}

export async function postRelay(env, p, f) {
  const r = await f(env.SOCIAL_RELAY_URL + '/relay/post', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.SOCIAL_RELAY_TOKEN }, body: JSON.stringify({ text: p.long || p.text, short: p.text, channels: ['mastodon', 'linkedin', 'twitter', 'substack', 'facebook', 'instagram'] }) });
  if (!r.ok) throw new Error('relay HTTP ' + r.status);
  return JSON.stringify((await r.json()).results || {});
}

// Order of what posts next: the weekly meta-story, then a tenant's changed items, then a tenant's backlog in hierarchy order, then platform events, then evergreen.
// THOUGHT-1: a white paper piece goes right after the weekly meta-story.
export const priority = p => (p.arm === 'meta-story' ? 0 : p.kind === 'paper' ? 0.5 : String(p.arm || '').startsWith('ps-') ? (p.kind === 'event' ? 1 : 2) : p.kind === 'event' ? 3 : 4);

export async function runSocial({ db, env, fetch: f = fetch, now = Date.now(), tenant = 'default', repo = 'ultrastable/ultrastable' }) {
  await store.ensureSchema(db); await db.prepare(DDL).run(); await db.prepare(DDL_FAILED).run();
  const channels = {};
  for (const [ch, key] of [['bluesky', 'oauth:bluesky'], ['mastodon', 'oauth:mastodon'], ['linkedin', 'oauth:linkedin'], ['buffer', 'oauth:buffer']]) {
    const m = await store.material(db, env, tenant, key);
    const live = ch === 'bluesky' ? m && m.secret && m.secret.refresh_token : ch === 'linkedin' ? m && m.access && (!m.expiresAt || Date.parse(m.expiresAt) > now) : m && m.access;  // LinkedIn tokens expire after 60 days with no refresh
    if (m && m.status !== 'pending' && live) channels[ch] = m;  // an unfinished sign-in (no token) is not a channel: it would only spend calls
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
  const d = new Date(now), today = d.toISOString().slice(0, 10), rows = (await db.prepare('SELECT id, channel, at FROM social_posted').all()).results || [];
  const days = new Set(rows.filter(r => r.at.slice(0, 10) === today).map(r => r.id)), wk = new Set(rows.filter(r => weekKey(new Date(r.at)) === weekKey(d)).map(r => r.id));
  if (days.size >= gate.max_posts_per_day || wk.size >= gate.max_posts_per_week) return { skipped: 'rate limit' };
  // THOUGHT-1: a post may name its channels and carry a text per channel. A post with no list goes to Bluesky and Mastodon only, so LinkedIn gets the
  // white papers and nothing else. A paper is due on a channel it has not reached yet, so a channel linked later still gets the current pieces.
  const by = new Map(); for (const r of rows) { if (!by.has(r.id)) by.set(r.id, new Set()); if (r.channel) by.get(r.id).add(r.channel); }
  // Buffer and the relay fan out to the owner's own accounts (LinkedIn included), so they carry what every post carries and a paper's long text.
  const targets = p => { const l = p.channels || ['bluesky', 'mastodon']; return [...l, 'buffer', 'relay'].filter((ch, i, a) => a.indexOf(ch) === i && channels[ch]); };
  const failed = new Set(((await db.prepare('SELECT id, channel, at FROM social_failed').all()).results || []).filter(r => now - Date.parse(r.at) < 864e5).map(r => r.id + '|' + r.channel));
  const missing = p => targets(p).filter(ch => !(by.get(p.id) || new Set()).has(ch) && !failed.has(p.id + '|' + ch));
  const due = (cal.posts || []).filter(p => p.date <= today && missing(p).length && (!by.has(p.id) || p.kind === 'paper')).sort((a, b) => priority(a) - priority(b));
  if (!due.length) return { skipped: 'nothing due' };
  const p = due[0], out = {};
  for (const ch of missing(p)) {
    const m = channels[ch], text = (p.texts && p.texts[ch]) || p.text;
    try {
      const long = (p.texts && p.texts.linkedin) || p.long || p.text, short = (p.texts && p.texts.bluesky) || p.text;
      const ref = ch === 'relay' ? await postRelay(env, { ...p, long, text: short }, f) : ch === 'mastodon' ? await postMastodon(m, text, p.id, f) : ch === 'linkedin' ? await postLinkedIn(m, text, p.url || null, f, now, env.LINKEDIN_VERSION || null) : ch === 'buffer' ? JSON.stringify(await postBuffer(m.access, long, f, short)) : await postBluesky(db, env, tenant, m, text, f, now);
      await db.prepare('INSERT OR IGNORE INTO social_posted (id, channel, at, ref, arm) VALUES (?,?,?,?,?)').bind(p.id, ch, new Date(now).toISOString(), ref, p.arm || null).run();
      out[ch] = 'posted';
    } catch (e) {
      out[ch] = 'failed: ' + String(e && e.message || e).slice(0, 120); await store.event(db, tenant, 'oauth:' + ch, 'failed', out[ch]);
      await db.prepare('INSERT OR REPLACE INTO social_failed (id, channel, at, error) VALUES (?,?,?,?)').bind(p.id, ch, new Date(now).toISOString(), out[ch]).run();
    }
  }
  return { id: p.id, results: out };
}
