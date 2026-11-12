// The heartbeat. One call = one tick. Pure logic over a D1-compatible database handle,
// so the same code runs in the Worker (D1) and in tests (node:sqlite shim).
//
// Lesson from AIOS ("PID 1 must never die"): every step is guarded. A failing step is
// recorded in the tick's errors and as a backlog item; the remaining steps still run.

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
  tick_runs_completed_1h: (db, now) => first(db,
    `SELECT COUNT(*) AS n FROM tick_runs WHERE finished_at >= ? AND steps_completed = steps_total`,
    iso(new Date(now - 3600e3))).then(r => r.n),
  items_done: (db) => first(db, `SELECT COUNT(*) AS n FROM items WHERE status='done'`).then(r => r.n),
  open_gate_cards: (db) => first(db, `SELECT COUNT(*) AS n FROM gate_cards WHERE status='open'`).then(r => r.n),
  dispatches_24h: (db, now) => first(db, `SELECT COUNT(*) AS n FROM dispatches WHERE at >= ?`, iso(new Date(now - 86400e3))).then(r => r.n),
  items_done_7d: (db, now) => first(db, `SELECT COUNT(*) AS n FROM items WHERE status='done' AND updated_at >= ?`, iso(new Date(now - 7 * 86400e3))).then(r => r.n),
  verified_outcomes_7d: (db, now) => first(db, `SELECT COUNT(*) AS n FROM outcomes WHERE result='verified' AND at >= ?`, iso(new Date(now - 7 * 86400e3))).then(r => r.n),
  // An objective with no probe-backed target metric is not instrumented; the agents do not yet know how to tell whether they are winning.
  objectives_without_probe: (db) => first(db,
    `SELECT COUNT(*) AS n FROM objectives o WHERE o.tenant_id IS NULL AND NOT EXISTS (SELECT 1 FROM metrics m WHERE m.tenant_id IS NULL AND m.objective_id = o.id AND m.kind = 'target' AND m.source IN ('builtin','sql','http'))`).then(r => r.n),
  metrics_in_breach: (db) => first(db, `SELECT COUNT(*) AS n FROM metrics WHERE breached = 1 AND tenant_id IS NULL`).then(r => r.n),
  silent_drops_7d: (db, now) => first(db,
    `SELECT COUNT(*) AS n FROM outcomes WHERE result='silent_drop' AND at >= ?`,
    iso(new Date(now - 7 * 86400e3))).then(r => r.n),
};

export function reliability(successes, outcomes, trust) {
  const w = trust.prior_weight, b = trust.baseline;
  return (successes + b * w) / (outcomes + w);
}

