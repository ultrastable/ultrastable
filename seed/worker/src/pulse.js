// PULSE-1: how the system knows, from its own records and with nobody telling it, that it has been bootstrapped, that every loop ran in
// every slot, and whether it is critical. Four parts, each taken from a fleet that has run unattended for months:
//   beat()         every loop run leaves a row BEFORE it starts and closes it when it ends (a cron fire log). A loop that was cut off
//                  is a row that never finished; a loop that never started is a missing row. One loop failing cannot starve the next.
//   slot ledger    the cron expression says how many ticks a window must hold; tick_runs says how many it held (expected
//                  against observed, never declared). tick_steps keeps one row per step per tick.
//   the ladder     seeded -> ticking -> instrumented -> loops -> acting -> closing -> verified (= bootstrapped) -> critical ->
//                  self_sustaining. Each stage is a query with its evidence. The first stage that fails is the blocker and files its own
//                  item; a change of stage is appended to ignition_log; a stage lost is filed as a regression.
//   the watcher    a clock cannot notice that it stopped. Other Workers call /internal/pulse on their own crons (two producers for
//                  one clock); a stale tick is run on the spot, and the tick in turn checks that its watchers still call.
// Thresholds are data: `pulse` in autonomy/criticality.json. The schema creates itself, so no deploy route has to apply a migration first.

async function all(db, sql, ...a) { return (await db.prepare(sql).bind(...a).all()).results || []; }
async function first(db, sql, ...a) { return (await db.prepare(sql).bind(...a).first()) || null; }
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const ms = s => Date.parse(String(s).replace(' ', 'T') + 'Z');
const marks = a => a.map(() => '?').join(',');
const TERMINAL = `('done','superseded','cancelled')`;

export const DEFAULTS = {
  interval_minutes: 10, window_hours: 24, min_slot_coverage: 0.95, bootstrap_ticks: 6, hold_ticks: 6,
  loop_lookback_slots: 3, unfinished_after_minutes: 5,
  loops: ['credentials', 'executor', 'gate', 'lane', 'handoffs', 'issuesync', 'repo-access', 'sweeper', 'deploy-evidence', 'cost-samples', 'analytics-selfcheck'],
  watchers: { dashboard: 30, site: 130 },
};
export const pulseConfig = config => ({ ...DEFAULTS, ...((config && config.criticality && config.criticality.pulse) || {}) });

// The same statements as migrations/0012_pulse.sql (test/pulse.test.js fails when they differ).
export const DDL = [
  `CREATE TABLE IF NOT EXISTS loop_beats (id INTEGER PRIMARY KEY AUTOINCREMENT, loop TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, ok INTEGER, ms INTEGER, evidence TEXT)`,
  `CREATE INDEX IF NOT EXISTS loop_beats_loop ON loop_beats (loop, started_at)`,
  `CREATE TABLE IF NOT EXISTS tick_steps (tick_id INTEGER NOT NULL, step TEXT NOT NULL, ok INTEGER NOT NULL, ms INTEGER NOT NULL, error TEXT, PRIMARY KEY (tick_id, step))`,
  `CREATE TABLE IF NOT EXISTS ignition_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, tick_id INTEGER, from_stage TEXT, to_stage TEXT NOT NULL, direction TEXT NOT NULL, evidence TEXT)`,
];
const ready = new WeakSet();
export async function ensureSchema(db) {
  if (ready.has(db)) return;
  for (const s of DDL) await db.prepare(s).run();
  ready.add(db);
}

const brief = out => { try { return (typeof out === 'string' ? out : JSON.stringify(out === undefined ? null : out)).slice(0, 400); } catch { return 'unserializable result'; } };
// A loop's own result says it did not do its job when it answers { status: 'error ...' } (it crashed), 'no-token' (it could not act) or
// { ok: false, error }. 'errors' is a run that finished with item-level errors in its evidence: the loop itself executed.
const failed = out => Boolean(out && typeof out === 'object' && ((typeof out.status === 'string' && /^(error( |$)|no-token$)/.test(out.status)) || (out.ok === false && out.error)));

