// CRITICALITY-1: the tick-end controller. k_eff = (credited verified deploys + credited loop-originated items) / (spend_units + human_touches)
// over a rolling window. Thresholds come from autonomy/criticality.json, never from this file. A tick may not finish idle: if the queue is empty,
// k_eff is under k_min, or nothing was dispatched, the step originates the highest-value item at the head of the queue.

import { controlStep } from './critloop.js';
import { tenantOf } from './tenant.js';  // Q-TENANT-row-isolation

async function all(db, sql, ...args) { return (await db.prepare(sql).bind(...args).all()).results || []; }
async function first(db, sql, ...args) { return (await db.prepare(sql).bind(...args).first()) || null; }
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const marks = a => a.map(() => '?').join(',');

// Pure: windowed figures -> k_eff with guards applied. cur/prev are { deploys, fail, spend, human, originated, self }.
// SELF-REFERENCE-1: k_self counts only the verified deploys the system originated and executed on itself (cur.self: deploy rows whose origin is
// in thresholds.self.origins). A deploy an outside session drove raises k_eff, never k_self. self_regime: subcritical (k_eff under k_min),
// self-sustaining (k_self at or over k_min), driven (critical only on an outside source).
export function computeKEff(cur, prev, t) {
  const total = cur.deploys + cur.fail;
  const failRate = total ? cur.fail / total : 0;
  const prevTotal = prev ? prev.deploys + prev.fail : 0;
  const prevFail = prevTotal ? prev.fail / prevTotal : 0;
  const spendWorse = Boolean(prev && prev.spend > 0 && cur.spend > prev.spend * (1 + t.guards.spend_worse_tolerance));
  const failWorse = Boolean(prev && prevTotal > 0 && failRate > prevFail + t.guards.fail_rate_worse_tolerance);
  const rose = Boolean(prev && cur.deploys > prev.deploys);
  const guardTripped = rose && (spendWorse || failWorse);
  const credited = guardTripped ? prev.deploys : cur.deploys;
  const originated = Math.min(cur.originated, t.originated.credit_cap);
  const denom = Math.max(cur.spend + cur.human, t.denominator_floor);
  const kEff = Number(((credited + originated) / denom).toFixed(4));
  const selfDeploys = Math.min(cur.self || 0, credited);  // never more than the deploys that were credited at all
  const kSelf = Number((selfDeploys / denom).toFixed(4));
  return {
    k_eff: kEff, k_self: kSelf, self_deploys: selfDeploys,
    self_regime: kEff < t.k_min ? 'subcritical' : kSelf >= t.k_min ? 'self-sustaining' : 'driven',
    credited_deploys: credited, raw_deploys: cur.deploys, originated_credited: originated,
    spend_units: cur.spend, human_touches: cur.human, fail_rate: Number(failRate.toFixed(4)),
    guard: { tripped: guardTripped, spend_worse: spendWorse, fail_worse: failWorse },
  };
}

async function windowFigures(db, t, from, to) {
  const s = await first(db, `SELECT COALESCE(SUM(deploys_ok),0) AS ok, COALESCE(SUM(deploys_fail),0) AS fail, COALESCE(SUM(spend_units),0) AS spend,
      COALESCE(SUM(human_touches),0) AS human, COALESCE(MAX(cap_breached),0) AS cap, COUNT(*) AS n FROM criticality_samples WHERE at >= ? AND at < ?`, iso(from), iso(to));
  const cls = t.deploy.action_classes, sur = t.deploy.surfaces;
  const scope = `action_class IN (${marks(cls)}) AND surface IN (${marks(sur)})`;
  const v = await first(db, `SELECT COUNT(*) AS n FROM outcomes WHERE result='verified' AND at >= ? AND at < ? AND ${scope} AND evidence LIKE ?`,
    iso(from), iso(to), ...cls, ...sur, t.deploy.verifier_evidence_prefix + '%');
  const f = await first(db, `SELECT COUNT(*) AS n FROM outcomes WHERE result IN ('failed','hidden_failure') AND at >= ? AND at < ? AND ${scope}`,
    iso(from), iso(to), ...cls, ...sur);
  const origins = (t.self && t.self.origins) || [];
  const sv = origins.length ? await first(db, `SELECT COUNT(*) AS n FROM outcomes WHERE result='verified' AND at >= ? AND at < ? AND ${scope} AND (${origins.map(() => 'evidence LIKE ?').join(' OR ')})`,
    iso(from), iso(to), ...cls, ...sur, ...origins.map(o => `${t.deploy.verifier_evidence_prefix}% origin=${o}`)) : { n: 0 };
  const pre = t.originated.id_prefixes.map(() => 'id LIKE ?').join(' OR ');
  const o = await first(db, `SELECT COUNT(*) AS n FROM items WHERE created_at >= ? AND created_at < ? AND (${pre})`,
    iso(from), iso(to), ...t.originated.id_prefixes.map(p => p + '%'));
  const d = await first(db, `SELECT COUNT(*) AS n FROM dispatches WHERE at >= ? AND at < ?`, iso(from), iso(to));
  const g = await first(db, `SELECT COUNT(*) AS n FROM gate_cards WHERE closed_at IS NULL OR closed_at >= ?`, iso(from)); // an open or recently closed card is owner attention
  return {
    n: s.n, cap: Boolean(s.cap), deploys: s.ok + v.n, self: sv.n, fail: s.fail + f.n, originated: o.n,
    spend: s.spend + d.n * t.dispatch_spend_units, human: s.human + g.n,
  };
}

