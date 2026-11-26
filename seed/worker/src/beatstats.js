// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// READ-BUDGET-9 (2026-11-26): one reading of the last 24 h of loop_beats for every consumer (the builtin metrics beats_24h,
// beats_productive_share_24h and loops_closing_share_24h in tick.js, and the loops block of readGoals). Each of them scanned the whole 24 h
// window on its own, every tick: measured on the live org database 7,651 to 25,466 rows a call (d1QueriesAdaptiveGroups), 4.7M rows in the
// three peak hours of 2026-11-25. Closed hours do not change, so they are kept as per-loop counts in one org row; a reading re-reads only the
// current and the previous hour (a beat still open when its hour was cached is counted again once it has closed) plus the partial hour at the
// far edge of the window, so the result is the same as the full scan: every beat with started_at >= now - 24 h.
const KEY = 'beats_24h_buckets';
const HOUR = 3600e3, WINDOW = 86400e3;
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const hourKey = ms => iso(ms).slice(0, 13);
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const AGG = `COUNT(*) AS runs, SUM(CASE WHEN ok=1 THEN 1 ELSE 0 END) AS ok_runs,
  SUM(CASE WHEN ok=1 AND detail IS NOT NULL AND detail NOT IN ('null','{}','[]') AND detail NOT LIKE '{"paced"%' THEN 1 ELSE 0 END) AS acted,
  SUM(CASE WHEN finished_at IS NOT NULL THEN 1 ELSE 0 END) AS fin, MAX(CASE WHEN ok=1 THEN finished_at END) AS last_ok, MAX(started_at) AS last_start`;
const cell = r => [Number(r.runs) || 0, Number(r.ok_runs) || 0, Number(r.acted) || 0, Number(r.fin) || 0, r.last_ok || null, r.last_start || null];
const later = (a, b) => (a == null ? b : b == null ? a : (a > b ? a : b));

const memo = new WeakMap();  // one reading per database handle and instant: the three metrics of one measure step share it

async function read(db, now) {
  const cut = now - WINDOW;
  const firstFull = Math.ceil(cut / HOUR) * HOUR;                   // the first whole hour inside the window
  const fresh = Math.floor(now / HOUR) * HOUR - HOUR;               // the previous hour and the current one are always read again
  let cache = null;
  try { const r = await db.prepare(`SELECT value FROM org WHERE key = ?`).bind(KEY).first(); cache = r ? JSON.parse(r.value) : null; } catch { cache = null; }
  const hours = (cache && cache.hours && typeof cache.hours === 'object') ? cache.hours : {};
  let from = Math.max(firstFull, fresh);
  for (let h = firstFull; h < fresh; h += HOUR) if (!hours[hourKey(h)]) { from = h; break; }  // a closed hour never read (cold start, or a gap): read from there on
  const kept = {};
  for (let h = firstFull; h < from; h += HOUR) kept[hourKey(h)] = hours[hourKey(h)];
  for (const r of await all(db, `SELECT loop, substr(started_at, 1, 13) AS h, ${AGG} FROM loop_beats WHERE started_at >= ? GROUP BY +loop, h`, iso(from))) (kept[r.h] ||= {})[r.loop] = cell(r);
  for (let h = from; h <= now; h += HOUR) kept[hourKey(h)] ||= {};   // an hour with no beat is read, not missing
  const edge = firstFull > cut ? await all(db, `SELECT loop, ${AGG} FROM loop_beats WHERE started_at >= ? AND started_at < ? GROUP BY +loop`, iso(cut), iso(firstFull)) : [];
  try { await db.prepare(`INSERT INTO org (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(KEY, JSON.stringify({ read_at: iso(now), hours: kept })).run(); }
  catch (e) { /* allow-silent: a cache write miss leaves this reading good and only costs the next one the same hours again */ console.error('beatstats: cache not written:', e && e.message); }
  const by = {};
  const add = (loop, c) => { const t = (by[loop] ||= [0, 0, 0, 0, null, null]); for (let i = 0; i < 4; i++) t[i] += c[i]; t[4] = later(t[4], c[4]); t[5] = later(t[5], c[5]); };
  for (const r of edge) add(r.loop, cell(r));
  for (const m of Object.values(kept)) for (const [loop, c] of Object.entries(m || {})) add(loop, c);
  const loops = Object.keys(by).sort().map(loop => ({ loop, runs: by[loop][0], ok_runs: by[loop][1], acted: by[loop][2], finished: by[loop][3], last_ok: by[loop][4], last_start: by[loop][5] }));
  return { n: loops.reduce((s, l) => s + l.runs, 0), productive: loops.reduce((s, l) => s + l.acted, 0), loops };
}

// { n, productive, loops: [{ loop, runs, ok_runs, acted, finished, last_ok, last_start }] } over started_at >= now - 24 h. Throws when loop_beats does not exist.
export function beatStats24h(db, now = Date.now()) {
  const m = memo.get(db);
  if (m && m.now === now) return m.p;
  const p = read(db, now);
  memo.set(db, { now, p });
  p.catch(() => { const c = memo.get(db); if (c && c.p === p) memo.delete(db); });
  return p;
}