// Runs one loop and leaves its beat. Never throws: a failure is the row (ok = 0 and the message), which selfKnow turns into an ignition gap.
export async function beat(db, loop, fn, now = Date.now) {
  const t0 = now(); let id = null;
  try { await ensureSchema(db); id = (await db.prepare(`INSERT INTO loop_beats (loop, started_at) VALUES (?, ?)`).bind(loop, iso(t0)).run()).meta.last_row_id; }
  catch (e) { console.error('pulse beat open', loop, e && e.message); }
  let ok = 1, out, evidence;
  try { out = await fn(); evidence = brief(out); if (failed(out)) ok = 0; }
  catch (e) { ok = 0; evidence = 'threw: ' + String((e && e.message) || e).slice(0, 380); console.error('loop', loop, evidence); }
  if (id !== null) {
    try { const t1 = now(); await db.prepare(`UPDATE loop_beats SET finished_at=?, ok=?, ms=?, evidence=? WHERE id=?`).bind(iso(t1), ok, t1 - t0, evidence, id).run(); }
    catch (e) { console.error('pulse beat close', loop, e && e.message); }
  }
  return out;
}

export async function recordSteps(db, tickId, steps) {
  if (!steps.length) return;
  await ensureSchema(db);
  await db.prepare(`INSERT OR REPLACE INTO tick_steps (tick_id, step, ok, ms, error) VALUES ${steps.map(() => '(?,?,?,?,?)').join(',')}`)
    .bind(...steps.flatMap(s => [tickId, s.step, s.ok ? 1 : 0, s.ms, s.error || null])).run();
}

// The liveness set every system carries (bootstrap.py LIVENESS). A runtime that was started without them seeds them itself.
export const LIVENESS = [
  ['M-tick-heartbeat', 'ticks completed in the last hour', 'tick_runs_completed_1h', '>=', 5, 1.5, 'operations', 'The clock is not turning. Check the Worker cron, the D1 binding and the last tick_runs.errors.'],
  ['M-acting', 'dispatches in the last 24 hours', 'dispatches_24h', '>=', 1, 6, 'operations', 'Ticks run but nothing is handed to a role. Check ready items, role rows and the executor.'],
  ['M-closing', 'items finished in the last 7 days', 'items_done_7d', '>=', 1, 48, 'portfolio-manager', 'Work starts but nothing closes. Find the stuck stage (review, merge, verify) and fix it.'],
  ['M-verified', 'independently verified outcomes in the last 7 days', 'verified_outcomes_7d', '>=', 1, 48, 'reviewer', 'Nothing was verified by a second path. Check that the reviewer role is dispatched and records outcomes.'],
  ['M-no-drops', 'silent drops in the last 7 days', 'silent_drops_7d', '<=', 0, 0, 'portfolio-manager', 'An item left the active set with no disposition. Find it and give it one.'],
  ['M-instrumented', 'objectives without a probe-backed target metric', 'objectives_without_probe', '<=', 0, 1, 'product-manager', 'Insert a target metric with a builtin, sql or http probe for the objective.'],
];
export async function ensureLiveness(db) {
  let n = 0;
  for (const [id, name, spec, op, threshold, grace, owner, remedy] of LIVENESS) {
    const r = await db.prepare(`INSERT OR IGNORE INTO metrics (id, tenant_id, objective_id, name, kind, source, spec, op, threshold, grace_hours, owner_role, remedy)
      VALUES (?, NULL, NULL, ?, 'liveness', 'builtin', ?, ?, ?, ?, ?, ?)`).bind(id, name, spec, op, threshold, grace, owner, remedy).run();
    n += (r.meta && r.meta.changes) || 0;
  }
  return n;
}

