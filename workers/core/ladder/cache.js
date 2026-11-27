// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// L1 cache (US-SPEC-09 section 4): exact entries with a TTL, invalidation when the source they were computed from changes, a
// semantic lookup by cosine similarity above a threshold, and stable-prefix accounting. Every lookup is recorded, so the cache
// hit rate per task class (US-09-R10) is a query. Ports: db, now, embed(texts) -> number[][] (optional; without it only the
// exact lookup runs). core/airouter keeps the router-level exact cache; this one serves the ladder's task classes.
import { iso, msOf, all, first, run } from './util.js';
import { unit, dot, fnv } from '../connect/index.js';

export const DEFAULTS = { ttl_ms: 6 * 3600000, threshold: 0.95 };
const norm = t => String(t).replace(/\s+/g, ' ').trim();
// The exact lookup is exact because the key is the SHA-256 of the normalized input: a 32-bit hash plus a length would let two
// different prompts of equal length share an entry and be served each other's answer with no model call.
export async function cacheKey(text) {
  const b = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm(text)));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const ev = (db, ts, task_class, kind, saved = 0) => run(db, `INSERT INTO ladder_cache_events (at, task_class, kind, saved_cost) VALUES (?,?,?,?)`, ts, task_class, kind, saved);

/** Messages ordered so the stable part (system and static context) comes first; returns the hash and size of that prefix. */
export function stablePrefix(messages, { tail = 1 } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const head = list.slice(0, Math.max(0, list.length - tail)).map(m => `${m.role}:${norm(m.content)}`).join('\n');
  return { prefix_hash: fnv(head).toString(16), prefix_chars: head.length };
}

export async function cachePut(ctx, { task_class, input, value, source_hash = null, cost = 0, ttl_ms, prefix_hash = null }) {
  const t = msOf(ctx.now ?? Date.now);
  let emb = null;
  if (typeof ctx.embed === 'function') emb = JSON.stringify(Array.from(unit((await ctx.embed([norm(input)]))[0])).map(x => Math.round(x * 1e5) / 1e5));
  await run(ctx.db, `INSERT INTO ladder_cache (task_class, key, source_hash, value, embedding, prefix_hash, cost, created_at, expires_at, hits) VALUES (?,?,?,?,?,?,?,?,?,0)
    ON CONFLICT(task_class, key) DO UPDATE SET source_hash=excluded.source_hash, value=excluded.value, embedding=excluded.embedding, prefix_hash=excluded.prefix_hash, cost=excluded.cost, created_at=excluded.created_at, expires_at=excluded.expires_at, hits=0`,
    task_class, await cacheKey(input), source_hash, typeof value === 'string' ? value : JSON.stringify(value), emb, prefix_hash, cost, iso(t), iso(t + (ttl_ms ?? ctx.ttl_ms ?? DEFAULTS.ttl_ms)));
}

/**
 * Look up an answer. { hit: 'exact'|'semantic'|null, value }. An entry past its TTL, or whose source_hash differs from the
 * caller's current one, is a miss and is deleted. A semantic hit needs an embedder and a cosine at or above `threshold`.
 */
export async function cacheGet(ctx, { task_class, input, source_hash = null, threshold = ctx.threshold ?? DEFAULTS.threshold }) {
  const t = msOf(ctx.now ?? Date.now), ts = iso(t), db = ctx.db, stale = r => r.expires_at <= ts || (source_hash != null && r.source_hash != null && r.source_hash !== source_hash);
  const hitRow = async (r, kind) => { await run(db, `UPDATE ladder_cache SET hits = hits + 1 WHERE task_class = ? AND key = ?`, r.task_class, r.key); await ev(db, ts, task_class, kind, r.cost); return { hit: kind, value: r.value, saved_cost: r.cost }; };
  const exact = await first(db, `SELECT * FROM ladder_cache WHERE task_class = ? AND key = ?`, task_class, await cacheKey(input));
  if (exact) {
    if (stale(exact)) { await run(db, `DELETE FROM ladder_cache WHERE task_class = ? AND key = ?`, task_class, exact.key); await ev(db, ts, task_class, 'invalidated'); }
    else return hitRow(exact, 'exact');
  }
  if (typeof ctx.embed === 'function') {
    const q = unit((await ctx.embed([norm(input)]))[0]);
    let best = null;
    for (const r of await all(db, `SELECT * FROM ladder_cache WHERE task_class = ? AND embedding IS NOT NULL`, task_class)) {
      if (stale(r)) { await run(db, `DELETE FROM ladder_cache WHERE task_class = ? AND key = ?`, task_class, r.key); await ev(db, ts, task_class, 'invalidated'); continue; }
      const sim = dot(q, JSON.parse(r.embedding));
      if (sim >= threshold && (!best || sim > best.sim)) best = { r, sim };
    }
    if (best) return { ...(await hitRow(best.r, 'semantic')), similarity: best.sim };
  }
  await ev(db, ts, task_class, 'miss');
  return { hit: null, value: null };
}

/** Hit rate per task class over the last `window` lookups (or all): { lookups, exact, semantic, miss, hit_rate }. */
export async function cacheHitRate(db, task_class, { window = 1000 } = {}) {
  const r = await first(db, `SELECT COUNT(*) AS n, COALESCE(SUM(kind='exact'),0) AS e, COALESCE(SUM(kind='semantic'),0) AS s, COALESCE(SUM(kind IN ('miss','invalidated')),0) AS m, COALESCE(SUM(saved_cost),0) AS saved
    FROM (SELECT kind, saved_cost FROM ladder_cache_events WHERE task_class = ? ORDER BY id DESC LIMIT ?)`, task_class, window);
  return { lookups: r.n, exact: r.e, semantic: r.s, miss: r.m, saved_cost: r.saved, hit_rate: r.n ? (r.e + r.s) / r.n : null };
}

/** Tool-call validity per task class (US-09-R10): from the attempts and the canary runs. */
export const toolCallValidity = (db, task_class = null) => task_class === null ? all(db, `SELECT * FROM ladder_v_tool_call_validity ORDER BY task_class`) : first(db, `SELECT * FROM ladder_v_tool_call_validity WHERE task_class = ?`, task_class);
