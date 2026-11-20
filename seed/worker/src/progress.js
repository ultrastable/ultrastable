// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// PROGRESS-1 (Rowan, 2026-11-20): "I will check the front end. And I expect to see noticeable progress every time I check it. Every day, every
// week, every month ... in every single ultra-stable system deployed, including new client apps and new tenants."
// The tick step `progress` is the release cadence monitor. For every system in config.progress.systems it reads that repository's merged changes
// (cached by livechanges.js), judges the cadence with workers/core/progress (bookkeeping merges never count), writes the judgement to
// progress_cadence, and repairs a slow or stalled system: it dispatches the workflows that produce that system's work (at most once per
// cooldown) and, when stalled, files STALL-<system>, which only the same reading can close. Nothing is ever reported as shipped that did not merge.
import { cadence, normalize } from '../../../workers/core/progress/index.js';

const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];

// SCHEMA-SELF-1: the Worker carries its own DDL; kept equal to migrations/0028_progress.sql by test/progress.test.js.
export const PROGRESS_DDL = [
  `CREATE TABLE IF NOT EXISTS progress_cadence (system TEXT PRIMARY KEY, name TEXT NOT NULL, repo TEXT NOT NULL, url TEXT, state TEXT NOT NULL, last_at TEXT, hours_since REAL, expect_hours REAL NOT NULL, shipped_24h INTEGER NOT NULL DEFAULT 0, shipped_7d INTEGER NOT NULL DEFAULT 0, refreshed_at TEXT, heal TEXT, healed_at TEXT, checked_at TEXT NOT NULL)`,
];
let ready = false;
async function ensure(db) { if (ready) return; for (const s of PROGRESS_DDL) await db.prepare(s).run(); ready = true; }
export const _reset = () => { ready = false; };

const eventOf = (sys, x) => ({ id: sys.id + '#' + x.n, at: x.merged_at, system: sys.id, system_name: sys.name, title: x.title, url: x.url, kind: 'change', by: x.by_origin });

async function dispatch({ token, repo, workflow, fetchImpl }) {
  try {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-progress', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'main' }) });
    return r.status === 204 ? 'dispatched' : 'HTTP ' + r.status;
  } catch (e) { return 'error ' + String(e && e.message).slice(0, 80); }
}

