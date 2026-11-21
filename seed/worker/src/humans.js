// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// SOCIAL-MODULE-1: the human interface layer. Every Ultrastable system faces people (posts, replies, mentions, outreach, newsletters); this module is where that
// happens, tenant-agnostic. A tenant supplies content and config only; channels, tokens, read-back and the inbox live in core. Modules take db, env, fetch, now.
//   importCredentials  one-shot, token-gated hand-over of a channel token into the sealed credential store (used to move off the old relay)
//   reconcileBuffer    a post Buffer accepted is "verified" only when Buffer reports it sent and gives its public link, which is then fetched
//   intakeInbox        replies and mentions on Bluesky and Mastodon become inbox rows (public text, author hashed), so replies are input, not noise
import * as store from './auth/store.js';
import { getToken } from './auth/index.js';

const DDL = [
  "CREATE TABLE IF NOT EXISTS human_inbox (id TEXT PRIMARY KEY, channel TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, author TEXT, text TEXT, url TEXT, status TEXT NOT NULL DEFAULT 'new')",
  "CREATE INDEX IF NOT EXISTS human_inbox_at ON human_inbox (at)",
];
const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
const same = (a, b) => { a = String(a || ''); b = String(b || ''); if (!a || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// Token-gated by SOCIAL_RELAY_TOKEN (already shared with the old relay). Seals { buffer, mastodon } and returns names only, never values.
export async function importCredentials(db, env, tenant, request) {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.SOCIAL_RELAY_TOKEN || !same(bearer, env.SOCIAL_RELAY_TOKEN)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let b; try { b = await request.json(); } catch (e) { return Response.json({ error: 'json required' }, { status: 400 }); }  // allow-silent: a malformed body is answered with a 400
  await store.ensureSchema(db); const done = [];
  if (b.buffer_token) { await store.put(db, env, tenant, 'oauth:buffer', { secret: { imported: true }, access: String(b.buffer_token), meta: { via: 'import' }, status: 'ok' }); done.push('buffer'); }
  if (b.mastodon_token && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(b.mastodon_instance || ''))) { await store.put(db, env, tenant, 'oauth:mastodon', { secret: { imported: true }, access: String(b.mastodon_token), meta: { instance: String(b.mastodon_instance).toLowerCase(), via: 'import' }, status: 'ok' }); done.push('mastodon'); }
  for (const p of done) await store.event(db, tenant, 'oauth:' + p, 'imported', 'sealed by token-gated import');
  return Response.json({ ok: true, imported: done });
}

// Buffer says what happened to a queued post: sent (with the network's public link) or error. The link is fetched; only a reachable link is "verified".
export async function reconcileBuffer({ db, env, tenant = 'default', fetch: f = fetch, now = Date.now() }) {
  const m0 = await store.material(db, env, tenant, 'oauth:buffer'); if (!m0 || !m0.access) return { skipped: 'no buffer credential' };
  const bt = await getToken(db, env, tenant, 'oauth:buffer', { fetch: f, now }); if (!bt.ok) return { skipped: 'buffer token: ' + bt.error }; const m = { access: bt.token };
  const rows = ((await db.prepare("SELECT id, channel, ref, at FROM social_posted WHERE channel LIKE 'buffer:%' AND status = 'queued' ORDER BY at LIMIT 8").all()).results || []);
  const out = {};
  for (const r of rows) {
    try {
      const q = await f('https://api.buffer.com', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + m.access }, body: JSON.stringify({ query: 'query { post(input: { id: ' + JSON.stringify(r.ref) + ' }) { id status sentAt externalLink } }' }) });
      const p = q.ok ? (((await q.json()).data || {}).post) : null;
      let status = 'queued', ref = r.ref;
      if (p && /^(sent|published)$/i.test(p.status || '')) {
        if (p.externalLink) { const v = await f(p.externalLink, { method: 'GET', redirect: 'follow' }).catch(() => null); status = v && v.status < 400 ? 'verified' : 'unverified'; ref = p.externalLink; }  // some networks refuse bots (403): sent with a link is "unverified", never "published"
        else status = 'unverified';
      } else if (p && /^(error|failed)$/i.test(p.status || '')) { status = 'failed'; ref = 'buffer reported ' + p.status; }
      else if (now - Date.parse(r.at) > 48 * 36e5) { status = 'failed'; ref = 'queued 48h, never published'; }  // a post that never leaves the queue is retried, not counted
      if (status !== 'queued') { await db.prepare('UPDATE social_posted SET status = ?, ref = ? WHERE id = ? AND channel = ?').bind(status, String(ref).slice(0, 400), r.id, r.channel).run(); out[r.channel] = status; }
    } catch (e) { out[r.channel] = 'error: ' + String(e && e.message || e).slice(0, 80); }
  }
  return out;
}