// Expected against observed. A slot is one cron interval; the slot being run now is not judged (its tick has not finished).
export async function clockLedger(db, p, now) {
  const I = p.interval_minutes * 60, cur = Math.floor(now / 1000 / I);
  const born = await first(db, `SELECT MIN(started_at) AS t FROM tick_runs`);
  const bornSlot = born && born.t ? Math.floor(ms(born.t) / 1000 / I) : cur;
  const from = Math.max(cur - Math.round(p.window_hours * 3600 / I), bornSlot);
  const expected = Math.max(cur - from, 0);
  const rows = await all(db, `SELECT CAST(CAST(strftime('%s', started_at) AS INTEGER) / ? AS INTEGER) AS slot, MAX(CASE WHEN finished_at IS NOT NULL AND steps_completed = steps_total THEN 1 ELSE 0 END) AS good,
      SUM(CASE WHEN finished_at IS NOT NULL AND steps_completed < steps_total THEN 1 ELSE 0 END) AS partial, SUM(CASE WHEN finished_at IS NULL THEN 1 ELSE 0 END) AS open
    FROM tick_runs WHERE started_at >= ? AND started_at < ? GROUP BY 1`, I, iso(from * I * 1000), iso(cur * I * 1000));
  const good = new Set(rows.filter(r => r.good).map(r => Number(r.slot)));
  let consecutive = 0;
  for (let s = cur - 1; s >= from && good.has(s); s--) consecutive++;
  const missed = [];
  for (let s = cur - 1; s >= from && missed.length < 12; s--) if (!good.has(s)) missed.push(iso(s * I * 1000));
  return {
    interval_minutes: p.interval_minutes, expected_slots: expected, complete_slots: good.size, missed_slots: expected - good.size,
    coverage: expected ? Number((good.size / expected).toFixed(4)) : null, consecutive_complete: consecutive,
    incomplete_ticks: rows.reduce((n, r) => n + Number(r.partial || 0), 0), unfinished_ticks: rows.reduce((n, r) => n + Number(r.open || 0), 0),
    last_missed: missed,
  };
}

// Each declared loop over the last few slots: ok, failed (its last beat says so), unfinished (started and never closed), silent (no beat),
// or warming (beats began less than the lookback ago, so absence proves nothing yet).
export async function loopLedger(db, p, now) {
  const span = p.loop_lookback_slots * p.interval_minutes * 60e3, since = iso(now - span);
  const begun = await first(db, `SELECT MIN(started_at) AS t FROM loop_beats WHERE loop NOT LIKE 'watch:%' AND loop <> 'tick-rescue'`);
  const warming = !begun || !begun.t || ms(begun.t) > now - span;
  const out = {};
  const judge = async (name, sinceIso) => {
    const b = await first(db, `SELECT started_at, finished_at, ok, ms, evidence FROM loop_beats WHERE loop = ? AND started_at >= ? ORDER BY id DESC LIMIT 1`, name, sinceIso);
    if (!b) return { state: 'silent' };
    if (b.ok === null) return ms(b.started_at) < now - p.unfinished_after_minutes * 60e3 ? { state: 'unfinished', last: b.started_at } : { state: 'ok', last: b.started_at, running: true };
    return { state: b.ok ? 'ok' : 'failed', last: b.started_at, ms: b.ms, ...(b.ok ? {} : { evidence: String(b.evidence || '').slice(0, 160) }) };
  };
  for (const name of p.loops) { const j = await judge(name, since); out[name] = warming && j.state === 'silent' ? { state: 'warming' } : j; }
  for (const [w, maxAgeMin] of Object.entries(p.watchers || {})) {
    const any = await first(db, `SELECT 1 AS x FROM loop_beats WHERE loop LIKE 'watch:%' LIMIT 1`);
    const j = await judge('watch:' + w, iso(now - maxAgeMin * 60e3));
    out['watch:' + w] = (warming || !any) && j.state === 'silent' ? { state: 'warming' } : j;
  }
  return out;
}

async function pulseGaps(db, links, nowIso) {
  for (const l of links)
    await db.prepare(`INSERT INTO ignition_gaps (link, owner, closing_probe, source, status, opened_at) VALUES (?,?,?,'pulse','open',?)
      ON CONFLICT(link) DO UPDATE SET status='open', closed_at=NULL, closing_probe=excluded.closing_probe`).bind(l.link, 'operations', l.closing_probe, nowIso).run();
  const keep = links.map(l => l.link);
  await db.prepare(`UPDATE ignition_gaps SET status='closed', closed_at=? WHERE source='pulse' AND status='open'${keep.length ? ` AND link NOT IN (${marks(keep)})` : ''}`).bind(nowIso, ...keep).run();
}

