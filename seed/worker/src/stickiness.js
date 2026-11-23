// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// STICKY-1 (Rowan, 2026-11-22): "Every ultra-stable app, every tenant, every platform needs to be sticky and give people a reason to come back ...
// breadth, depth, diversity ... fresh content is what builds audiences, and promoting that content too."
// The tick step `stickiness` judges every system declared in config.progress.systems that carries a `stickiness` block ({ content_feed, domains,
// expect_days, audience_url? }). It reads the system's own JSON Feed, measures freshness, breadth, depth and diversity with core/stickiness, appends a
// daily series, files STICKY-<id> (a growth item with a prediction and a closing probe) while the system is stale, thin or narrow and closes it when the
// same reading passes, and keeps a social queue of entries not yet promoted that the core social module drains (gate.tenant_queues lists
// /api/stickiness/queue/<id>.json). A system with no declaration is reported `undeclared`, never fresh. Nothing is invented: only entries the feed holds.
import { measure, plan, record, trend, fromJsonFeed, queue } from './vendor/core/stickiness.js';
import { ORIGINATE_MAX_PER_DAY } from './tick.js';
// The daily originate cap is spent early by other filers (16075 refusals on 2026-11-21), which would starve these items for good. A system has at most one
// STICKY item (its id is fixed, so a refile is a no-op), so a small reserve above the cap keeps the finding from being starved without raising the flood.
export const STICKY_RESERVE = 5;

const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
// SCHEMA-SELF-1: the Worker carries its own DDL; kept equal to migrations/0030_stickiness.sql by test/stickiness.test.js.
export const STICKINESS_DDL = [
  `CREATE TABLE IF NOT EXISTS stickiness_state (system TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL, score REAL, last_at TEXT, hours_since REAL, n_7d INTEGER NOT NULL DEFAULT 0, n_30d INTEGER NOT NULL DEFAULT 0, measure TEXT, plan TEXT, queue TEXT, error TEXT, checked_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS stickiness_series (system TEXT NOT NULL, day TEXT NOT NULL, row TEXT NOT NULL, PRIMARY KEY (system, day))`,
];
let ready = false;
async function ensure(db) { if (ready) return; for (const s of STICKINESS_DDL) await db.prepare(s).run(); ready = true; }
export const _reset = () => { ready = false; };
const BAD = new Set(['stale', 'aging', 'thin', 'narrow', 'unmeasured']);

// The audience, from the system's own first-party counts. The analytics beacon stores nothing in the browser and its visitor id rotates daily, so a
// returning visitor cannot be told from a new one there (a privacy guard, not to be weakened). What is measurable without it: visitor-days from the hits
// table for a host this deployment counts (analytics_host) and distinct daily readers of its feeds (name 'feed', recorded server-side by the site worker).
// A system may also serve { visits_7d, returning_7d, subscribers } at audience_url. A return rate is computed only from a real returning count.
async function audienceOf(db, st, f, now) {
  let out = null;
  if (st.analytics_host) {
    try {
      const w = now - 7 * 864e5, q = (name, bot) => `SELECT COUNT(*) c FROM (SELECT DISTINCT vid, substr(datetime(at/1000,'unixepoch'),1,10) d FROM hits WHERE at>=? AND host=? AND name='${name}'${bot ? ' AND bot=0' : ''})`;
      const v = (await db.prepare(q('pageview', true)).bind(w, st.analytics_host).first()) || {}, fd = (await db.prepare(q('feed', false)).bind(w, st.analytics_host).first()) || {};
      out = { visits_7d: v.c || 0, feed_hits_7d: fd.c || 0 };
    } catch (e) { /* allow-silent: no hits table here, so the audience stays unmeasured */ }
  }
  if (st.audience_url) { try { const r = await f(st.audience_url); if (r.ok) out = { ...(out || {}), ...(await r.json()) }; } catch (e) { /* allow-silent: an unreadable count stays unmeasured */ } }
  return out;
}
async function promoted(db) { try { return (await all(db, `SELECT DISTINCT id FROM social_posted`)).map(r => r.id.replace(/^sticky:/, '')); } catch (e) { return []; } }  // no social table yet: nothing promoted