// Replies and mentions, read with the channel's own token. Bluesky: listNotifications; Mastodon: /api/v1/notifications. Public text only; the author is hashed.
export async function intakeInbox({ db, env, tenant = 'default', fetch: f = fetch, now = Date.now(), blueskyAccess }) {
  for (const q of DDL) await db.prepare(q).run();
  const out = { new: 0 }, ins = async (id, channel, kind, at, author, text, url) => { const r = await db.prepare("INSERT OR IGNORE INTO human_inbox (id, channel, kind, at, author, text, url) VALUES (?,?,?,?,?,?,?)").bind(id, channel, kind, at, await sha(String(author)), String(text || '').slice(0, 500), url || null).run(); if (r.meta && r.meta.changes) out.new++; };
  const mm = await store.material(db, env, tenant, 'oauth:mastodon');
  if (mm && mm.access && mm.meta && mm.meta.instance) {
    try {
      const r = await f('https://' + mm.meta.instance + '/api/v1/notifications?limit=20&types[]=mention', { headers: { authorization: 'Bearer ' + mm.access } });
      if (r.ok) for (const n of await r.json()) await ins('mastodon:' + n.id, 'mastodon', 'mention', n.created_at, (n.account || {}).acct, String((n.status || {}).content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), (n.status || {}).url);
    } catch (e) { out.mastodon = 'error: ' + String(e && e.message || e).slice(0, 80); }
  }
  const bm = await store.material(db, env, tenant, 'oauth:bluesky');
  if (bm && bm.secret && bm.secret.refresh_token && blueskyAccess) {
    try {
      const { dpopFetch } = await import('./auth/atproto.js'), m = await blueskyAccess(db, env, tenant, bm, f, now);
      const r = await dpopFetch(f, m.meta.pds + '/xrpc/app.bsky.notification.listNotifications', { method: 'GET', headers: {}, jwk: m.secret.dpop_jwk, nonce: m.secret.nonce, access: m.access });
      if (r.res.ok) for (const n of ((await r.res.json()).notifications || []).filter(x => x.reason === 'reply' || x.reason === 'mention')) await ins('bluesky:' + n.uri, 'bluesky', n.reason, n.indexedAt, (n.author || {}).did, (n.record || {}).text, n.uri);
      else out.bluesky = 'HTTP ' + r.res.status;
    } catch (e) { out.bluesky = 'error: ' + String(e && e.message || e).slice(0, 80); }
  }
  return out;
}

// A channel nobody has linked is one click on the owner page: a never-linked row reads as "consent has not completed", which the owner-acts list already shows with its link.
export async function seedLinkRows(db, env, tenant) {
  await store.ensureSchema(db); const made = [];
  for (const p of ['oauth:buffer', 'oauth:mastodon']) if (!(await store.get(db, tenant, p))) { await store.put(db, env, tenant, p, { status: 'failed', error: 'consent has not completed (not linked yet)' }); made.push(p); }
  return made;
}