export const STAGES = ['seeded', 'ticking', 'instrumented', 'loops', 'acting', 'closing', 'verified', 'critical', 'self_sustaining'];
export const BOOTSTRAPPED_AT = 'verified';  // every stage up to and including this one holding is "bootstrapped"

// The ladder from the records alone. `crit` is the criticality snapshot of this tick (or the stored one).
export async function measureIgnition(db, config, now, crit) {
  const p = pulseConfig(config), nowIso = iso(now), day = iso(now - 86400e3), week = iso(now - 7 * 86400e3);
  const clock = await clockLedger(db, p, now), loops = await loopLedger(db, p, now);
  const n = async (sql, ...a) => Number(((await first(db, sql, ...a)) || {}).n || 0);
  const roles = await n(`SELECT COUNT(*) AS n FROM roles`), slug = await first(db, `SELECT value FROM org WHERE key='slug'`);
  const live = await first(db, `SELECT COUNT(*) AS n, SUM(CASE WHEN last_at >= ? THEN 1 ELSE 0 END) AS fresh, SUM(breached) AS breached FROM metrics WHERE kind='liveness' AND tenant_id IS NULL`,
    iso(now - 2 * p.interval_minutes * 60e3 - 1000));
  const bad = Object.entries(loops).filter(([, v]) => v.state !== 'ok'), warming = bad.filter(([, v]) => v.state === 'warming');
  const acted = await n(`SELECT COUNT(*) AS n FROM dispatches WHERE at >= ?`, day);
  const closed = await n(`SELECT COUNT(*) AS n FROM items WHERE status='done' AND updated_at >= ?`, week);
  const verified = await n(`SELECT COUNT(*) AS n FROM outcomes WHERE result='verified' AND evidence LIKE 'probe:%' AND at >= ?`, week);
  const gaps = await n(`SELECT COUNT(*) AS n FROM ignition_gaps WHERE status='open'`);
  const kEff = crit && Number.isFinite(crit.k_eff) ? crit.k_eff : null, kMin = crit && Number.isFinite(crit.k_min) ? crit.k_min : (config.criticality || {}).k_min ?? 1;
  const prevRow = await first(db, `SELECT value FROM org WHERE key='ignition'`);
  let prev = null; try { prev = prevRow ? JSON.parse(prevRow.value) : null; } catch { prev = null; }
  const critical = kEff !== null && kEff >= kMin;
  const streak = critical ? ((prev && prev.critical_streak) || 0) + 1 : 0;
  const checks = {
    seeded: [roles > 0 && Boolean(slug), `${roles} role(s), org ${slug ? slug.value : 'unnamed'}`],
    ticking: [clock.coverage !== null && clock.consecutive_complete >= Math.min(p.bootstrap_ticks, clock.expected_slots) && clock.consecutive_complete >= p.bootstrap_ticks && clock.coverage >= p.min_slot_coverage,
      `${clock.complete_slots}/${clock.expected_slots} slots complete (coverage ${clock.coverage}), ${clock.consecutive_complete} in a row; need ${p.bootstrap_ticks} in a row and coverage >= ${p.min_slot_coverage}`],
    instrumented: [Number(live.n) >= LIVENESS.length && Number(live.fresh) >= LIVENESS.length, `${live.n} liveness metric(s), ${live.fresh || 0} read in the last 2 slots, ${live.breached || 0} in breach`],
    loops: [bad.length === 0, bad.length ? bad.map(([k, v]) => `${k}: ${v.state}`).join(', ') : `${Object.keys(loops).length} loop(s) and watcher(s) ran and reported ok`],
    acting: [acted > 0, `${acted} dispatch(es) in 24 h`],
    closing: [closed > 0, `${closed} item(s) finished in 7 d`],
    verified: [verified > 0, `${verified} outcome(s) verified by a probe in 7 d`],
    critical: [critical, kEff === null ? 'k_eff not measured' : `k_eff ${kEff} against k_min ${kMin}`],
    self_sustaining: [critical && streak >= p.hold_ticks && gaps === 0, `critical for ${streak} tick(s) (need ${p.hold_ticks}), ${gaps} open ignition gap(s)`],
  };
  const stages = STAGES.map(id => ({ id, ok: Boolean(checks[id][0]), evidence: checks[id][1] }));
  const firstBad = stages.findIndex(s => !s.ok), index = firstBad === -1 ? STAGES.length : firstBad;
  const stage = index === 0 ? 'none' : STAGES[index - 1];
  const bootstrapped = index > STAGES.indexOf(BOOTSTRAPPED_AT);
  const blocker = firstBad === -1 ? null : { ...stages[firstBad] };
  if (blocker && blocker.id === 'critical' && crit && Number.isFinite(crit.spend_units)) {  // what it would take, in the terms k is made of
    const denom = Math.max(crit.spend_units + crit.human_touches, 1), have = (crit.credited_deploys || 0) + (crit.originated_credited || 0);
    blocker.to_close = { verified_deploys_missing: Math.max(Math.ceil(kMin * denom - have), 0), or_spend_plus_touches_at_most: Math.floor(have / kMin), spend_units: crit.spend_units, human_touches: crit.human_touches, credited: have };
  }
  return {
    at: nowIso, stage, stage_index: index, stages, blocker, bootstrapped,
    bootstrapped_at: bootstrapped ? ((prev && prev.bootstrapped && prev.bootstrapped_at) || nowIso) : null,
    critical, critical_since: critical ? ((prev && prev.critical && prev.critical_since) || nowIso) : null, critical_streak: streak,
    self_sustaining: index === STAGES.length, k_eff: kEff, k_min: kMin, open_ignition_gaps: gaps, clock, loops,
    warming: warming.map(([k]) => k), prev_stage: prev ? prev.stage : null, prev_index: prev ? prev.stage_index : null,
  };
}

