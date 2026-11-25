// The heartbeat. One call = one tick. Pure logic over a D1-compatible database handle,
// so the same code runs in the Worker (D1) and in tests (node:sqlite shim).
//
// Lesson from AIOS ("PID 1 must never die"): every step is guarded. A failing step is
// recorded in the tick's errors and as a backlog item; the remaining steps still run.

import { ensureLedger } from './budget.js';
import { over_budget } from './costsample.js';
import { readSpend, dueEvery } from './spend.js';  // SPEND-SOFT-1
import { planOf } from './budget.js';  // PLAN-1
import { freeTierLevel } from './freetier.js';  // FREE-TIER-1: the daily account-wide free-plan level gates the tick  // Q-LESSON-COST-SAMPLE-ACT: a D1 rows-read breach holds the tick lean  // ORIGINATE-CAP-1: the daily cap is counted in the budget ledger
import { criticalityStep } from './criticality.js';
import { pickForRole } from './critloop.js';
import { selfAuditStep, loopBreak } from './selfaudit.js';
import { unknownsStep } from './unknowns.js';
import { goalsStep, seedGoals } from './goals.js';  // GOALS-1
import { migrateStep } from './migrate.js';
import { executeStep, claimsReleasedUnworked24h } from './doer.js';
import { pulseStep, tickCadenceMin } from './pulse.js';
import { ignitionStep } from './ignition.js';
import { ensureSchema as ensureCredentialSchema } from './auth/store.js';  // CONNECTOR-HEALTH-1
import { hireStep, isOff } from './managers.js';  // MANAGERS-1: the register hires; an off manager is not dispatched
import { OWN_SQL, tenantOf } from './tenant.js';  // Q-TENANT-row-isolation: a runtime acts only on rows with tenant_id NULL (own) or its own slug

const TERMINAL = ['done', 'superseded', 'cancelled'];
const OPS = {
  '>=': (a, b) => a >= b, '<=': (a, b) => a <= b,
  '>': (a, b) => a > b, '<': (a, b) => a < b, '=': (a, b) => a === b,
};

async function all(db, sql, ...args) {
  const r = await db.prepare(sql).bind(...args).all();
  return r.results || [];
}
async function first(db, sql, ...args) {
  return (await db.prepare(sql).bind(...args).first()) || null;
}
async function run(db, sql, ...args) {
  return db.prepare(sql).bind(...args).run();
}
function iso(d) { return d.toISOString().replace('T', ' ').slice(0, 19); }

// Built-in metrics a prediction can name. Each returns a number.
export const METRICS = {
  stalled_systems: db => first(db, `SELECT COUNT(*) AS n FROM progress_cadence WHERE state = 'stalled'`).then(r => r.n, () => 0),  // PROGRESS-1: systems that shipped nothing visible for two of their declared intervals; no table yet reads 0
  tick_runs_completed_1h: (db, now) => first(db,
    `SELECT COUNT(*) AS n FROM tick_runs WHERE finished_at >= ? AND steps_completed = steps_total`,
    iso(new Date(now - 3600e3))).then(r => r.n),
  // PACE-1: speed is measured, not asserted. beats_24h is how many loop runs the clock recorded; beats_productive_share_24h is the share of
  // them that finished ok and returned something (an empty result {}, [] or null is an idle run). Both read loop_beats; a Worker whose table does
  // not exist yet reports 0, never throws.
  beats_24h: (db, now) => first(db, `SELECT COUNT(*) AS n FROM loop_beats WHERE started_at >= ?`, iso(new Date(now - 86400e3))).then(r => r.n).catch(() => 0),
  beats_productive_share_24h: (db, now) => first(db,
    `SELECT COUNT(*) AS n, SUM(CASE WHEN ok = 1 AND detail IS NOT NULL AND detail NOT IN ('null','{}','[]') AND detail NOT LIKE '{"paced"%' THEN 1 ELSE 0 END) AS p FROM loop_beats WHERE started_at >= ?`,
    iso(new Date(now - 86400e3))).then(r => (r.n ? Math.round(1000 * (r.p || 0) / r.n) / 1000 : 0)).catch(() => 0),
  // PACE-2: cost per day against the free plan. The largest share of any free daily limit used today (freetier.js samples; 1 = the whole free day).
  // No fresh sample is 0 here and stays visible as its own breach in freetier.js, never as a healthy cost.
  free_tier_peak_share: (db, now) => freeTierLevel(db, now).then(l => Math.round(1000 * Math.max(0, ...Object.values((l && l.resources) || {}).map(r => Number(r.frac)).filter(Number.isFinite))) / 1000).catch(() => 0),
  // GOALS-1: the share of loops that closed (an ok run in at least 90% of their runs) in the last 24 h. A loop with no run is not counted: pulse.js reports the missing ones.
  loops_closing_share_24h: (db, now) => first(db, `SELECT COUNT(*) AS n, SUM(CASE WHEN good >= 0.9 THEN 1 ELSE 0 END) AS c FROM (SELECT loop, 1.0 * SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) / COUNT(*) AS good FROM loop_beats WHERE started_at >= ? AND finished_at IS NOT NULL GROUP BY loop)`,
    iso(new Date(now - 86400e3))).then(r => (r.n ? Math.round(1000 * (r.c || 0) / r.n) / 1000 : 0)).catch(() => 0),
  goal_tenants: (db) => first(db, `SELECT COUNT(DISTINCT tenant) AS n FROM goals WHERE tenant != 'core' AND status = 'active'`).then(r => r.n).catch(() => 0),
  items_done: (db, now, tenant) => first(db, `SELECT COUNT(*) AS n FROM items WHERE status='done' AND ${OWN_SQL()}`, tenantOf(tenant)).then(r => r.n),
  open_gate_cards: (db, now, tenant) => first(db, `SELECT COUNT(*) AS n FROM gate_cards WHERE status='open' AND ${OWN_SQL()}`, tenantOf(tenant)).then(r => r.n),
  dispatches_24h: (db, now) => first(db, `SELECT COUNT(*) AS n FROM dispatches WHERE at >= ?`, iso(new Date(now - 86400e3))).then(r => r.n),
  items_done_7d: (db, now, tenant) => first(db, `SELECT COUNT(*) AS n FROM items WHERE status='done' AND updated_at >= ? AND ${OWN_SQL()}`, iso(new Date(now - 7 * 86400e3)), tenantOf(tenant)).then(r => r.n),
  verified_outcomes_7d: (db, now) => first(db, `SELECT COUNT(*) AS n FROM outcomes WHERE result='verified' AND at >= ?`, iso(new Date(now - 7 * 86400e3))).then(r => r.n),
  // An objective with no probe-backed target metric is not instrumented; the agents do not yet know how to tell whether they are winning.
  objectives_without_probe: (db) => first(db,
    `SELECT COUNT(*) AS n FROM objectives o WHERE o.tenant_id IS NULL AND NOT EXISTS (SELECT 1 FROM metrics m WHERE m.tenant_id IS NULL AND m.objective_id = o.id AND m.kind = 'target' AND m.source IN ('builtin','sql','http'))`).then(r => r.n),
  // ADMIT-1 red team (2026-11-25): nothing watched D1 growth; a database that reaches its size limit refuses every write and the whole loop stops.
  // The share of the free plan's per-database limit this database uses, from D1's own size_after (PRAGMA page_count on a SQLite shim). Unreadable is
  // NaN, which the measure step counts as a breach, never as a healthy 0.
  db_size_share: (db) => dbSizeBytes(db).then(b => (Number.isFinite(b) && b > 0 ? Math.round(1000 * b / DB_LIMIT_BYTES) / 1000 : NaN)),
  metrics_in_breach: (db) => first(db, `SELECT COUNT(*) AS n FROM metrics WHERE breached = 1 AND tenant_id IS NULL`).then(r => r.n),
  claims_released_unworked_24h: claimsReleasedUnworked24h,  // DOER-1 (workers#173): target 0
  silent_drops_7d: (db, now) => first(db,
    `SELECT COUNT(*) AS n FROM outcomes WHERE result='silent_drop' AND at >= ?`,
    iso(new Date(now - 7 * 86400e3))).then(r => r.n),
};

