// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tick-step entries named in pack.json, plus report(). Class A: nothing here reaches outside the organization.
import { all, first, run, iso } from '../../core/kernel/util.js';
import { cfg } from './collect.js';

// Recomputes the daily totals of every day that still has raw events (idempotent: same events, same rows).
export async function rollup({ db, ctx }) {
  const days = await all(db, `SELECT DISTINCT day FROM analytics_events`);
  for (const { day } of days) {
    await run(db, `DELETE FROM analytics_daily WHERE day = ?`, day);
    await run(db, `INSERT INTO analytics_daily (day, path, pageviews, visitors) SELECT day, path, COUNT(*), COUNT(DISTINCT visitor_hash) FROM analytics_events WHERE day = ? GROUP BY path`, day);
    await run(db, `DELETE FROM analytics_sources WHERE day = ?`, day);
    await run(db, `INSERT INTO analytics_sources (day, source, pageviews) SELECT day, COALESCE(utm_source, referrer, '(direct)'), COUNT(*) FROM analytics_events WHERE day = ? GROUP BY 2`, day);
  }
  ctx?.notes?.push(`analytics rollup: ${days.length} day(s)`);
}

// Deletes raw events older than the retention window, only for days already rolled up.
export async function retention({ db, ctx, now, settings }) {
  const s = cfg(settings);
  const cutoff = iso(now() - s.raw_retention_days * 86400e3).slice(0, 10);
  await rollup({ db });
  const r = await run(db, `DELETE FROM analytics_events WHERE day < ? AND day IN (SELECT day FROM analytics_daily)`, cutoff);
  const n = r.meta.changes ?? 0;
  ctx?.notes?.push(`analytics retention: purged ${n} raw event(s) before ${cutoff}`);
  return n;
}

export async function metrics({ db, ctx, now }) {
  const t = now(), today = iso(t).slice(0, 10);
  const pv = (await first(db, `SELECT COALESCE(SUM(pageviews),0) AS n FROM analytics_daily WHERE day >= ?`, iso(t - 7 * 86400e3).slice(0, 10))).n;
  const vis = (await first(db, `SELECT COUNT(DISTINCT visitor_hash) AS n FROM analytics_events WHERE day = ?`, today)).n;
  const raw = (await first(db, `SELECT COUNT(*) AS n FROM analytics_events`)).n;
  await run(db, `INSERT INTO analytics_metrics (at, pageviews_7d, visitors_today, raw_events, purged) VALUES (?,?,?,?,0)`, iso(t), pv, vis, raw);
  ctx?.notes?.push(`analytics metrics: ${pv} views in 7 days, ${vis} visitors today, ${raw} raw events`);
}

// Search presence (US-SPEC-21 s7). The host supplies the read-only port settings.ports.search_analytics:
//   ({ from, to, hosts }) -> [{ date, page, clicks, impressions, position }]   (dates YYYY-MM-DD, page a path or a URL on an own host)
// A row whose page carries a query string or fragment is dropped, not trimmed: the pack stores no search query text and nothing that
// could identify a person. Re-reading a day replaces its rows (idempotent). A failing port throws, so the host files its own item; with no port configured the loop only notes it.
export async function search({ db, ctx, now, settings }) {
  const s = cfg(settings), port = settings && settings.ports && settings.ports.search_analytics;
  if (typeof port !== 'function') { ctx?.notes?.push('analytics search: port not configured, nothing read'); return; }   // not configured is not a failure; nothing is stored, so nothing reads as zero
  const t = now(), days = settings.search_days ?? 3;
  const rowsIn = await port({ from: iso(t - days * 86400e3).slice(0, 10), to: iso(t).slice(0, 10), hosts: s.own_hosts });
  let dropped = 0;
  // Rows are summed per (day, page) before anything is written: two rows that normalise to one page (a trailing-slash twin) add up, they do not
  // overwrite each other. Position is the impression-weighted mean of the rows that carry one. An absolute URL is accepted only when own_hosts names
  // its host: with none configured the pack cannot tell whose page it is, so the row is dropped rather than filed under a path of this site.
  const agg = new Map();
  for (const r of Array.isArray(rowsIn) ? rowsIn : []) {
    let page = String(r.page ?? '');
    try {
      if (/^https?:/i.test(page)) {
        const u = new URL(page);
        if (!s.own_hosts.length || !s.own_hosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) { dropped++; continue; }
        page = u.pathname + (u.search || '') + (u.hash || '');
      }
    } catch { dropped++; continue; }
    if (!/^\/[^?#]*$/.test(page) || !/^\d{4}-\d\d-\d\d$/.test(String(r.date)) || !Number.isFinite(r.clicks) || !Number.isFinite(r.impressions)) { dropped++; continue; }
    const path = (page.replace(/\/+$/, '') || '/').slice(0, s.max_path_length), key = `${r.date}\u0000${path}`;
    const a = agg.get(key) || { day: r.date, page: path, clicks: 0, impressions: 0, posWeighted: 0, posWeight: 0 };
    a.clicks += Math.trunc(r.clicks); a.impressions += Math.trunc(r.impressions);
    if (Number.isFinite(r.position)) { const w = Math.max(1, Math.trunc(r.impressions)); a.posWeighted += r.position * w; a.posWeight += w; }
    agg.set(key, a);
  }
  let kept = 0;
  for (const a of agg.values()) {
    await run(db, `INSERT OR REPLACE INTO analytics_search (day, page, clicks, impressions, position) VALUES (?,?,?,?,?)`,
      a.day, a.page, a.clicks, a.impressions, a.posWeight ? a.posWeighted / a.posWeight : null);
    kept++;
  }
  ctx?.notes?.push(`analytics search: ${kept} row(s) stored, ${dropped} dropped`);
}

// Read side for the organization's own dashboard.
export async function report({ db, now = Date.now, days = 7, limit = 5 }) {
  const since = iso(now() - days * 86400e3).slice(0, 10);
  return {
    since,
    pageviews: (await first(db, `SELECT COALESCE(SUM(pageviews),0) AS n FROM analytics_daily WHERE day >= ?`, since)).n,
    top_pages: await all(db, `SELECT path, SUM(pageviews) AS pageviews FROM analytics_daily WHERE day >= ? GROUP BY path ORDER BY pageviews DESC, path LIMIT ?`, since, limit),
    top_sources: await all(db, `SELECT source, SUM(pageviews) AS pageviews FROM analytics_sources WHERE day >= ? GROUP BY source ORDER BY pageviews DESC, source LIMIT ?`, since, limit),
    top_search: await all(db, `SELECT page, SUM(clicks) AS clicks, SUM(impressions) AS impressions FROM analytics_search WHERE day >= ? GROUP BY page ORDER BY clicks DESC, impressions DESC, page LIMIT ?`, since, limit),
  };
}