async function ensureItem(db, item) {
  const existing = await first(db, `SELECT id FROM items WHERE id = ?`, item.id);
  if (existing) return false;
  await run(db, `INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, surface, action_class)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
    item.id, item.title, item.kind || 'fix', item.owner_role, item.done_check,
    item.closing_probe || null, item.priority ?? 10, item.surface || null, item.action_class || null);
  return true;
}



// Reads a metric through its probe. sql must be one read-only SELECT; http is healthy (1) on a 2xx answer, else 0.
async function readMetric(db, m, ctx) {
  if (m.source === 'builtin') {
    const f = METRICS[m.spec];
    if (!f) throw new Error(`unknown builtin ${m.spec}`);
    return Number(await f(db, ctx.now));
  }
  if (m.source === 'sql') {
    if (!/^\s*select\b/i.test(m.spec) || m.spec.includes(';')) throw new Error('sql probe must be one SELECT');
    const row = await first(db, m.spec);
    return Number(Object.values(row || {})[0]);
  }
  if (m.source === 'http') {
    try { const res = await (ctx.env.fetch || fetch)(m.spec, { signal: AbortSignal.timeout(8000) }); return res.ok ? 1 : 0; } catch { return 0; }
  }
  return null; // declared: named but not probed
}

export const STEPS = {
  // Every item that left the active set has a disposition; items whose trigger is done become ready.
  async reconcile(db, ctx) {
    const drops = await all(db,
      `SELECT id FROM items WHERE status IN ('done','superseded','cancelled') AND (disposition IS NULL OR disposition = '')`);
    for (const d of drops) {
      await run(db, `UPDATE items SET status='open', updated_at=? WHERE id=?`, ctx.nowIso, d.id);
      await run(db, `INSERT INTO outcomes (item_id, surface, action_class, result, evidence) VALUES (?, 'work_tracker', 'create_update_close', 'silent_drop', 'reopened by reconcile: no disposition')`, d.id);
    }
    const r = await run(db, `UPDATE items SET status='ready', updated_at=?
      WHERE status='open' AND (trigger_on IS NULL OR trigger_on IN (SELECT id FROM items WHERE status='done'))`, ctx.nowIso);
    ctx.notes.push(`reconciled: ${drops.length} reopened, ${r.meta?.changes ?? 0} became ready`);
  },

  // Claims with no heartbeat for claim_ttl_minutes are released so work never stalls.
  async reap_claims(db, ctx) {
    const cutoff = iso(new Date(ctx.now - ctx.config.claim_ttl_minutes * 60e3));
    const stale = await all(db, `SELECT item_id, agent FROM claims WHERE heartbeat_at < ?`, cutoff);
    for (const c of stale) {
      await run(db, `DELETE FROM claims WHERE item_id=?`, c.item_id);
      await run(db, `UPDATE items SET status='ready', updated_at=? WHERE id=? AND status='claimed'`, ctx.nowIso, c.item_id);
    }
    if (stale.length) ctx.notes.push(`released ${stale.length} stale claim(s)`);
  },

  // Gate cards close themselves when their probe shows the owner's step is done.
  async probe_gates(db, ctx) {
    const cards = await all(db, `SELECT id, closing_probe FROM gate_cards WHERE status='open'`);
    let closed = 0;
    for (const c of cards) {
      const [kind, arg] = c.closing_probe.split(':');
      let ok = false;
      if (kind === 'env') ok = Boolean(ctx.env && ctx.env[arg]);
      if (kind === 'item_done') ok = Boolean(await first(db, `SELECT 1 AS x FROM items WHERE id=? AND status='done'`, arg));
      if (ok) {
        await run(db, `UPDATE gate_cards SET status='closed', closed_at=? WHERE id=?`, ctx.nowIso, c.id);
        closed++;
      }
    }
    ctx.openGates = cards.length - closed;
    if (closed) ctx.notes.push(`closed ${closed} gate card(s) by probe`);
  },

  // OBJECTIVES-1: read every metric through its probe. Outside its healthy condition it files its own remedy item (owner, done check,
  // closing probe) and closes that item when the probe passes again. A new system gets grace_hours before liveness can breach.
  async measure(db, ctx) {
    const first_tick = await first(db, `SELECT MIN(started_at) AS t FROM tick_runs`);
    const ageH = first_tick && first_tick.t ? (ctx.now - Date.parse(first_tick.t.replace(' ', 'T') + 'Z')) / 3600e3 : 0;
    // TENANT-1: a runtime measures only its own tenant's metrics. Rows of another tenant are never read, never breach, never file items here.
    const ms = await all(db, `SELECT * FROM metrics WHERE tenant_id IS NULL OR tenant_id = ?`, ctx.config.org_slug || '');
    let breached = 0, warming = 0;
    for (const m of ms) {
      let value = null, bad;
      try { value = await readMetric(db, m, ctx); } catch (e) { ctx.notes.push(`metric ${m.id}: ${e.message}`); }
      if (m.source === 'declared' || value === null || Number.isNaN(value)) bad = true; // an unprobed measure is a breach, not a pass
      else bad = !OPS[m.op](value, m.threshold);
      if (bad && ageH < m.grace_hours) { warming++; bad = false; }
      await run(db, `UPDATE metrics SET last_value=?, last_at=?, breached=? WHERE id=?`, value, ctx.nowIso, bad ? 1 : 0, m.id);
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
    ctx.notes.push(`measured ${ms.length} metric(s): ${breached} in breach${warming ? `, ${warming} warming up` : ''}`);
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
      const observed = await metric(db, ctx.now);
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
      const cur = await first(db, `SELECT rung FROM trust_ledger WHERE surface=? AND action_class=?`, r.surface, r.action_class);
      const rung = cur ? cur.rung : ctx.config.policy.surfaces[r.surface]?.start_rung || 'observed';
      await run(db, `INSERT INTO trust_ledger (surface, action_class, rung, reliability, outcomes, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(surface, action_class) DO UPDATE SET reliability=excluded.reliability, outcomes=excluded.outcomes, updated_at=excluded.updated_at`,
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

  // Roles whose tick is due pull the top ready item for their role and get a dispatch row.
  async dispatch(db, ctx) {
    const roles = await all(db, `SELECT * FROM roles`);
    let n = 0;
    for (const role of roles) {
      if (ctx.wake !== role.role && ctx.tickId % Math.max(1, role.tick_every) !== 0) continue;  // an event wakes its role out of turn
      const wip = await first(db, `SELECT COUNT(*) AS n FROM claims WHERE agent=?`, role.id);
      if (wip.n >= ctx.config.max_wip_per_role) continue;
      const item = await first(db, `SELECT id FROM items WHERE status='ready' AND owner_role=?
          AND (project IS NULL OR project = ? OR ? IS NULL)
          AND id NOT IN (SELECT item_id FROM claims) ORDER BY priority, created_at LIMIT 1`,
        role.role, role.project, role.project);
      await run(db, `UPDATE roles SET last_tick_at=? WHERE id=?`, ctx.nowIso, role.id);
      if (!item) continue;
      await run(db, `INSERT INTO claims (item_id, agent, claimed_at, heartbeat_at) VALUES (?, ?, ?, ?)`, item.id, role.id, ctx.nowIso, ctx.nowIso);
      await run(db, `UPDATE items SET status='claimed', updated_at=? WHERE id=?`, ctx.nowIso, item.id);
      await run(db, `INSERT INTO dispatches (tick_id, role_id, item_id, model) VALUES (?, ?, ?, ?)`, ctx.tickId, role.id, item.id, role.model);
      n++;
    }
    ctx.dispatched = n;
    ctx.notes.push(`dispatched ${n} item(s)`);
  },

  // Plus share over the last 20 closed items; below target opens a rebalance item for the portfolio manager.
  async check_plus_share(db, ctx) {
    const rows = await all(db, `SELECT kind FROM items WHERE status='done' ORDER BY updated_at DESC LIMIT 20`);
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
};

export const STEP_ORDER = ['reconcile', 'reap_claims', 'probe_gates', 'score_predictions', 'measure', 'accrue_trust', 'dispatch', 'check_plus_share'];

export async function runTick(db, { config, env = {}, now = Date.now(), wake = null } = {}) {
  const startedIso = iso(new Date(now));
  const ins = await run(db, `INSERT INTO tick_runs (started_at, steps_total) VALUES (?, ?)`, startedIso, STEP_ORDER.length);
  const tickId = ins.meta.last_row_id;
  const ctx = { wake, config, env, now, nowIso: startedIso, tickId, notes: [], errors: [], dispatched: 0, openGates: 0 };
  let completed = 0;
  for (const name of STEP_ORDER) {
    try {
      await STEPS[name](db, ctx);
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
  const open = await first(db, `SELECT COUNT(*) AS n FROM items WHERE status NOT IN ('done','superseded','cancelled')`);
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

export { TERMINAL };