export async function measureCriticality(db, t, now) {
  const span = t.window_days * 86400e3;
  const cur = await windowFigures(db, t, now - span, now + 1000);
  const prev = await windowFigures(db, t, now - 2 * span, now - span);
  const hasPrev = prev.n > 0 || prev.deploys + prev.fail > 0;
  const r = computeKEff(cur, hasPrev ? prev : null, t);
  return { ...r, cap_breached: cur.cap, window_days: t.window_days, k_min: t.k_min, at: iso(now) };
}

// Candidate predicates, in thresholds.origination.order. Each is true when its problem is present.
const CANDIDATES = {
  cost_cut: async (m, t) => m.cap_breached || m.spend_units > t.origination.spend_budget_units,
  flaky_deploy: async (m, t) => m.fail_rate > t.origination.max_fail_rate,
  unowned_backlog: async (m, t, db) => Boolean(await first(db,
    `SELECT 1 AS x FROM items WHERE status IN ('open','ready') AND owner_role NOT IN (SELECT role FROM roles) AND id NOT LIKE 'ORIGIN-%' LIMIT 1`)),
  generic: async () => true,
};

export async function originate(db, t, m, ctx, ensureItem) {
  const day = ctx.nowIso.slice(0, 10);
  // While a spend cap is breached only the cost cut may be originated: no new work that spends.
  const order = m.cap_breached ? ['cost_cut'] : t.origination.order;
  for (const kind of order) {
    if (!(await CANDIDATES[kind](m, t, db))) continue;
    const pre = `ORIGIN-${kind}-${day}`;
    const open = await first(db, `SELECT id FROM items WHERE id LIKE ? AND status NOT IN ('done','superseded','cancelled') LIMIT 1`, pre + '%');
    if (open) return { kind, id: open.id, created: false }; // today's item for this problem is still at the head
    const id = `${pre}-t${ctx.tickId}`; // a closed one is replaced by a fresh one: the queue may never stay empty
    await ensureItem(db, {
      id, kind: 'fix', owner_role: t.origination.owner_roles[kind], priority: t.origination.head_priority,
      title: `${t.origination.titles[kind]} (k_eff ${m.k_eff} vs min ${t.k_min})`.slice(0, 400),
      done_check: `k_eff >= ${t.k_min} or the named consumer measurably smaller`, closing_probe: `criticality:${kind}`,
    });
    return { kind, id, created: true };
  }
  return null;
}