// The tick step. Seeds what a bootstrap would have seeded, measures, writes the verdict, logs a change of stage, files the blocker.
export async function selfKnowStep(db, ctx, ensureItem) {
  await ensureSchema(db);
  const seeded = await ensureLiveness(db);
  const p = pulseConfig(ctx.config);
  const g = await measureIgnition(db, ctx.config, ctx.now, ctx.criticality || null);
  const links = [];
  for (const [k, v] of Object.entries(g.loops)) if (!['ok', 'warming'].includes(v.state))
    links.push({ link: `loop:${k}:${v.state}`, closing_probe: `loop_beats holds an ok beat for ${k} inside its window` });
  if (g.clock.coverage !== null && g.clock.coverage < p.min_slot_coverage)
    links.push({ link: 'clock:missed-slots', closing_probe: `tick slot coverage >= ${p.min_slot_coverage} over ${p.window_hours} h` });
  await pulseGaps(db, links, ctx.nowIso);
  g.open_ignition_gaps = Number((await first(db, `SELECT COUNT(*) AS n FROM ignition_gaps WHERE status='open'`)).n);
  g.tick_id = ctx.tickId;
  if (g.prev_stage !== g.stage) {
    const dir = g.prev_index === null ? 'first' : g.stage_index > g.prev_index ? 'up' : 'down';
    await db.prepare(`INSERT INTO ignition_log (at, tick_id, from_stage, to_stage, direction, evidence) VALUES (?,?,?,?,?,?)`)
      .bind(ctx.nowIso, ctx.tickId, g.prev_stage, g.stage, dir, g.blocker ? `${g.blocker.id}: ${g.blocker.evidence}` : 'every stage holds').run();
    if (dir === 'down') await ensureItem(db, {
      id: `IGNITION-REGRESS-${g.blocker.id}-${ctx.nowIso.slice(0, 13).replace(' ', 'T')}`, kind: 'fix', owner_role: 'operations', priority: 0,
      title: `Ignition fell from ${g.prev_stage} to ${g.stage}: stage ${g.blocker.id} stopped holding (${g.blocker.evidence}).`.slice(0, 400),
      done_check: `ignition stage ${g.blocker.id} holds again`, closing_probe: `ignition:${g.blocker.id}`,
    });
  }
  // The blocker files itself; a stage that holds closes its item. Below-critical work is already originated by the criticality step.
  for (const s of g.stages) {
    const id = `IGNITION-${s.id}`;
    if (g.blocker && g.blocker.id === s.id && !['critical', 'self_sustaining'].includes(s.id)) await ensureItem(db, {
      id, kind: 'fix', owner_role: 'operations', priority: 0, title: `Ignition is held at ${g.stage}: stage ${s.id} does not hold (${s.evidence}).`.slice(0, 400),
      done_check: `ignition stage ${s.id} holds`, closing_probe: `ignition:${s.id}`,
    });
    else if (s.ok) await db.prepare(`UPDATE items SET status='done', disposition=?, updated_at=? WHERE (id = ? OR id LIKE ?) AND status NOT IN ${TERMINAL}`)
      .bind(`fixed: ignition stage ${s.id} holds (${s.evidence})`.slice(0, 300), ctx.nowIso, id, `IGNITION-REGRESS-${s.id}-%`).run();
  }
  // keep a quarter of beats and steps: enough to judge every window, bounded so the ledger never becomes the cost
  if (ctx.tickId % 144 === 0) {
    await db.prepare(`DELETE FROM loop_beats WHERE started_at < ?`).bind(iso(ctx.now - 90 * 86400e3)).run();
    await db.prepare(`DELETE FROM tick_steps WHERE tick_id < ?`).bind(ctx.tickId - 144 * 90).run();
  }
  await db.prepare(`INSERT INTO org (key, value) VALUES ('ignition', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify(g)).run();
  ctx.ignition = g;
  ctx.notes.push(`ignition ${g.stage}${g.bootstrapped ? ' (bootstrapped)' : ''}; slots ${g.clock.complete_slots}/${g.clock.expected_slots}${g.blocker ? `; blocker ${g.blocker.id}` : ''}${seeded ? `; seeded ${seeded} liveness metric(s)` : ''}`);
  return g;
}

export async function readIgnition(db) {
  await ensureSchema(db);
  const r = await first(db, `SELECT value FROM org WHERE key='ignition'`);
  const log = await all(db, `SELECT at, tick_id, from_stage, to_stage, direction, evidence FROM ignition_log ORDER BY id DESC LIMIT 20`);
  return { ignition: r ? JSON.parse(r.value) : null, transitions: log };
}

// The outside path. A watcher (another Worker on its own cron) calls this. It leaves the watcher's beat, and when the newest tick is older
// than two intervals it runs one now: the clock is restarted by whoever notices first, with no credential and no person.
export async function watchPulse(db, config, who, runTickNow, now = Date.now()) {
  await ensureSchema(db);
  const p = pulseConfig(config), name = Object.keys(p.watchers || {}).includes(who) ? who : null;
  if (name) {
    const recent = await first(db, `SELECT 1 AS x FROM loop_beats WHERE loop = ? AND started_at >= ? LIMIT 1`, 'watch:' + name, iso(now - 60e3));
    if (!recent) await db.prepare(`INSERT INTO loop_beats (loop, started_at, finished_at, ok, ms, evidence) VALUES (?,?,?,1,0,'watcher called')`).bind('watch:' + name, iso(now), iso(now)).run();
  }
  const last = await first(db, `SELECT id, started_at FROM tick_runs ORDER BY id DESC LIMIT 1`);
  const age = last ? Math.round((now - ms(last.started_at)) / 1000) : null;
  const stale = age === null || age > 2 * p.interval_minutes * 60;
  let rescued = false, error = null;
  if (stale && runTickNow) {
    const r = await beat(db, 'tick-rescue', async () => { const t = await runTickNow(); return { tick: t.tickId, completed: t.completed, total: t.total, by: who, tick_age_s: age }; }, () => now);
    rescued = Boolean(r && r.completed === r.total); if (!rescued) error = 'rescue tick did not complete';
  }
  const ig = (await readIgnition(db)).ignition;
  return { ok: !stale || rescued, watcher: name, tick_age_s: age, stale, rescued, error, stage: ig ? ig.stage : null, bootstrapped: ig ? ig.bootstrapped : false, critical: ig ? ig.critical : false };
}