export async function progressStep({ db, config, token, ensureItem, fetchImpl = fetch, now = Date.now() }) {
  const cfg = config && config.progress;
  if (!cfg || !Array.isArray(cfg.systems) || !cfg.systems.length) return { status: 'no-config' };
  await ensure(db);
  const nowIso = new Date(now).toISOString(), cooldown = (cfg.cooldown_hours || 6) * 3600e3, out = { systems: {}, healed: [], filed: [], closed: [] };
  const prev = Object.fromEntries((await all(db, `SELECT system, healed_at FROM progress_cadence`)).map(r => [r.system, r.healed_at]));
  for (const sys of cfg.systems) {
    const rows = await all(db, `SELECT n, title, by_origin, merged_at, url FROM live_changes WHERE repo = ? ORDER BY merged_at DESC LIMIT 200`, sys.repo);
    const meta = await db.prepare(`SELECT refreshed_at FROM live_changes_meta WHERE repo = ?`).bind(sys.repo).first();
    const c = cadence(rows.map(x => eventOf(sys, x)), { now, expect_hours: sys.expect_hours || cfg.expect_hours || 24, stall: cfg.stall || 2 });
    let heal = null, healedAt = prev[sys.id] || null;
    const id = `STALL-${sys.id}`.slice(0, 80);
    if (c.state === 'slow' || c.state === 'stalled') {
      if (!token) heal = 'no-token';
      else if (healedAt && now - Date.parse(healedAt) < cooldown) heal = 'cooldown';
      else {
        const res = [];
        for (const wf of sys.heal || []) res.push(wf + ': ' + await dispatch({ token, repo: sys.repo, workflow: wf, fetchImpl }));
        heal = res.join('; ') || 'no workflow declared'; healedAt = nowIso; out.healed.push(sys.id);
      }
    }
    if (c.state === 'stalled' && ensureItem) {
      const made = await ensureItem(db, { id, kind: 'growth', owner_role: 'product-manager', priority: -1,
        title: `${sys.name} has shipped nothing a returning reader can see for ${c.hours_since} h (it declares one substantive change every ${c.expect_hours} h). Ship the next improvement from its queue; if the queue is empty, originate one from its measures.`.slice(0, 400),
        done_check: `progress_cadence.state of ${sys.id} is moving`, closing_probe: `progress:${sys.id}` });
      if (made) out.filed.push(id);
      else { const r = await run(db, `UPDATE items SET status='ready', disposition=NULL, updated_at=? WHERE id=? AND status IN ('done','superseded','cancelled')`, nowIso, id); if (r.meta && r.meta.changes) out.filed.push(id); }
    } else if (c.state === 'moving') {
      const r = await run(db, `UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=? AND status NOT IN ('done','superseded','cancelled')`, `probe green: progress:${sys.id} moving, last change ${c.last_at}`, nowIso, id).catch(() => null);  // no items table yet on a first boot
      if (r && r.meta && r.meta.changes) out.closed.push(id);
    }
    await run(db, `INSERT INTO progress_cadence (system, name, repo, url, state, last_at, hours_since, expect_hours, shipped_24h, shipped_7d, refreshed_at, heal, healed_at, checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(system) DO UPDATE SET name=excluded.name, repo=excluded.repo, url=excluded.url, state=excluded.state, last_at=excluded.last_at, hours_since=excluded.hours_since, expect_hours=excluded.expect_hours,
      shipped_24h=excluded.shipped_24h, shipped_7d=excluded.shipped_7d, refreshed_at=excluded.refreshed_at, heal=COALESCE(excluded.heal, progress_cadence.heal), healed_at=excluded.healed_at, checked_at=excluded.checked_at`,
      sys.id, sys.name, sys.repo, sys.url || null, c.state, c.last_at, c.hours_since, c.expect_hours, c.shipped_24h, c.shipped_7d, (meta && meta.refreshed_at) || null, heal, healedAt, nowIso);
    out.systems[sys.id] = c.state;
  }
  return out;
}

// What the public pages read: the judged cadence of every system and the merged changes behind it, newest first.
export async function readProgress(db, config, { days = 35, limit = 400 } = {}) {
  const cfg = (config && config.progress) || { systems: [] };
  await ensure(db);
  const cad = Object.fromEntries((await all(db, `SELECT * FROM progress_cadence`)).map(r => [r.system, r]));
  const from = new Date(Date.now() - days * 86400e3).toISOString(), events = [];
  for (const sys of cfg.systems || []) for (const x of await all(db, `SELECT n, title, by_origin, merged_at, url FROM live_changes WHERE repo = ? AND merged_at >= ? ORDER BY merged_at DESC LIMIT ?`, sys.repo, from, limit)) events.push(eventOf(sys, x));
  const systems = (cfg.systems || []).map(s => { const c = cad[s.id]; return { id: s.id, name: s.name, url: s.url || null, feed: s.feed || null, releases: s.releases || null, repo: s.repo, expect_hours: s.expect_hours || cfg.expect_hours || 24,
    state: c ? c.state : 'unmeasured', last_at: c ? c.last_at : null, hours_since: c ? c.hours_since : null, shipped_24h: c ? c.shipped_24h : 0, shipped_7d: c ? c.shipped_7d : 0, refreshed_at: c ? c.refreshed_at : null, heal: c ? c.heal : null, healed_at: c ? c.healed_at : null, checked_at: c ? c.checked_at : null }; });
  return { marker: 'PROGRESS-1', checked_at: systems.map(s => s.checked_at).filter(Boolean).sort().pop() || null, window_days: days, systems, events: normalize(events) };
}

export async function stalledSystems(db) {
  try { const r = await db.prepare(`SELECT COUNT(*) AS n FROM progress_cadence WHERE state = 'stalled'`).first(); return r ? r.n : 0; } catch { return 0; }
}