export const DB_LIMIT_BYTES = 500e6;  // D1 per-database limit on the Workers Free plan (10 GB on Paid); the smaller one, so the guard holds on either
export async function dbSizeBytes(db) {
  const r = await db.prepare('SELECT 1 AS n').all().catch(() => null);
  const m = Number(r && r.meta && r.meta.size_after);
  if (Number.isFinite(m) && m > 0) return m;
  try { const c = await db.prepare('PRAGMA page_count').first(), z = await db.prepare('PRAGMA page_size').first(); return Number(c && c.page_count) * Number(z && z.page_size); }
  catch (e) { return NaN; }  // allow-silent: no reading is NaN, a breach in measure, never a pass
}

export function reliability(successes, outcomes, trust) {
  const w = trust.prior_weight, b = trust.baseline;
  return (successes + b * w) / (outcomes + w);
}

// ORIGINATE-CAP-1 (2026-11-16): the system files at most this many items of its own a day (owner- and GitHub-filed items come in through issuesync,
// not here). Lesson from an earlier fleet whose loops filed work about their own metrics and tickets until it held ~7,500 open issues and spent
// model calls working them. Past the cap an item is not filed; the refusal is counted in budget_ledger (kind 'originated', refused).
export const ORIGINATE_MAX_PER_DAY = 20;
export async function ensureItem(db, item, { cap = ORIGINATE_MAX_PER_DAY, now = Date.now() } = {}) {
  const existing = await first(db, `SELECT id FROM items WHERE id = ?`, item.id);
  if (existing) return false;
  await ensureLedger(db);
  const day = new Date(now).toISOString().slice(0, 10);
  const today = await first(db, `SELECT COALESCE(SUM(calls),0) AS n FROM budget_ledger WHERE day = ? AND kind = 'originated'`, day);
  if ((today && today.n) >= cap) {
    await run(db, `INSERT INTO budget_ledger (day, kind, units, calls, refused) VALUES (?, 'originated', 0, 0, 1) ON CONFLICT(day, kind) DO UPDATE SET refused = refused + 1`, day);
    console.log('originate cap reached; not filed', item.id);
    return false;
  }
  await run(db, `INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, surface, action_class)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
    item.id, item.title, item.kind || 'fix', item.owner_role, item.done_check,
    item.closing_probe || null, item.priority ?? 10, item.surface || null, item.action_class || null);
  await run(db, `INSERT INTO budget_ledger (day, kind, units, calls, refused) VALUES (?, 'originated', 0, 1, 0) ON CONFLICT(day, kind) DO UPDATE SET calls = calls + 1`, day);
  return true;
}



// Reads a metric through its probe. sql must be one read-only SELECT; http is healthy (1) on a 2xx answer, else 0.
export async function readMetric(db, m, ctx) {
  if (m.source === 'builtin') {
    const f = METRICS[m.spec];
    if (!f) throw new Error(`unknown builtin ${m.spec}`);
    return Number(await f(db, ctx.now, tenantOf(ctx)));
  }
  if (m.source === 'sql') {
    if (!/^\s*select\b/i.test(m.spec) || m.spec.includes(';')) throw new Error('sql probe must be one SELECT');
    const row = await first(db, m.spec);
    return Number(Object.values(row || {})[0]);
  }
  if (m.source === 'http') {
    try { const res = await (ctx.env.fetch || fetch)(m.spec, { signal: AbortSignal.timeout(8000) }); return res.ok ? 1 : 0; } catch { return 0; }
  }
  if (m.source === 'service') {
    // Q-TENANT-TOPOLOGY-1: spec "<BINDING> <path>" is fetched through a service binding; healthy (1) only when the body says ok and its self-test passed.
    const [bn, path = '/health'] = String(m.spec).split(' ');
    const b = ctx.env && ctx.env[bn];
    if (!b || typeof b.fetch !== 'function') return 0;
    try {
      const res = await b.fetch('https://service.invalid' + path, { signal: AbortSignal.timeout(8000) });
      const j = await res.json();
      return res.ok && j.ok === true && (!j.selftest || j.selftest.result === 'pass') ? 1 : 0;
    } catch { return 0; }
  }
  return null; // declared: named but not probed
}

// The liveness set every system carries (seed/bootstrap/bootstrap.py LIVENESS; test/measure.test.js keeps the two equal).
export const LIVENESS = [
  ['M-tick-heartbeat', 'ticks completed in the last hour', 'tick_runs_completed_1h', '>=', 5, 1.5, 'operations', 'The clock is not turning. Check the Worker cron, the D1 binding and the last tick_runs.errors.'],
  ['M-acting', 'dispatches in the last 24 hours', 'dispatches_24h', '>=', 1, 6, 'operations', 'Ticks run but nothing is handed to a role. Check ready items, role rows and the executor.'],
  ['M-closing', 'items finished in the last 7 days', 'items_done_7d', '>=', 1, 48, 'portfolio-manager', 'Work starts but nothing closes. Find the stuck stage (review, merge, verify) and fix it.'],
  ['M-verified', 'independently verified outcomes in the last 7 days', 'verified_outcomes_7d', '>=', 1, 48, 'reviewer', 'Nothing was verified by a second path. Check that the reviewer role is dispatched and records outcomes.'],
  ['M-no-drops', 'silent drops in the last 7 days', 'silent_drops_7d', '<=', 0, 0, 'portfolio-manager', 'An item left the active set with no disposition. Find it and give it one.'],
  ['M-pace', 'share of loop runs in 24 hours that returned work (idle runs are not progress)', 'beats_productive_share_24h', '>=', 0.05, 24, 'operations', 'Most loop runs return nothing. Lengthen the cadence of idle loops and shorten productive ones (core/pace plan).'],
  ['M-cost', 'largest share of a free daily limit used today (1 = the whole free day)', 'free_tier_peak_share', '<=', 0.8, 0, 'operations', 'A free daily limit is nearly spent. Lengthen idle loops (pace.json) and cut the heaviest reader before the plan sheds work.'],
  ['M-storage', 'share of the per-database size limit this D1 uses (1 = full: every write refused)', 'db_size_share', '<=', 0.6, 0, 'operations', 'The database is past 60% of its size limit. Check retention (autonomy/retention.json), seal and prune the audit chain, and move bulk history to R2 before writes are refused.'],
  ['M-instrumented', 'objectives without a probe-backed target metric', 'objectives_without_probe', '<=', 0, 1, 'product-manager', 'Insert a target metric with a builtin, sql or http probe for the objective.'],
];

// CONNECTOR-HEALTH-1: the consent page a reconnect card links to. Both GitHub credentials share one screen.
export function reconnectLink(ctx, provider) {
  const origin = String((ctx.env && ctx.env.PUBLIC_ORIGIN) || '').replace(/\/$/, '');
  return `${origin}/connect/${String(provider).startsWith('github') ? 'github' : encodeURIComponent(provider)}`;
}

export const STEPS = {
  // Every item that left the active set has a disposition; items whose trigger is done become ready.
  async reconcile(db, ctx) {
    const T = tenantOf(ctx);
    const drops = await all(db,
      `SELECT id FROM items WHERE status IN ('done','superseded','cancelled') AND (disposition IS NULL OR disposition = '') AND ${OWN_SQL()}`, T);
    for (const d of drops) {
      await run(db, `UPDATE items SET status='open', updated_at=? WHERE id=?`, ctx.nowIso, d.id);
      await run(db, `INSERT INTO outcomes (item_id, surface, action_class, result, evidence) VALUES (?, 'work_tracker', 'create_update_close', 'silent_drop', 'reopened by reconcile: no disposition')`, d.id);
    }
    const r = await run(db, `UPDATE items SET status='ready', updated_at=?
      WHERE status='open' AND ${OWN_SQL()} AND (trigger_on IS NULL OR trigger_on IN (SELECT id FROM items WHERE status='done' AND ${OWN_SQL()}))`, ctx.nowIso, T, T);
    ctx.notes.push(`reconciled: ${drops.length} reopened, ${r.meta?.changes ?? 0} became ready`);
    await hireStep(db, ctx);  // MANAGERS-1: every manager that is on in the register has a runtime row before dispatch
  },

  // Claims with no heartbeat for claim_ttl_minutes are released so work never stalls.
  async reap_claims(db, ctx) {
    const cutoff = iso(new Date(ctx.now - ctx.config.claim_ttl_minutes * 60e3));
    const stale = await all(db, `SELECT item_id, agent FROM claims WHERE heartbeat_at < ? AND ${OWN_SQL()}`, cutoff, tenantOf(ctx));
    for (const c of stale) {
      await run(db, `DELETE FROM claims WHERE item_id=?`, c.item_id);
      await run(db, `UPDATE items SET status='ready', updated_at=? WHERE id=? AND status='claimed'`, ctx.nowIso, c.item_id);
      await run(db, `UPDATE dispatches SET status='released' WHERE item_id=? AND status='queued'`, c.item_id);  // counted by claims_released_unworked_24h
    }
    if (stale.length) ctx.notes.push(`released ${stale.length} stale claim(s)`);
  },

  // CONNECTOR-HEALTH-1: every linked connector is read each tick (no new cron): last_ok, expires_at and the result of the refresh attempt
  // refreshDue made just before this tick. A connector whose last two refresh attempts both failed raises one reconnect card whose button is
  // its consent link; probe_gates closes the card when the connector is ok again. Default in effect: every other loop keeps running.
  async connector_health(db, ctx) {
    await ensureCredentialSchema(db);
    const T = tenantOf(ctx), nowMs = Date.parse(ctx.nowIso), report = [];
    for (const c of await all(db, `SELECT tenant, provider, status, expires_at, last_error FROM credentials ORDER BY provider LIMIT 50`)) {
      const ev = await all(db, `SELECT event, at FROM credential_events WHERE tenant = ? AND provider = ? ORDER BY id DESC LIMIT 5`, c.tenant, c.provider);
      const okEv = ev.find(e => e.event === 'refreshed' || e.event === 'minted');
      let failures = 0; for (const e of ev) { if (e.event === 'failed') failures++; else break; }
      const connector = { provider: c.provider, status: c.status, last_ok: okEv ? okEv.at : null, expires_at: c.expires_at || null, expires_in_h: c.expires_at ? Math.round((Date.parse(c.expires_at) - nowMs) / 36e5) : null, failures };
      report.push(connector);
      if (failures < 2) continue;
      const id = `GATE-RECONNECT-${c.provider}`, link = reconnectLink(ctx, c.provider);
      const g = await first(db, `SELECT status FROM gate_cards WHERE id = ? AND ${OWN_SQL()}`, id, T);
      if (g && g.status === 'open') continue;
      if (g) await run(db, `UPDATE gate_cards SET status='open', closed_at=NULL, prepared_by_fleet=? WHERE id = ? AND ${OWN_SQL()}`, link, id, T);
      else await run(db, `INSERT INTO gate_cards (id, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, id,
        `Reconnect ${c.provider}: one click on the consent link`,
        `Identity-bound: the last ${failures} silent refresh attempts failed (${String(c.last_error || 'no detail').slice(0, 120)}), and only the account holder can approve access again`,
        'Loops that need this connector skip their step and say so; every other loop keeps running, and the refresh is tried again every tick',
        link, `connector:${c.provider}`, null);
      ctx.notes.push(`connector ${c.provider} failed ${failures} refreshes: reconnect card ${id} opened`);
    }
    ctx.connectors = report;
  },

  // Gate cards close themselves when their probe shows the owner's step is done.
  async probe_gates(db, ctx) {
    const T = tenantOf(ctx);
    const cards = await all(db, `SELECT id, closing_probe FROM gate_cards WHERE status='open' AND ${OWN_SQL()}`, T);
    let closed = 0;
    for (const c of cards) {
      const [kind, arg] = c.closing_probe.split(':');
      let ok = false;
      if (kind === 'env') ok = Boolean(ctx.env && ctx.env[arg]);
      if (kind === 'owner_items') ok = !(await first(db, `SELECT 1 AS x FROM items WHERE status='blocked' AND blocker LIKE 'owner-only:%' AND ${OWN_SQL()} LIMIT 1`, T));
      if (kind === 'connector') ok = Boolean(await first(db, `SELECT 1 AS x FROM credentials WHERE provider = ? AND status = 'ok'`, arg)) && !(await first(db, `SELECT 1 AS x FROM credentials WHERE provider = ? AND status <> 'ok'`, arg));  // CONNECTOR-HEALTH-1
      if (kind === 'item_done') ok = Boolean(await first(db, `SELECT 1 AS x FROM items WHERE id=? AND status='done' AND ${OWN_SQL()}`, arg, T));
      if (ok) {
        await run(db, `UPDATE gate_cards SET status='closed', closed_at=? WHERE id=? AND ${OWN_SQL()}`, ctx.nowIso, c.id, T);
        closed++;
      }
    }
    ctx.openGates = cards.length - closed;
    if (closed) ctx.notes.push(`closed ${closed} gate card(s) by probe`);
  },

  // OBJECTIVES-1: read every metric through its probe. Outside its healthy condition it files its own remedy item (owner, done check,
  // closing probe) and closes that item when the probe passes again. A new system gets grace_hours before liveness can breach.
  async measure(db, ctx) {
    // LIVENESS-SEED-1: a runtime started without the bootstrap's liveness set (tenant 0 read "measured 0 metric(s)" with 144 of 144 ticks running)
    // seeds the same six metrics itself. INSERT OR IGNORE: an owner's or a bootstrap's row with the same id is never touched.
    for (const [id, name, spec, op, threshold, grace, owner, remedy] of LIVENESS) {
      await run(db, `INSERT OR IGNORE INTO metrics (id, tenant_id, objective_id, name, kind, source, spec, op, threshold, grace_hours, owner_role, remedy)
        VALUES (?, NULL, NULL, ?, 'liveness', 'builtin', ?, ?, ?, ?, ?, ?)`, id, name, spec, op, threshold, grace, owner, remedy);
    }
    // INSTANCE-METRICS-SEED-1: probe-backed metrics an instance declares (config.seed_metrics, built by deploy/deploy-workers.mjs from
    // instances/<slug>/objectives.json) are seeded the same way, so a metric added in code is measured after the next deploy with no manual step.
    for (const m of ctx.config.seed_metrics || []) {
      if (!['builtin', 'sql', 'http', 'service'].includes(m.source)) continue;
      await run(db, `INSERT OR IGNORE INTO metrics (id, tenant_id, objective_id, name, kind, source, spec, op, threshold, grace_hours, owner_role, remedy)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, m.id, m.objective_id || null, m.name, m.kind, m.source, m.spec, m.op, m.threshold, m.grace_hours || 0, m.owner_role, m.remedy);
    }
    const first_tick = await first(db, `SELECT MIN(started_at) AS t FROM tick_runs`);
    const ageH = first_tick && first_tick.t ? (ctx.now - Date.parse(first_tick.t.replace(' ', 'T') + 'Z')) / 3600e3 : 0;
    // TENANT-1: a runtime measures only its own tenant's metrics. Rows of another tenant are never read, never breach, never file items here.
    const ms = await all(db, `SELECT * FROM metrics WHERE tenant_id IS NULL OR tenant_id = ?`, ctx.config.org_slug || '');
    let breached = 0, warming = 0, stale = 0;
    // Q-LESSON-METRIC-FRESH: a metric whose last good reading is older than twice the tick's cadence has lost its producer (the refresher
    // stopped, or its probe keeps failing). That is a liveness breach of its own, item STALE-<id> (stale_metric), closed once a reading is fresh.
    const staleMs = 2 * (await tickCadenceMin(db, ctx.config)) * 60e3;
    for (const m of ms) {
      const staleId = `STALE-${m.id}`;
      const lastMs = m.last_at ? Date.parse(String(m.last_at).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(m.last_at) ? '' : 'Z')) : NaN;
      if (Number.isFinite(lastMs) && ctx.now - lastMs > staleMs && ageH >= m.grace_hours) {
        stale++;
        await run(db, `UPDATE items SET status='ready', disposition=NULL, updated_at=? WHERE id=? AND status IN ('done','superseded','cancelled')`, ctx.nowIso, staleId);
        await ensureItem(db, {
          id: staleId, kind: 'fix', priority: 0, owner_role: m.owner_role,
          title: `stale_metric: ${m.name} has no reading since ${m.last_at} (more than ${Math.round(staleMs / 60e3)} minutes, twice the tick cadence). Restore its producer (${m.source}: ${m.spec}).`.slice(0, 400),
          done_check: `metric ${m.id} has a reading newer than twice the tick cadence`, closing_probe: `metric:${m.id}`,
        });
      } else if (Number.isFinite(lastMs)) {
        await run(db, `UPDATE items SET status='done', disposition='fixed: metric ${m.id} reading is fresh again', updated_at=?
                       WHERE id=? AND status NOT IN ('done','superseded','cancelled')`, ctx.nowIso, staleId);
      }
      let value = null, bad;
      try { value = await readMetric(db, m, ctx); } catch (e) { ctx.notes.push(`metric ${m.id}: ${e.message}`); }
      if (m.source === 'declared' || value === null || Number.isNaN(value)) bad = true; // an unprobed measure is a breach, not a pass
      else bad = !OPS[m.op](value, m.threshold);
      if (bad && ageH < m.grace_hours) { warming++; bad = false; }
      // last_at is the time of the last good reading, so a probe that keeps failing goes stale instead of looking fresh.
      const good = value !== null && !Number.isNaN(value);
      await run(db, `UPDATE metrics SET last_value=?, last_at=CASE WHEN ? THEN ? ELSE last_at END, breached=? WHERE id=?`, value, good ? 1 : 0, ctx.nowIso, bad ? 1 : 0, m.id);
      const itemId = `BREACH-${m.id}`;
      if (bad) {
        breached++;
        const how = m.source === 'declared'
          ? `Build a probe for "${m.spec}" (builtin, sql or http) and update metrics.source/spec so it can be read.`
          : `${m.name} reads ${value}; healthy is ${m.op} ${m.threshold}.`;
        await ensureItem(db, {
          id: itemId, kind: 'fix', priority: m.kind === 'liveness' ? 0 : 5, owner_role: m.owner_role,
          title: `Metric ${m.name} (${m.kind}) is outside its healthy condition. ${how} ${m.remedy}`.slice(0, 400),
          done_check: `metric ${m.id} reads ${m.op} ${m.threshold}`, closing_probe: `metric:${m.id}`,
        });
      } else {
        await run(db, `UPDATE items SET status='done', disposition='fixed: metric ${m.id} healthy again', updated_at=?
                       WHERE id=? AND status NOT IN ('done','superseded','cancelled')`, ctx.nowIso, itemId);
      }
    }
    ctx.notes.push(`measured ${ms.length} metric(s): ${breached} in breach${warming ? `, ${warming} warming up` : ''}${stale ? `, ${stale} stale` : ''}`);
  },

  // Predictions due now are graded against built-in metrics.
  async score_predictions(db, ctx) {
    const due = await all(db, `SELECT * FROM predictions WHERE verdict IS NULL AND due_at <= ?`, ctx.nowIso);
    for (const p of due) {
      const metric = METRICS[p.metric];
      const op = OPS[p.op];
      if (!metric || !op) {
        await run(db, `UPDATE predictions SET verdict='miss', observed=NULL WHERE id=?`, p.id);
        ctx.notes.push(`prediction ${p.id}: unknown metric or op, scored miss`);
        continue;
      }
      const observed = await metric(db, ctx.now, tenantOf(ctx));
      const verdict = op(observed, p.target) ? 'hit' : 'miss';
      await run(db, `UPDATE predictions SET observed=?, verdict=? WHERE id=?`, observed, verdict, p.id);
      ctx.notes.push(`prediction ${p.id}: ${p.metric}=${observed} ${verdict}`);
    }
  },

  // Trust per (surface, action_class) from recorded outcomes; a crossed threshold opens a ladder PR item.
  async accrue_trust(db, ctx) {
    const { trust, ladder } = ctx.config.policy;
    const rows = await all(db, `SELECT surface, action_class,
        SUM(CASE WHEN result='verified' THEN 1 ELSE 0 END) AS ok,
        SUM(CASE WHEN result IN ('hidden_failure','silent_drop') THEN 1 ELSE 0 END) AS severe,
        COUNT(*) AS n
      FROM outcomes GROUP BY surface, action_class`);
    for (const r of rows) {
      const rel = reliability(r.ok, r.n, trust);
      const cur = await first(db, `SELECT rung FROM trust_ledger WHERE surface=? AND action_class=? AND ${OWN_SQL()}`, r.surface, r.action_class, tenantOf(ctx));
      const rung = cur ? cur.rung : ctx.config.policy.surfaces[r.surface]?.start_rung || 'observed';
      await run(db, `INSERT INTO trust_ledger (surface, action_class, rung, reliability, outcomes, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(COALESCE(tenant_id, ''), surface, action_class) DO UPDATE SET reliability=excluded.reliability, outcomes=excluded.outcomes, updated_at=excluded.updated_at`,
        // migration 0027: the key carries the tenant, so this own row (tenant_id NULL) never meets a row of another tenant at the same surface and action class; both accrue
        r.surface, r.action_class, rung, rel, r.n, ctx.nowIso);
      const idx = ladder.rungs.indexOf(rung);
      const maxPerm = ctx.config.policy.surfaces[r.surface]?.max_permission || 'none';
      const ceilingIdx = ladder.rungs.indexOf(ladder.ceiling_by_max_permission[maxPerm] || 'observed');
      const promote = idx >= 0 && idx < ceilingIdx && r.n >= ladder.promote_when.min_outcomes
        && rel >= ladder.promote_when.min_reliability && r.severe === 0;
      const demote = idx > 0 && (rel < ladder.demote_when.reliability_below || r.severe > 0);
      if (promote || demote) {
        const to = ladder.rungs[promote ? idx + 1 : idx - 1];
        const made = await ensureItem(db, {
          id: `LADDER-${r.surface}-${r.action_class}-${to}`,
          title: `${promote ? 'Promote' : 'Demote'} ${r.surface}/${r.action_class} from ${rung} to ${to} (reliability ${rel.toFixed(2)} over ${r.n})`,
          kind: 'ladder', owner_role: 'operations',
          done_check: 'PR to autonomy/policy.json merged after review by a different agent',
          closing_probe: `trust_ledger rung = ${to}`, priority: demote ? 0 : 20,
          surface: r.surface, action_class: r.action_class,
        });
        if (made) ctx.notes.push(`ladder item opened: ${r.surface}/${r.action_class} -> ${to}`);
      }
    }
  },

  // SELFAUDIT-1: probe the failure-mode register; red files or reopens FM-<id>, green closes it with evidence.
  async selfaudit(db, ctx) {
    if (!ctx.config.failure_modes) { ctx.notes.push('selfaudit: no register configured'); return; }
    await loopBreak(db, ctx, ctx.config.failure_modes.max_redispatch || 3, ensureItem);
    await selfAuditStep(db, ctx, ctx.config.failure_modes, ensureItem);
  },

  // MIGRATE-SELF-1: apply pending D1 migrations through the tick's own binding (no credential), ledgered in _migrations.
  async migrate(db, ctx) { await migrateStep(db, ctx, ctx.config.migrations, ensureItem); },

  // UNKNOWNS-1: question what the system does not know; the questions are plus items.
  // GOALS-1: read every goal, sample it, move at most one knob per goal toward its target, review earlier moves, propose stretch goals, retire stale ones.
  async goals(db, ctx) {
    if (!ctx.config.goals) { ctx.notes.push('goals: none configured'); return; }
    const r = await goalsStep(db, ctx, ctx.config.goals, { builtins: METRICS, ensureItem });
    ctx.notes.push(`goals: ${r.read} read, ${r.met} met, ${r.off} off target${r.adjusted.length ? `, moved ${r.adjusted.map(a => `${a.knob} ${a.old}->${a.new}`).join(', ')}` : ''}${r.reviewed.length ? `, reviewed ${r.reviewed.length}` : ''}${r.stretch.length ? `, proposed ${r.stretch.join(', ')}` : ''}${r.retired.length ? `, retired ${r.retired.join(', ')}` : ''}`);
  },

  async unknowns(db, ctx) {
    if (!ctx.config.unknowns) { ctx.notes.push('unknowns: no doctrine configured'); return; }
    const r = await unknownsStep(db, ctx, ctx.config.unknowns, ensureItem);
    if (r.filed.length) ctx.notes.push(`unknowns: filed ${r.filed.join(', ')}`);
  },

  // Roles whose tick is due pull the top ready item for their role and get a dispatch row.
  async dispatch(db, ctx) {
    const roles = await all(db, `SELECT * FROM roles`);
    let n = 0;
    for (const role of roles) {
      if (ctx.wake !== role.role && ctx.tickId % Math.max(1, role.tick_every) !== 0) continue;  // an event wakes its role out of turn
      if (isOff(ctx.config.managers, role.role)) continue;  // MANAGERS-1: switched off by this system's register, with its reason
      const wip = await first(db, `SELECT COUNT(*) AS n FROM claims WHERE agent=? AND ${OWN_SQL()}`, role.id, tenantOf(ctx));
      if (wip.n >= ctx.config.max_wip_per_role) continue;
      const item = await pickForRole(db, role, ctx.config.criticality, (ctx.config.pace || {}).rank, tenantOf(ctx));  // CRITICALITY-LOOP-1: raising items first while k_eff is under k_min
      await run(db, `UPDATE roles SET last_tick_at=? WHERE id=?`, ctx.nowIso, role.id);
      if (!item) continue;
      await run(db, `INSERT INTO claims (item_id, agent, claimed_at, heartbeat_at) VALUES (?, ?, ?, ?)`, item.id, role.id, ctx.nowIso, ctx.nowIso);
      await run(db, `UPDATE items SET status='claimed', updated_at=? WHERE id=?`, ctx.nowIso, item.id);
      // MODEL-TRUTH-1: roles.model is a configured tier label, not what runs; the doer writes the real model (or 'rules (no model)') when it settles.
      await run(db, `INSERT INTO dispatches (tick_id, role_id, item_id, model) VALUES (?, ?, ?, 'pending')`, ctx.tickId, role.id, item.id);
      n++;
    }
    ctx.dispatched = n;
    ctx.notes.push(`dispatched ${n} item(s)`);
  },

  // DOER-1: every claimed item ends done, parked with a reason, or waiting with its claim kept; nothing is left for the reaper to release unworked.
  async execute(db, ctx) { await executeStep(db, ctx, ensureItem); },

  // Plus share over the last 20 closed items; below target opens a rebalance item for the portfolio manager.
  async check_plus_share(db, ctx) {
    const rows = await all(db, `SELECT kind FROM items WHERE status='done' AND ${OWN_SQL()} ORDER BY updated_at DESC LIMIT 20`, tenantOf(ctx));
    if (rows.length < 10) return;
    const share = rows.filter(r => r.kind === 'plus').length / rows.length;
    ctx.plusShare = share;
    if (share < ctx.config.plus_share / 2) {
      const made = await ensureItem(db, {
        id: `REBALANCE-${ctx.nowIso.slice(0, 10)}`,
        title: `Plus share ${(share * 100).toFixed(0)}% is under half the ${ctx.config.plus_share * 100}% target; rebalance and file the cause`,
        kind: 'fix', owner_role: 'portfolio-manager',
        done_check: 'plus share back over half the target over the next 20 closed items', priority: 5,
      });
      if (made) ctx.notes.push('rebalance item opened');
    }
  },

  // Q-PARITY-4 (SLA-120M): an item open past 120 minutes is raised to the top, and the cause is filed once a day; nothing ages silently.
  // One indexed COUNT-first read (status, created_at); the per-item work only runs when the count is above zero.
  async age_sla(db, ctx) {
    const cutoff = new Date(ctx.now - 120 * 60e3).toISOString().replace('T', ' ').slice(0, 19);
    const c = await first(db, `SELECT COUNT(*) AS n FROM items WHERE status IN ('open','ready') AND created_at < ?`, cutoff);
    ctx.over_120m = c ? c.n : 0;
    if (!ctx.over_120m) return;
    await run(db, `UPDATE items SET priority = MIN(priority, 5) WHERE status IN ('open','ready') AND created_at < ? AND priority > 5`, cutoff);
    const made = await ensureItem(db, {
      id: `AGE-120M-${ctx.nowIso.slice(0, 10)}`,
      title: `${ctx.over_120m} item(s) open past 120 minutes (items_open_over_120m target 0): raised to priority 5, find the cause`,
      kind: 'fix', owner_role: 'operations',
      done_check: 'items_open_over_120m back to 0', priority: 5,
    });
    ctx.notes.push(`over_120m: ${ctx.over_120m} item(s) raised${made ? ', cause item filed' : ''}`);
  },

  // Q-COST-PROOF-2 (cost-probe): once a day, only while the free tier is ok, turn each breached cost sample into a queue item. It adds one
  // indexed read per budget and nothing when the account is degraded (FREE_TIER_WIDE_STEPS), so it can never add reads to a read breach.
  async cost_probe(db, ctx) {
    if (ctx.freeTier && ctx.freeTier.level !== 'ok') return;
    if (new Date(ctx.now).getUTCHours() !== 0 || new Date(ctx.now).getUTCMinutes() >= 10) return;
    const r = await over_budget(db, (ctx.config && ctx.config.cost_budgets) || [], ctx.now);
    for (const b of [...r.breaches, ...r.advisory]) {
      await ensureItem(db, {
        id: `COST-BREACH-${b.target}-${ctx.nowIso.slice(0, 10)}`,
        title: `Cost probe: ${b.target} read ${b.rows_read_1h} rows/h over ${b.max_rows_read_per_hour}`.slice(0, 300),
        kind: 'fix', owner_role: 'operations', done_check: 'next cost sample under max_rows_read_per_hour', priority: 5,
      });
    }
    if (r.breaches.length || r.advisory.length) ctx.notes.push(`cost-probe: ${r.breaches.length + r.advisory.length} breach item(s)`);
  },

  // CRITICALITY-1: k_eff over the rolling window; a tick may not end idle or under k_min without originating the highest-value item at the head.
  async criticality(db, ctx) {
    if (!ctx.config.criticality) { ctx.notes.push('criticality: no thresholds configured'); return; }
    await criticalityStep(db, ctx, ctx.config.criticality, ensureItem);
  },

  // LOOPPROOF-1: every loop's expected slots against the slots it ran in; a loop that did not run files MISSED-<loop>.
  async pulse(db, ctx) { await pulseStep(db, ctx, ensureItem); },

  // BOOT-KNOWS-1: the stage from bootstrap to criticality, read from the system's own tables; the first unmet stage is IGNITE-<stage>.
  async ignition(db, ctx) { await ignitionStep(db, ctx, ensureItem); },
};

export const STEP_ORDER = ['migrate', 'reconcile', 'reap_claims', 'connector_health', 'probe_gates', 'score_predictions', 'measure', 'accrue_trust', 'selfaudit', 'unknowns', 'goals', 'dispatch', 'execute', 'check_plus_share', 'age_sla', 'cost_probe', 'pulse', 'criticality', 'ignition'];

// Q-LESSON-COST-SAMPLE-ACT: while the latest hourly cost sample of any budgeted D1 database is over its max_rows_read_per_hour, the tick runs
// only these steps. reconcile keeps every item's disposition honest (no silent drops), measure keeps the liveness metrics and the breach visible,
// criticality records the breach as a capped spend (only a cost cut may be originated), and the tick_runs row itself is the heartbeat. Every
// other step either reads wide (probe_gates, score_predictions, accrue_trust, selfaudit, pulse, ignition, check_plus_share) or starts new work
// that reads more (reap_claims feeds dispatch, dispatch, execute), so it waits for the hour to pass. A skipped step counts as completed: it is
// a decision, not a failure, so the health probe and the ignition streak stay green.
export const FREE_TIER_WIDE_STEPS = ['probe_gates', 'score_predictions', 'accrue_trust', 'selfaudit', 'pulse', 'ignition', 'check_plus_share', 'goals', 'age_sla', 'cost_probe'];  // FREE-TIER-1
export const COST_ESSENTIAL_STEPS = ['migrate', 'reconcile', 'measure', 'criticality'];
// SPEND-SOFT-1 (Rowan, 2026-11-21: "systems should never have hard stops"): no step is skipped for good. Under lean (a cost breach or the free
// tier at shed) or spend crawl the other steps still run on the first tick of every few hours; under degrade or spend throttle the wide readers
// run once an hour. Spend crawl keeps the queue moving every tick: reap_claims, dispatch and execute are the work itself, and their model calls
// are already limited by the AI governor.
export const SPEND_KEEP_STEPS = [...COST_ESSENTIAL_STEPS, 'reap_claims', 'dispatch', 'execute'];
export const LEAN_EVERY_H = 3;
// Pure: what a tick does with one step given the levels. 'run' or 'defer' (a deferred step counts as completed: a decision, not a failure).
export function stepPlan(name, { lean = false, degrade = false, spend = null, now = Date.now() } = {}) {
  const sl = spend && spend.level, k = (spend && spend.knobs) || {};
  if (lean && !COST_ESSENTIAL_STEPS.includes(name)) return dueEvery(LEAN_EVERY_H, now) ? 'run' : 'defer';
  if (sl === 'crawl' && !SPEND_KEEP_STEPS.includes(name)) return dueEvery(k.extra_every_h || LEAN_EVERY_H, now) ? 'run' : 'defer';
  if ((degrade || sl === 'throttle' || sl === 'crawl') && FREE_TIER_WIDE_STEPS.includes(name)) return dueEvery(Math.max(1, k.wide_every_h || 1), now) ? 'run' : 'defer';
  return 'run';
}

export const isSchemaError = (e) => /no such table|no such column|has no column named/i.test(String(e && e.message));

export async function runTick(db, { config, env = {}, now = Date.now(), wake = null, ai = null, budget = null } = {}) {
  const startedIso = iso(new Date(now));
  const ins = await run(db, `INSERT INTO tick_runs (started_at, steps_total) VALUES (?, ?)`, startedIso, STEP_ORDER.length);
  const tickId = ins.meta.last_row_id;
  const ctx = { db, wake, ai, budget, config, env, now, nowIso: startedIso, tickId, notes: [], errors: [], dispatched: 0, openGates: 0 };
  let completed = 0;
  try { ctx.costBreach = await over_budget(db, config && config.cost_budgets, now); } catch (e) { ctx.costBreach = null; ctx.notes.push(`cost check failed: ${String(e && e.message).slice(0, 120)}`); }
  try { ctx.freeTier = await freeTierLevel(db, now, planOf(config || {}, env || {})); } catch (e) { ctx.freeTier = null; ctx.notes.push(`free-tier check failed: ${String(e && e.message).slice(0, 120)}`); }
  try { ctx.spend = await readSpend(db, now); } catch (e) { ctx.spend = null; ctx.notes.push(`spend check failed: ${String(e && e.message).slice(0, 120)}`); }
  if (ctx.spend && ctx.spend.measured && ctx.spend.level !== 'full') ctx.notes.push(`spend ${ctx.spend.level}: about ${ctx.spend.usd_today} USD today, ${ctx.spend.projected_usd_day} projected of a ${ctx.spend.target_usd_day} USD soft target; ${ctx.spend.text}`);
  const lean = Boolean((ctx.costBreach && ctx.costBreach.over) || (ctx.freeTier && ctx.freeTier.level === 'shed'));
  const degrade = !lean && Boolean(ctx.freeTier && ctx.freeTier.level === 'degrade');  // degrade: only the wide readers wait; dispatch and execute keep the queue moving
  if (ctx.freeTier && ctx.freeTier.level !== 'ok') ctx.notes.push(`free tier ${ctx.freeTier.level}: ${Object.entries(ctx.freeTier.resources).filter(([, r]) => r.level === 'degrade' || r.level === 'shed').map(([k, r]) => `${k} ${Math.round(r.frac * 100)}% used, ${Math.round(r.projected_frac * 100)}% projected`).join(', ')}; skipped non-essential steps`);
  if (ctx.costBreach && ctx.costBreach.over) {
    const b = ctx.costBreach.breaches;
    ctx.notes.push(`cost breach: ${b.map(x => `${x.target} read ${x.rows_read_1h} rows/h > ${x.max_rows_read_per_hour}`).join(', ')}; skipped non-essential steps (${STEP_ORDER.filter(n => !COST_ESSENTIAL_STEPS.includes(n)).join(', ')})`);
    try { await run(db, `INSERT INTO org (key, value) VALUES ('cost_breach', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, JSON.stringify({ at: startedIso, until: iso(new Date(now + 3600e3)), breaches: b })); } catch (e) { ctx.errors.push(`cost_breach record: ${String(e && e.message).slice(0, 120)}`); }
  }
  for (const name of STEP_ORDER) {
    if (name === 'goals' && (lean || degrade) && ctx.config && ctx.config.goals) {  // GOALS-1: a skipped step must never leave the goal tree empty (it was never seeded under degrade), and control still runs once an hour
      try {
        const have = await first(db, `SELECT COUNT(*) AS n FROM goals`).then(r => r.n).catch(() => 0);
        if (!have) { const n = await seedGoals(db, ctx.config.goals, { now }); ctx.notes.push(`goals: seeded ${n} rows while the free tier is ${lean ? 'lean' : 'degraded'}`); }
      } catch (e) { ctx.errors.push(`goals seed: ${String(e && e.message).slice(0, 120)}`); }
      if (new Date(now).getUTCMinutes() < 10) { try { await STEPS[name](db, ctx); } catch (e) { ctx.errors.push(`goals: ${String(e && e.message).slice(0, 160)}`); } completed++; continue; }  // one tick in six, lean or degraded: the control step at a sixth of the reads, so a cost breach cannot freeze the knobs that answer it
    }
    if (stepPlan(name, { lean, degrade, spend: ctx.spend, now }) === 'defer') { completed++; continue; }
    try {
      try {
        await STEPS[name](db, ctx);
      } catch (e0) {
        // SCHEMA-HEAL-1 (Q-RECUR-9ead069526, Q-RECUR-b680afd12d): measure and criticality threw on a table their migration never created and
        // filed TICKFAIL every hour. A missing table or column is healed here: migrate runs again and the step is retried once in the same tick.
        if (name === 'migrate' || !isSchemaError(e0)) throw e0;
        await STEPS.migrate(db, ctx);
        await STEPS[name](db, ctx);
        ctx.notes.push(`${name}: healed missing schema by re-running migrate`);
      }
      completed++;
    } catch (e) {
      ctx.errors.push(`${name}: ${e.message}`);
      try {
        await ensureItem(db, {
          id: `TICKFAIL-${name}-${startedIso.slice(0, 13).replace(' ', 'T')}`,
          title: `Tick step ${name} failed: ${e.message}`.slice(0, 300),
          owner_role: 'operations', done_check: `next tick completes step ${name}`, priority: 0,
        });
      } catch { /* the database itself is down; the error is still in tick_runs */ }
    }
  }
  const open = await first(db, `SELECT COUNT(*) AS n FROM items WHERE status NOT IN ('done','superseded','cancelled') AND ${OWN_SQL()}`, tenantOf(ctx));
  const report = [
    `Happened: tick ${tickId} ran ${completed}/${STEP_ORDER.length} steps; ${ctx.notes.join('; ') || 'no changes'}.`,
    `Decided: dispatched ${ctx.dispatched} item(s) in driver order.`,
    `Next: tick ${tickId + 1} on the next cron.`,
    `Open: ${open.n} active item(s), ${ctx.openGates} gate card(s)${ctx.errors.length ? `, errors: ${ctx.errors.join(' | ')}` : ''}.`,
  ].join('\n');
  await run(db, `UPDATE tick_runs SET finished_at=?, steps_completed=?, report=?, errors=? WHERE id=?`,
    iso(new Date(now)), completed, report, ctx.errors.length ? JSON.stringify(ctx.errors) : null, tickId);
  return { tickId, completed, total: STEP_ORDER.length, report, errors: ctx.errors };
}

// HEALTH-INFLIGHT-1: runTick inserts its row before the steps run, so a probe that lands inside a tick would read steps_completed=NULL and
// answer 503 (CF-OBS 503 groups on ultrastable-ultrastable and demo-child-ultrastable, first seen at the cron second). Judge the newest
// FINISHED tick; a tick still unfinished after 5 minutes is a real fault and stays the newest row.
export const INFLIGHT_MS = 300e3;
export function lastTickForHealth(db, now = Date.now()) {
  return db.prepare(
    `SELECT id, started_at, finished_at, steps_completed, steps_total, report, errors FROM tick_runs WHERE finished_at IS NOT NULL OR started_at < ? ORDER BY id DESC LIMIT 1`
  ).bind(iso(new Date(now - INFLIGHT_MS))).first();
}

export { TERMINAL };