// Q-CRIT-IGNITION: the links this runtime can see that do not close on themselves. Each derived link is upserted open; a derived link no longer
// present is closed with its time (never deleted). Rows pushed by collectors (source 'external') are left to their collector.
export async function deriveIgnitionGaps(db, nowIso, pulse = null, tenant = '') {
  const links = [];
  for (const l of (pulse && pulse.not_ticking) || [])  // LOOPPROOF-1: a loop that is not executing is a link that does not close
    links.push({ link: `loop:${l.loop}:not-ticking`, owner: 'operations', closing_probe: `pulse:${l.loop} reads ticking` });
  for (const c of await all(db, `SELECT id, what FROM gate_cards WHERE status='open' AND (tenant_id IS NULL OR tenant_id = ?)`, tenantOf(tenant)))
    links.push({ link: `gate:${c.id}`, owner: 'operations', closing_probe: `gate card ${c.id} closes by its own probe or a staged default` });
  for (const m of await all(db, `SELECT id FROM metrics WHERE tenant_id IS NULL AND source='declared'`))
    links.push({ link: `metric:${m.id}:unprobed`, owner: 'operations', closing_probe: `metric ${m.id} reads through a builtin, sql or http probe` });
  const un = await first(db, `SELECT COUNT(*) AS n FROM items WHERE status IN ('open','ready') AND owner_role NOT IN (SELECT role FROM roles) AND (tenant_id IS NULL OR tenant_id = ?)`, tenantOf(tenant));
  if (un && un.n) links.push({ link: 'items:unowned', owner: 'portfolio-manager', closing_probe: 'every open item names an existing role' });
  for (const l of links)
    await db.prepare(`INSERT INTO ignition_gaps (link, owner, closing_probe, source, status, opened_at) VALUES (?,?,?,'tick','open',?)
      ON CONFLICT(link) DO UPDATE SET status='open', closed_at=NULL, owner=excluded.owner, closing_probe=excluded.closing_probe`).bind(l.link, l.owner, l.closing_probe, nowIso).run();
  const keep = links.map(l => l.link);
  await db.prepare(`UPDATE ignition_gaps SET status='closed', closed_at=? WHERE source='tick' AND status='open'${keep.length ? ` AND link NOT IN (${marks(keep)})` : ''}`).bind(nowIso, ...keep).run();
  const open = await all(db, `SELECT link, owner, closing_probe, source FROM ignition_gaps WHERE status='open' ORDER BY link`);
  return { open_ignition_gaps: open.length, ignition_gaps: open.slice(0, 20) };
}

export async function addIgnitionGaps(db, gaps, nowIso) {
  if (!Array.isArray(gaps)) return 0;
  const seen = [];
  for (const g of gaps.slice(0, 200)) {
    if (!g || !g.link) continue;
    const link = String(g.link).slice(0, 300); seen.push(link);
    await db.prepare(`INSERT INTO ignition_gaps (link, owner, closing_probe, source, status, opened_at) VALUES (?,?,?,'external','open',?)
      ON CONFLICT(link) DO UPDATE SET status='open', closed_at=NULL`).bind(link, String(g.owner || 'operations').slice(0, 60), String(g.closing_probe || '').slice(0, 300), nowIso).run();
  }
  // a collector's sample is its full list: an external link it no longer reports has closed
  await db.prepare(`UPDATE ignition_gaps SET status='closed', closed_at=? WHERE source='external' AND status='open'${seen.length ? ` AND link NOT IN (${marks(seen)})` : ''}`).bind(nowIso, ...seen).run();
  return seen.length;
}

