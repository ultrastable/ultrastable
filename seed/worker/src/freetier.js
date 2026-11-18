// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// FREE-TIER-1 (2026-11-17): the demo runs inside Cloudflare's free plan. The limits below are the plan's published DAILY allowances for the whole
// account (https://developers.cloudflare.com/d1/platform/limits/ and /workers/platform/limits/, checked 2026-11-17). Hourly per-database caps
// (cost_budgets) are advisory: one 50k-row analytics refresh is 1% of the day and must never pause the work queue (OPS-QUEUE-1).
// DECISION-METRIC: free-tier-governor (the level set here is logged and scored by src/decisions.js recordGovernor)
// Levels: ok < degrade (80% of the day, or projected to pass 100%) < shed (95%). Degrade and shed skip non-essential steps; the clock never stops.
const API = 'https://api.cloudflare.com/client/v4/graphql';
export const FREE_LIMITS = {
  d1_rows_read: { per_day: 5_000_000, label: 'D1 rows read (account)' },
  d1_rows_written: { per_day: 100_000, label: 'D1 rows written (account)' },
  workers_requests: { per_day: 100_000, label: 'Workers requests (account)' },
  ai_neurons: { per_day: 10_000, label: 'Workers AI neurons (account)' },
};
export const DEGRADE_AT = 0.8, SHED_AT = 0.95;
const dayStart = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

// Pure: usage = { resource: usedToday }. Projection extrapolates today's pace to 24 h once at least 2 h of the day have passed.
export function evaluate(usage, now = new Date(), limits = FREE_LIMITS) {
  const hours = Math.max(0.001, (now - dayStart(now)) / 3600e3);
  const rows = {};
  let level = 'ok';
  for (const [k, l] of Object.entries(limits)) {
    const used = usage[k];
    if (used == null) { rows[k] = { used: null, limit: l.per_day, level: 'unmeasured' }; continue; }
    const frac = used / l.per_day, projected = hours >= 2 ? used / hours * 24 / l.per_day : frac;
    const lv = frac >= SHED_AT ? 'shed' : (frac >= DEGRADE_AT || projected >= 1) ? 'degrade' : 'ok';
    rows[k] = { used, limit: l.per_day, frac: +frac.toFixed(3), projected_frac: +projected.toFixed(3), level: lv };
    if (lv === 'shed' || (lv === 'degrade' && level === 'ok')) level = lv;
  }
  return { level, resources: rows };
}

export async function sampleFreeTier(db, { token, account_id, fetch: f = fetch, now = new Date() }) {
  const at = now.toISOString().replace('T', ' ').slice(0, 19), from = dayStart(now).toISOString(), to = now.toISOString();
  const used = {}; let error = null;
  if (!token) error = 'no Cloudflare analytics token bound (CF_ANALYTICS_TOKEN)';
  else try {
    const q = `{viewer{accounts(filter:{accountTag:"${account_id}"}){d1:d1AnalyticsAdaptiveGroups(limit:1000,filter:{datetime_geq:"${from}",datetime_leq:"${to}"}){sum{rowsRead rowsWritten}} w:workersInvocationsAdaptive(limit:1000,filter:{datetime_geq:"${from}",datetime_leq:"${to}"}){sum{requests}}}}}`;
    const r = await f(API, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ query: q }) });
    const j = await r.json();
    if (!r.ok || (j.errors && j.errors.length)) error = `graphql ${r.status} ${JSON.stringify(j.errors || []).slice(0, 150)}`;
    else {
      const a = j.data.viewer.accounts[0] || {};
      used.d1_rows_read = (a.d1 || []).reduce((s, g) => s + Number(g.sum.rowsRead || 0), 0);
      used.d1_rows_written = (a.d1 || []).reduce((s, g) => s + Number(g.sum.rowsWritten || 0), 0);
      used.workers_requests = (a.w || []).reduce((s, g) => s + Number(g.sum.requests || 0), 0);
    }
  } catch (e) { error = String(e.message).slice(0, 150); }
  if (token && error) error = error.split(token).join('***');
  // Neurons are metered in-process (budget_ledger), so they need no token.
  try {
    const n = await db.prepare("SELECT COALESCE(SUM(units),0) u FROM budget_ledger WHERE day=?1 AND kind='ai_neurons'").bind(at.slice(0, 10)).first();
    used.ai_neurons = Number((n && n.u) || 0);
  } catch (e) { /* ledger absent until the first model call */ used.ai_neurons = 0; }
  const keys = Object.keys(FREE_LIMITS);
  for (const k of keys) await db.prepare('INSERT INTO free_tier_samples (at, resource, used_today, error) VALUES (?,?,?,?)').bind(at, k, used[k] ?? null, used[k] == null ? error : null).run();
  return { at, used, error, ...evaluate(used, now) };
}

// Latest sample per resource from the last 2 h (older is unmeasured). A failed or missing sample is never a breach.
export async function freeTierLevel(db, now = Date.now()) {
  const since = new Date(now - 7200e3).toISOString().replace('T', ' ').slice(0, 19);
  const used = {};
  for (const k of Object.keys(FREE_LIMITS)) {
    const s = await db.prepare('SELECT used_today u FROM free_tier_samples WHERE resource=? AND at>=? AND used_today IS NOT NULL ORDER BY at DESC, id DESC LIMIT 1').bind(k, since).first();
    if (s) used[k] = Number(s.u);
  }
  return evaluate(used, new Date(now));
}

// READ-BUDGET-8: an alert before the allowance is spent. When any free daily limit is projected to pass EARLY_ALERT_AT of the day (at the current pace)
// or is already at the degrade level, one backlog item per resource per day is filed (INSERT OR IGNORE on the id), with a closing probe. The level that
// throttles the tick is not the only signal: the day's cap was spent on 2026-11-18 while the governor was reading. Never throws; a refused write is logged.
export const EARLY_ALERT_AT = 0.7;
export async function alertFreeTier(db, result, now = new Date()) {
  const filed = [];
  try {
    const day = now.toISOString().slice(0, 10);
    for (const [k, r] of Object.entries((result && result.resources) || {})) {
      if (!r || r.used == null) continue;
      const at = Math.max(r.frac || 0, r.projected_frac || 0);
      if (at < EARLY_ALERT_AT && r.level === 'ok') continue;
      const id = `FREE-TIER-ALERT-${k}-${day}`;
      const res = await db.prepare("INSERT OR IGNORE INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, surface) VALUES (?,?,?,?,?,?,?,'ready',?)")
        .bind(id, `Free-tier alert: ${FREE_LIMITS[k] ? FREE_LIMITS[k].label : k} at ${Math.round((r.frac || 0) * 100)}% of the day, projected ${Math.round((r.projected_frac || 0) * 100)}%`, 'fix', 'operations',
          `${k} stays under its free daily limit for the rest of the UTC day`, `free_tier_samples latest ${k} used_today / ${FREE_LIMITS[k] ? FREE_LIMITS[k].per_day : '?'} < 1 at 23:50 UTC`, 1, 'cost').run();
      if (res && res.meta && res.meta.changes) filed.push(id);
    }
  } catch (e) { filed.error = String(e && e.message).slice(0, 150); console.error('free-tier alert:', filed.error); }  // the caller reads .error
  return filed;
}