export async function stickinessStep({ db, config, ensureItem, fetchImpl = fetch, now = Date.now() }) {
  const cfg = config && config.progress;
  if (!cfg || !Array.isArray(cfg.systems) || !cfg.systems.length) return { status: 'no-config' };
  await ensure(db);
  const nowIso = new Date(now).toISOString(), out = { systems: {}, filed: [], closed: [], undeclared: [] }, done = await promoted(db);
  for (const sys of cfg.systems) {
    const st = sys.stickiness, id = `STICKY-${sys.id}`.slice(0, 80);
    if (!st || !st.content_feed) {
      out.undeclared.push(sys.id); out.systems[sys.id] = 'undeclared';
      await run(db, `INSERT INTO stickiness_state (system, name, state, checked_at) VALUES (?,?,?,?) ON CONFLICT(system) DO UPDATE SET state=excluded.state, checked_at=excluded.checked_at`, sys.id, sys.name, 'undeclared', nowIso);
      continue;
    }
    let entries = [], error = null;
    try { const r = await fetchImpl(st.content_feed, { headers: { accept: 'application/feed+json, application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); entries = fromJsonFeed(await r.json()); }
    catch (e) { error = String(e && e.message || e).slice(0, 120); }
    if (error) {  // an unreadable feed is a failed reading, never a fresh or a stale one; the last good row stays
      await run(db, `INSERT INTO stickiness_state (system, name, state, error, checked_at) VALUES (?,?,?,?,?) ON CONFLICT(system) DO UPDATE SET state=excluded.state, error=excluded.error, checked_at=excluded.checked_at`, sys.id, sys.name, 'unreadable', error, nowIso);
      out.systems[sys.id] = 'unreadable'; continue;
    }
    const mc = { now, audience: await audienceOf(db, st, fetchImpl, now), domains: st.domains || [], expect_days: st.expect_days || 2, min_depth: st.min_depth || 3 };
    const m = measure(entries, mc), acts = plan(m, mc), q = queue(entries, { now, posted: done, reveal: st.reveal || '', max_per_day: st.max_per_day || 2, since_days: st.since_days || 14, arm: 'sticky' });
    const series = record([], m, { now })[0];
    await run(db, `INSERT INTO stickiness_series (system, day, row) VALUES (?,?,?) ON CONFLICT(system, day) DO UPDATE SET row=excluded.row`, sys.id, series.day, JSON.stringify(series));
    await run(db, `DELETE FROM stickiness_series WHERE system = ? AND day < ?`, sys.id, new Date(now - 400 * 864e5).toISOString().slice(0, 10));
    await run(db, `INSERT INTO stickiness_state (system, name, state, score, last_at, hours_since, n_7d, n_30d, measure, plan, queue, error, checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(system) DO UPDATE SET name=excluded.name, state=excluded.state, score=excluded.score, last_at=excluded.last_at, hours_since=excluded.hours_since, n_7d=excluded.n_7d, n_30d=excluded.n_30d, measure=excluded.measure, plan=excluded.plan, queue=excluded.queue, error=NULL, checked_at=excluded.checked_at`,
      sys.id, sys.name, m.state, m.score, m.fresh.last_at, m.fresh.hours_since, m.fresh.n_7d, m.fresh.n_30d, JSON.stringify(m), JSON.stringify(acts), JSON.stringify(q), null, nowIso);
    out.systems[sys.id] = m.state;
    if (BAD.has(m.state) && ensureItem) {
      const a = acts[0];
      const made = await ensureItem(db, { id, kind: 'growth', owner_role: 'product-manager', priority: m.state === 'stale' || m.state === 'unmeasured' ? -1 : 0,
        title: `${sys.name} is ${m.state} as a reason to come back: ${a ? a.kind + (a.domain ? ' in ' + a.domain : '') + ', ' + a.why : 'no plan'}. Prediction: ${a ? a.prediction : 'n/a'}.`.slice(0, 400),
        done_check: `stickiness_state.state of ${sys.id} is fresh`, closing_probe: `stickiness:${sys.id}` }, { cap: ORIGINATE_MAX_PER_DAY + STICKY_RESERVE, now });
      if (made) out.filed.push(id);
      else { const r = await run(db, `UPDATE items SET status='ready', disposition=NULL, updated_at=? WHERE id=? AND status IN ('done','superseded','cancelled')`, nowIso, id).catch(() => null); if (r && r.meta && r.meta.changes) out.filed.push(id); }
    } else if (m.state === 'fresh') {
      const r = await run(db, `UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=? AND status NOT IN ('done','superseded','cancelled')`, `probe green: stickiness:${sys.id} fresh, last entry ${m.fresh.last_at}`, nowIso, id).catch(() => null);
      if (r && r.meta && r.meta.changes) out.closed.push(id);
    }
  }
  return out;
}

// What the public pages read: each system's judged state, its plan and its daily series with the trend.
export async function readStickiness(db, { now = Date.now() } = {}) {
  await ensure(db);
  const systems = [];
  for (const r of await all(db, `SELECT * FROM stickiness_state ORDER BY system`)) {
    const series = (await all(db, `SELECT row FROM stickiness_series WHERE system = ? ORDER BY day`, r.system)).map(x => JSON.parse(x.row));
    systems.push({ system: r.system, name: r.name, state: r.state, score: r.score, last_at: r.last_at, hours_since: r.hours_since, n_7d: r.n_7d, n_30d: r.n_30d, error: r.error, checked_at: r.checked_at,
      measure: r.measure ? JSON.parse(r.measure) : null, plan: r.plan ? JSON.parse(r.plan) : [], series, trend: { score: trend(series, 'score', { now }), n_7d: trend(series, 'n_7d', { now, eps: 0.5 }) } });
  }
  return { systems };
}
// The social queue the core social module drains for one system ({ posts: [] } until it has been measured).
export async function readQueue(db, system) {
  await ensure(db);
  const r = await db.prepare(`SELECT queue FROM stickiness_state WHERE system = ?`).bind(system).first();
  return r && r.queue ? JSON.parse(r.queue) : { posts: [] };
}