// The tick step. Never lets a tick end idle: an idle tick files its own repair.
export async function criticalityStep(db, ctx, t, ensureItem) {
  const m = await measureCriticality(db, t, ctx.now);
  // SPEND-GOVERNOR-1: a frozen AI budget is a breached spend cap: only a cost cut may be originated, and no idle item is filed (lesson from an earlier fleet: loops that
  // filed work about their own metrics grew agent_issues to ~7,500 rows and spent AI fixing them).
  // Q-LESSON-COST-SAMPLE-ACT: a D1 rows-read budget over its hourly cap (ctx.costBreach, set by runTick from costsample.js over_budget) is the same breached cap.
  const frozen = Boolean(ctx.budget && ctx.budget.mode === 'frozen') || Boolean(ctx.costBreach && ctx.costBreach.over);
  if (frozen) m.cap_breached = 1;
  const T = tenantOf(ctx);  // Q-TENANT-row-isolation: the queue and claims this runtime counts are its own
  const queued = await first(db, `SELECT COUNT(*) AS n FROM items WHERE status IN ('open','ready') AND (tenant_id IS NULL OR tenant_id = ?)`, T);
  const claimed = await first(db, `SELECT COUNT(*) AS n FROM claims WHERE tenant_id IS NULL OR tenant_id = ?`, T);
  const idle = ctx.dispatched === 0 && claimed.n === 0;
  const reasons = [];
  if (queued.n === 0) reasons.push('queue_empty');
  if (m.k_eff < t.k_min) reasons.push('k_eff_below_min');
  if (idle) reasons.push('idle_tick');
  let origin = null;
  if (reasons.length) {
    origin = await originate(db, t, m, ctx, ensureItem);
    if (idle && !frozen) {
      await ensureItem(db, {
        id: `IDLE-${ctx.nowIso.slice(0, 13).replace(' ', 'T')}`, kind: 'fix', owner_role: 'operations', priority: t.origination.head_priority,
        title: `Idle tick ${ctx.tickId}: nothing dispatched and nothing claimed. File why the queue could not feed a doer and fix it.`,
        done_check: 'next tick dispatches or claims an item', closing_probe: 'criticality:idle',
      });
      ctx.errors.push(`idle_tick: tick ${ctx.tickId} dispatched nothing; repair filed`);
    }
  }
  const emitted = m.k_eff <= t.k_max ? await emitSuccessors(db, t, ctx, ensureItem) : 0; // control rod: above k_max nothing is emitted
  const ign = await deriveIgnitionGaps(db, ctx.nowIso, ctx.pulse || null, T);
  const snap = { ...m, emitted_successors: emitted, queue_open: queued.n, idle, reasons, originated_now: origin, ...ign,
    self_sustaining: m.k_eff >= t.k_min && ign.open_ignition_gaps === 0 };
  snap.control = await controlStep(db, ctx, t, snap, ensureItem); // CRITICALITY-LOOP-1: act on the measurement, grade the last action, beat
  ctx.criticality = snap;
  await db.prepare(`INSERT INTO org (key, value) VALUES ('criticality', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify(snap)).run();
  ctx.notes.push(`k_eff ${m.k_eff}${m.guard.tripped ? ' (guard: deploy rise not credited)' : ''}; open_ignition_gaps ${ign.open_ignition_gaps}${origin ? `; originated ${origin.id}` : ''}${snap.control.action ? `; lever ${snap.control.action.from} -> ${snap.control.action.to} (${snap.control.action.reason})` : ''}${snap.control.stalled ? '; stalled' : ''}`);
  return snap;
}

// Neutron emission: each closed item with no successor spawns one, so the reaction feeds itself from its own products.
export async function emitSuccessors(db, t, ctx, ensureItem) {
  const sc = t.successor;
  const done = await all(db, `SELECT id, owner_role, priority FROM items WHERE status='done' AND id NOT LIKE ? AND id NOT LIKE 'IDLE-%' AND (tenant_id IS NULL OR tenant_id = ?)
      AND ('NEXT-' || id) NOT IN (SELECT id FROM items) ORDER BY updated_at DESC LIMIT ?`, sc.id_prefix + '%', tenantOf(ctx), sc.batch);
  let n = 0;
  for (const d of done) {
    if (await ensureItem(db, { id: sc.id_prefix + d.id, kind: 'plus', owner_role: d.owner_role, priority: d.priority,
      title: sc.title.replace('{id}', d.id).slice(0, 400), done_check: 'a new item with owner, done check and closing probe is filed', closing_probe: `successor:${d.id}` })) n++;
  }
  return n;
}

export async function readCriticality(db) {
  const r = await first(db, `SELECT value FROM org WHERE key='criticality'`);
  return r ? JSON.parse(r.value) : null;
}

export async function addSample(db, s, nowIsoStr) {
  const n = k => Number.isFinite(Number(s[k])) ? Number(s[k]) : 0;
  if (Array.isArray(s.ignition_gaps)) await addIgnitionGaps(db, s.ignition_gaps, s.at || nowIsoStr);
  await db.prepare(`INSERT INTO criticality_samples (at, source, deploys_ok, deploys_fail, spend_units, human_touches, cap_breached) VALUES (?,?,?,?,?,?,?)`)
    .bind(s.at || nowIsoStr, String(s.source || 'external').slice(0, 40), n('deploys_ok'), n('deploys_fail'), n('spend_units'), n('human_touches'), s.cap_breached ? 1 : 0).run();
}
