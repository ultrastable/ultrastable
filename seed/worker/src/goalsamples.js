// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// READ-BUDGET-11 (2026-11-27): one reading of the last 14 days of goal_samples for every consumer (readGoals behind /api/goals, and the
// structure reading in structureOf). Each of them ran `SELECT goal_id, at, value FROM goal_samples WHERE at >= ? ORDER BY at` on its own:
// measured on the live org database (d1QueriesAdaptiveGroups, 6 h to 07:15 UTC) 18,590 rows a call, 24 calls, 446,148 of about 1.2M rows
// read, the largest single reader while the database sat over its 120,000 rows-an-hour budget and the tick ran lean. Samples are append-only
// (the one INSERT in goalsStep writes at the tick's own `now`), so a closed hour never changes. Closed hours are kept, as they were read, in
// one org row; a reading re-reads only the previous and the current hour plus the partial hour at the far edge of the window. The result is
// the same rows in the same order as the full scan: every sample with at >= now - 14 d, ordered by at.
const KEY = 'goal_samples_14d_buckets';
const HOUR = 3600e3;
export const WINDOW_MS = 14 * 86400e3;
export const MAX_CACHE_BYTES = 1_500_000;  // a D1 value may hold 2 MB; past this the reading stays correct and is simply not cached
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const SCAN = `SELECT goal_id, at, value FROM goal_samples WHERE at >= ? ORDER BY at`;

// Pure: rows [{goal_id, at, value}] grouped as { hourStartMs: { goal_id: [[at, value], ...] } }.
export function bucket(rows) {
  const out = {};
  for (const r of rows) ((out[Math.floor(r.at / HOUR) * HOUR] ||= {})[r.goal_id] ||= []).push([r.at, r.value]);
  return out;
}
// Pure: the inverse, ordered by at (the sort is stable, so rows of one instant keep the order they were read in).
export function unbucket(hours) {
  const rows = [];
  for (const h of Object.keys(hours).map(Number).sort((a, b) => a - b)) for (const [goal_id, xs] of Object.entries(hours[h] || {})) for (const [at, value] of xs) rows.push({ goal_id, at, value });
  return rows.sort((a, b) => a.at - b.at);
}

// [{ goal_id, at, value }] with at >= now - 14 d, ordered by at. Throws when goal_samples does not exist.
export async function goalSamples14d(db, now = Date.now()) {
  const cut = now - WINDOW_MS;
  const firstFull = Math.ceil(cut / HOUR) * HOUR;          // the first whole hour inside the window
  const fresh = Math.floor(now / HOUR) * HOUR - HOUR;      // the previous hour and the current one are always read again
  let cache = null;
  try { const r = await db.prepare(`SELECT value FROM org WHERE key = ?`).bind(KEY).first(); cache = r ? JSON.parse(r.value) : null; } catch { cache = null; }
  // A cache written at a later instant than this reading (a clock that went back, a test that travels in time) is not this reading's past.
  const hours = (cache && cache.hours && typeof cache.hours === 'object' && Number(cache.read_at) <= now) ? cache.hours : null;
  if (!hours) {                                             // cold start: one full scan, then the buckets are kept
    const rows = await all(db, SCAN, cut);
    await keep(db, now, bucket(rows.filter(r => r.at >= firstFull)));
    return rows;
  }
  let from = Math.max(firstFull, fresh);
  for (let h = firstFull; h < fresh; h += HOUR) if (!(h in hours)) { from = h; break; }  // a closed hour never read (a gap): read from there on
  const kept = {};
  for (let h = firstFull; h < from; h += HOUR) kept[h] = hours[h];
  const recent = await all(db, SCAN, from);
  Object.assign(kept, bucket(recent));
  for (let h = from; h <= now; h += HOUR) kept[h] ||= {};  // an hour with no sample is read, not missing
  const edge = firstFull > cut ? await all(db, `SELECT goal_id, at, value FROM goal_samples WHERE at >= ? AND at < ? ORDER BY at`, cut, firstFull) : [];
  await keep(db, now, kept);
  return [...edge, ...unbucket(kept)];
}

async function keep(db, now, hours) {
  for (let h = Math.ceil((now - WINDOW_MS) / HOUR) * HOUR; h <= now; h += HOUR) hours[h] ||= {};
  const value = JSON.stringify({ read_at: now, hours });
  if (value.length > MAX_CACHE_BYTES) return false;
  try { await db.prepare(`INSERT INTO org (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(KEY, value).run(); return true; }
  catch (e) { /* allow-silent: a cache write miss leaves this reading good and only costs the next one a full scan */ console.error('goalsamples: cache not written:', e && e.message); return false; }
}
