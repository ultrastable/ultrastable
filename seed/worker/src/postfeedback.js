// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// POST-FEEDBACK-1 (Rowan, 2026-11-22): a post's outcome returns as a signal. Public like, repost and reply counts are read back a day after posting
// (Bluesky and Mastodon expose them without a credential), stored on the social_posted row, and scored per arm; the publisher breaks ties between
// equally ranked posts toward the arm that earns more engagement. Data is sparse at first, so scores are shrunk toward the overall mean and an
// arm with fewer than MIN_N measured posts is neutral. Pure scoring here; the fetch takes `f` as an argument.
export const MIN_N = 3, PRIOR_N = 5, AFTER_MS = 864e5;
export const migrate = ['ALTER TABLE social_posted ADD COLUMN likes INTEGER', 'ALTER TABLE social_posted ADD COLUMN reposts INTEGER', 'ALTER TABLE social_posted ADD COLUMN replies INTEGER', 'ALTER TABLE social_posted ADD COLUMN measured_at TEXT'];
export async function engagementOf(kind, ref, f) {
  if (String(kind).startsWith('relay:')) { kind = kind.slice(6); ref = (String(ref).match(/https:\/\/\S+/) || [''])[0]; } // relay rows hold '<id> <url>'
  if (kind === 'bluesky') { const r = await f('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=' + encodeURIComponent(ref)); if (!r.ok) return null; const p = ((await r.json()).posts || [])[0]; return p ? { likes: p.likeCount || 0, reposts: p.repostCount || 0, replies: p.replyCount || 0 } : null; }
  if (kind === 'mastodon') { const m = /^https:\/\/([^/]+)\/@[^/]+\/(\d+)/.exec(String(ref)); if (!m) return null; const r = await f('https://' + m[1] + '/api/v1/statuses/' + m[2]); if (!r.ok) return null; const s = await r.json(); return { likes: s.favourites_count || 0, reposts: s.reblogs_count || 0, replies: s.replies_count || 0 }; }
  return null;
}
export const score = r => (r.likes || 0) + 2 * (r.reposts || 0) + 3 * (r.replies || 0);
// arm -> shrunk mean score; arms with too few measurements are omitted (neutral).
export function armScores(rows) {
  const m = rows.filter(r => r.measured_at && r.arm), all = m.length ? m.reduce((a, r) => a + score(r), 0) / m.length : 0, by = {};
  for (const r of m) (by[r.arm] = by[r.arm] || []).push(score(r));
  const out = {};
  for (const [arm, v] of Object.entries(by)) if (v.length >= MIN_N) out[arm] = (v.reduce((a, b) => a + b, 0) + PRIOR_N * all) / (v.length + PRIOR_N);
  return out;
}
// Reads back at most `limit` posts older than a day and not measured in the last day. Returns what it measured, so a quiet run is visible.
export async function reconcileEngagement(db, f, now, limit = 8) {
  const cut = new Date(now - AFTER_MS).toISOString();
  const rows = ((await db.prepare("SELECT id, channel, ref FROM social_posted WHERE channel IN ('bluesky','mastodon','relay:mastodon') AND status IN ('verified','unverified') AND at < ? AND (measured_at IS NULL OR measured_at < ?) LIMIT ?").bind(cut, cut, limit).all()).results || []);
  const done = [];
  for (const r of rows) {
    const e = await engagementOf(r.channel, r.ref, f).catch(() => null);
    if (!e) continue;
    await db.prepare('UPDATE social_posted SET likes=?, reposts=?, replies=?, measured_at=? WHERE id=? AND channel=?').bind(e.likes, e.reposts, e.replies, new Date(now).toISOString(), r.id, r.channel).run();
    done.push(r.id);
  }
  return { measured: done.length, of: rows.length };
}
