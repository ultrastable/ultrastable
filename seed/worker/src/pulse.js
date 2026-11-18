// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// LOOPPROOF-1: how the system verifies that its own loops ran, every time, with no outside observer.
//   beat      every server-side loop runs inside beat(): a row is written BEFORE the body runs and completed after it. A loop that threw is
//             a row with ok 0 and its error; a loop that never returned is a row with ok NULL; a loop that was never called is a missing
//             slot. One loop failing never stops the loops after it.
//   clock     the tick step `pulse` counts, per loop, the slots it should have run in over 24 h against the slots it did run in, writes
//             the judged state to loop_clock (ticking, late, stopped, failing, hung, never) and files MISSED-<loop>, which only the same
//             probe can close. The tick's own missed slots are counted the same way from tick_runs.
//   watchdog  a clock cannot notice that it has stopped. watch() is called by a second producer on its own cron (the site Worker, through
//             the TICK service binding): when the newest tick is older than two intervals it runs the tick itself, and it leaves a beat
//             every call, so the tick in turn judges the watchdog. Each producer watches the other's silence.
// Carried over from the fleet that already runs this way: the heartbeat is a database row with more than one producer, every loop has a
// clock row with missed and good counts, and an unmeasured loop is never read as a healthy one.
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const ms = s => Date.parse(String(s).replace(' ', 'T') + 'Z');

// SCHEMA-SELF-1: the Worker carries the DDL of the tables this module needs and applies it itself (idempotent), so code deployed ahead of
// its migration cannot fail on a missing table. Kept equal to migrations/0013_pulse.sql by test/pulse.test.js.
export const PULSE_DDL = [
  `CREATE TABLE IF NOT EXISTS loop_beats (id INTEGER PRIMARY KEY AUTOINCREMENT, loop TEXT NOT NULL, slot INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'cron', started_at TEXT NOT NULL, finished_at TEXT, ok INTEGER, error TEXT, detail TEXT)`,
  `CREATE INDEX IF NOT EXISTS loop_beats_loop ON loop_beats (loop, slot)`,
  `CREATE TABLE IF NOT EXISTS loop_clock (loop TEXT PRIMARY KEY, every_min INTEGER NOT NULL, declared INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, why TEXT, last_run TEXT, last_good TEXT, expected_24h INTEGER NOT NULL DEFAULT 0, ran_24h INTEGER NOT NULL DEFAULT 0, good_24h INTEGER NOT NULL DEFAULT 0, missed_24h INTEGER NOT NULL DEFAULT 0, coverage REAL, bad_streak INTEGER NOT NULL DEFAULT 0, checked_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ignition_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, stage TEXT NOT NULL, prev TEXT, direction TEXT NOT NULL, evidence TEXT NOT NULL)`,
];
const ready = new WeakSet();
export async function ensurePulseSchema(db) {
  if (ready.has(db)) return;
  for (const sql of PULSE_DDL) await db.prepare(sql).run();
  ready.add(db);
}

// The loops the scheduled handler runs each tick. index.js runs exactly this list through beat(), so what is declared is what is wired.
export const LANE_LOOPS = ['credentials', 'executor', 'gate', 'lane', 'handoffs', 'issuesync', 'repo-access', 'sweeper', 'deploy-evidence', 'watchdog-gh', 'hosts', 'host-hooks', 'cost-samples', 'analytics-selfcheck'];
// Loops whose cadence is not the tick's. The watchdog is called by the site Worker (cron 17 * * * *, hourly) and by the dashboard Worker
// (*/10); the cadence the system guarantees is the slower producer's, so an hourly beat is never judged against the 10-minute tick.
// SUBREQUEST-ROTATION-1 (2026-11-17): the Workers Free plan allows 50 subrequests per invocation, and the heavy GitHub loops together made more than that
// ("Too many subrequests by single Worker invocation" failed gate, lane, handoffs, issuesync, repo-access, sweeper and deploy-evidence in every slot).
// They now rotate over four ticks (index.js LOOP_PHASE), so each runs every 40 minutes, inside the 120 minute SLA, and each tick stays under the limit.
export const HEAVY_CADENCE_MIN = 40;
export const HEAVY_LOOPS = ['executor', 'gate', 'lane', 'handoffs', 'issuesync', 'repo-access', 'sweeper', 'deploy-evidence', 'watchdog-gh', 'hosts', 'host-hooks'];
export const DEFAULT_CADENCE = { watchdog: 60, ...Object.fromEntries(HEAVY_LOOPS.map(l => [l, HEAVY_CADENCE_MIN])) };
export const HUNG_MS = 300e3;
const BAD = ['late', 'stopped', 'failing', 'hung', 'never'];

// IDLE-IS-NOT-OK-1: a loop that returned without throwing has not thereby done its work. Its own result says so: { status: 'error ...' },
// { status: 'no-token' } (it had no credential, so it did nothing), { status: 'errors' } with nothing else done, { ok: false } and { error } are
// failures (a run with some errors and some work done stays good: its errors are in the detail); a list of routes or samples (the
// executor's dispatchers, the cost samples) fails only when every entry failed. Returns the reason, or null when the result is good. Without
// this a loop with no credential beats ok in every slot and the ladder reads `looping` over loops that do nothing.
export function failed(out) {
  const empty = x => Object.entries(x).every(([k, v]) => k === 'errors' || !Array.isArray(v) || v.length === 0);  // errors, and nothing else done
  const idle = x => typeof x.status === 'string' && (/^(error\b|no-token)/.test(x.status) || (x.status === 'errors' && empty(x)));
  const one = x => Boolean(x) && typeof x === 'object' && !Array.isArray(x) && (x.ok === false || Boolean(x.error) || idle(x));
  const bad = Array.isArray(out) ? (out.length && out.every(one) ? out[0] : null) : one(out) ? out : null;
  if (!bad) return null;
  if (idle(bad)) return String(bad.status === 'errors' ? 'errors: ' + [].concat(bad.errors || [])[0] : bad.status).slice(0, 300);
  return String(bad.error || bad.detail || 'ok=false').slice(0, 300);
}

// Runs one loop and leaves the proof. Never throws: the caller's next loop always runs.
export async function beat(db, loop, fn, { now = Date.now, source = 'cron', everyMin = 10 } = {}) {
  let id = null;
  const t0 = now();
  try {
    await ensurePulseSchema(db);
    const r = await run(db, `INSERT INTO loop_beats (loop, slot, source, started_at) VALUES (?,?,?,?)`, loop, Math.floor(t0 / (everyMin * 60e3)), source, iso(t0));
    id = r.meta && r.meta.last_row_id;
  } catch (e) { console.error('pulse', loop, 'beat not recorded:', e && e.message); }  // the ledger is down: the loop still runs, and its missing slot is the record
  let out, ok = 1, error = null;
  try {
    out = await fn();
    const why = failed(out);
    if (why) { ok = 0; error = why; }
  } catch (e) { ok = 0; error = String((e && e.message) || e); out = { status: 'error ' + error }; console.error('pulse', loop, error); }
  if (id != null) {
    let detail = null;
    try { detail = JSON.stringify(out === undefined ? null : out).slice(0, 300); } catch { detail = null; }
    try { await run(db, `UPDATE loop_beats SET finished_at=?, ok=?, error=?, detail=? WHERE id=?`, iso(now()), ok, error ? error.slice(0, 300) : null, detail, id); }
    catch (e) { console.error('pulse', loop, 'beat not closed:', e && e.message); }
  }
  return out;
}

// The tick's own cadence, read from its own history (median gap of recent ticks) unless the config states it. A system that knows its interval.
export async function tickCadenceMin(db, config = {}) {
  if (Number(config.tick_every_min) > 0) return Number(config.tick_every_min);
  const rows = await all(db, `SELECT started_at FROM tick_runs ORDER BY id DESC LIMIT 40`);
  const gaps = [];
  for (let i = 0; i + 1 < rows.length; i++) { const g = Math.round((ms(rows[i].started_at) - ms(rows[i + 1].started_at)) / 60e3); if (g >= 1) gaps.push(g); }
  if (gaps.length < 3) return 10;
  gaps.sort((a, b) => a - b);
  return Math.min(1440, Math.max(1, gaps[Math.floor(gaps.length / 2)]));
}

// Pure: judge one loop from its runs. runs = [{ at (ms), ok (1|0|null) }] within the window, any order. firstAt = first run ever seen (ms) or null.
export function judgeLoop({ everyMin, runs, firstAt, now, sinceMs, windowMs = 86400e3 }) {
  const w = everyMin * 60e3, cur = Math.floor(now / w);
  const from = Math.max(Math.floor((now - windowMs) / w), firstAt != null ? Math.floor(firstAt / w) : cur);
  const expected = Math.max(0, cur - from);  // completed slots since the loop first ran, inside the window; the slot in progress is not judged
  const ranSlots = new Set(), goodSlots = new Set();
  let last = null, lastGood = null;
  for (const r of runs) {
    const s = Math.floor(r.at / w);
    if (!last || r.at > last.at) last = r;
    if (r.ok === 1 && (lastGood == null || r.at > lastGood)) lastGood = r.at;
    if (s < from || s >= cur) continue;
    ranSlots.add(s); if (r.ok === 1) goodSlots.add(s);
  }
  const ran = ranSlots.size, good = goodSlots.size, missed = Math.max(0, expected - ran);
  const coverage = expected ? Number((good / expected).toFixed(4)) : null;
  let state = 'ticking', why;
  if (!last) {
    const waited = sinceMs != null ? now - sinceMs : 0;
    state = waited > 2 * w ? 'never' : 'warming';
    why = state === 'never' ? `declared and watched for ${Math.round(waited / 60e3)} min with no run recorded` : 'declared; no run due yet';
  } else {
    const age = now - last.at, ageMin = Math.round(age / 60e3);
    if (age > 3 * w) { state = 'stopped'; why = `last run ${ageMin} min ago, due every ${everyMin}`; }
    else if (age > 1.5 * w + 60e3) { state = 'late'; why = `last run ${ageMin} min ago, due every ${everyMin}`; }
    else if (last.ok == null && age > HUNG_MS) { state = 'hung'; why = `run started ${ageMin} min ago and never returned`; }
    else if (last.ok === 0) { state = 'failing'; why = 'last run failed'; }
    else why = `ran ${ageMin} min ago; ${good}/${expected} slots good in 24 h`;
  }
  return { state, why, expected, ran, good, missed, coverage, last_run: last ? iso(last.at) : null, last_good: lastGood != null ? iso(lastGood) : null };
}

async function setOrg(db, key, value) {
  await run(db, `INSERT INTO org (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, JSON.stringify(value));
}
export async function readOrg(db, key) {
  const r = await first(db, `SELECT value FROM org WHERE key=?`, key).catch(() => null);
  try { return r ? JSON.parse(r.value) : null; } catch { return null; }
}

// FREE-TIER-1: the beats of the last 24 h are kept as one org row and only the rows since the last read (plus any still in flight) are read again,
// instead of re-reading every loop's 24 h of beats each tick (about 2,300 rows a read, 40 reads in 3 h). A beat still open after BEAT_REOPEN_MS is not re-read.
const BEAT_REOPEN_MS = 30 * 60e3;
async function recentBeats(db, now, cut) {
  const cutMs = ms(cut), c = await readOrg(db, 'pulse_beats_cache');
  let runs = {}, from = cut;
  if (c && c.runs && c.read_at) {
    runs = c.runs;
    let f = ms(c.read_at);
    for (const arr of Object.values(runs)) for (const [at, ok] of arr) if (ok == null && at < f && at > now - BEAT_REOPEN_MS) f = Math.min(f, at);
    from = iso(Math.max(f, cutMs));
  }
  const fromMs = ms(from);
  for (const k of Object.keys(runs)) { runs[k] = runs[k].filter(([at]) => at >= cutMs && at < fromMs); if (!runs[k].length) delete runs[k]; }
  for (const b of await all(db, `SELECT loop, started_at, ok FROM loop_beats WHERE started_at >= ?`, from)) (runs[b.loop] = runs[b.loop] || []).push([ms(b.started_at), b.ok == null ? null : Number(b.ok)]);
  await setOrg(db, 'pulse_beats_cache', { read_at: iso(now - 60e3), runs });
  const out = {};
  for (const [k, arr] of Object.entries(runs)) out[k] = arr.map(([at, ok]) => ({ at, ok }));
  return out;
}
// First time a loop was seen: stored once and kept, so the table is never grouped each tick; only a loop with no stored first costs one indexed read.
async function firstSeen(db, loops) {
  const stored = (await readOrg(db, 'pulse_firsts')) || {}; let changed = false;
  for (const l of new Set(loops)) if (stored[l] == null) { const r = await first(db, `SELECT MIN(started_at) AS f FROM loop_beats WHERE loop=?`, l); if (r && r.f) { stored[l] = ms(r.f); changed = true; } }
  if (changed) await setOrg(db, 'pulse_firsts', stored);
  return stored;
}

// The tick step. Judges every loop (declared, or ever seen) and the tick itself, writes loop_clock, files and closes MISSED-<loop>.
export async function pulseStep(db, ctx, ensureItem) {
  await ensurePulseSchema(db);
  const now = ctx.now, every = await tickCadenceMin(db, ctx.config);
  const sinceRow = await readOrg(db, 'pulse_since');
  const since = sinceRow && sinceRow.at ? ms(sinceRow.at) : now;
  if (!sinceRow) await setOrg(db, 'pulse_since', { at: ctx.nowIso });
  const cut = iso(now - 86400e3 - every * 60e3);
  const byLoop = await recentBeats(db, now, cut);
  const prev = Object.fromEntries((await all(db, `SELECT loop, every_min, bad_streak FROM loop_clock`)).map(r => [r.loop, r]));
  const cad = { ...DEFAULT_CADENCE, ...((ctx.config.pulse && ctx.config.pulse.cadence) || {}) };
  const declared = new Set([...((ctx.config.pulse && ctx.config.pulse.loops) || LANE_LOOPS), ...Object.keys(cad)]);
  const firsts = await firstSeen(db, [...declared, ...Object.keys(byLoop)]);
  const loops = new Set([...declared, ...Object.keys(byLoop), ...Object.keys(firsts).filter(l => firsts[l] > now - 8 * 86400e3)]);  // the ledger keeps 8 days
  const judged = [];
  // The tick itself, from its own ledger. A tick is good only when it finished every step.
  const ticks = await all(db, `SELECT started_at, steps_completed, steps_total, finished_at FROM tick_runs WHERE started_at >= ? AND id <> ?`, cut, ctx.tickId);
  const tf = await first(db, `SELECT MIN(started_at) AS f FROM tick_runs`);
  judged.push({ loop: 'tick', every_min: every, declared: 1, ...judgeLoop({ everyMin: every, now, sinceMs: since, firstAt: tf && tf.f ? ms(tf.f) : null,
    runs: ticks.map(t => ({ at: ms(t.started_at), ok: t.finished_at == null ? null : (t.steps_completed === t.steps_total ? 1 : 0) })) }) });
  for (const loop of loops) {
    const runs = byLoop[loop] || [];
    let ev = cad[loop] || every;
    if (!declared.has(loop)) {  // a loop seen but not declared (the watchdog, a webhook) keeps the cadence it shows: the median gap of its own runs
      const at = runs.map(r => r.at).sort((a, b) => a - b), gaps = [];
      for (let i = 1; i < at.length; i++) { const g = Math.round((at[i] - at[i - 1]) / 60e3); if (g >= 1) gaps.push(g); }
      gaps.sort((a, b) => a - b);
      ev = gaps.length >= 3 ? gaps[Math.floor(gaps.length / 2)] : (prev[loop] ? prev[loop].every_min : every);
    }
    judged.push({ loop, every_min: ev, declared: declared.has(loop) ? 1 : 0, ...judgeLoop({ everyMin: ev, now, sinceMs: since, firstAt: firsts[loop] ?? null, runs }) });
  }
  const filed = [], closed = [];
  for (const j of judged) {
    const bad = BAD.includes(j.state);
    j.bad_streak = bad ? ((prev[j.loop] ? prev[j.loop].bad_streak : 0) + 1) : 0;
    await run(db, `INSERT INTO loop_clock (loop, every_min, declared, state, why, last_run, last_good, expected_24h, ran_24h, good_24h, missed_24h, coverage, bad_streak, checked_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(loop) DO UPDATE SET every_min=excluded.every_min, declared=excluded.declared, state=excluded.state, why=excluded.why,
        last_run=excluded.last_run, last_good=excluded.last_good, expected_24h=excluded.expected_24h, ran_24h=excluded.ran_24h, good_24h=excluded.good_24h, missed_24h=excluded.missed_24h,
        coverage=excluded.coverage, bad_streak=excluded.bad_streak, checked_at=excluded.checked_at`,
      j.loop, j.every_min, j.declared, j.state, j.why, j.last_run, j.last_good, j.expected, j.ran, j.good, j.missed, j.coverage, j.bad_streak, ctx.nowIso);
    const id = `MISSED-${j.loop}`.slice(0, 80);
    if (bad && j.bad_streak >= 2) {  // one bad reading is a late run; two in a row is a loop that is not executing
      const made = await ensureItem(db, { id, kind: 'fix', owner_role: 'operations', priority: -1,
        title: `Loop ${j.loop} is ${j.state}: ${j.why}. ${j.missed} of ${j.expected} slots missed in 24 h. Find why it did not run (loop_beats.error) and fix the cause.`.slice(0, 400),
        done_check: `loop_clock.state of ${j.loop} is ticking`, closing_probe: `pulse:${j.loop}` });
      if (made) filed.push(id);
      else {
        const r = await run(db, `UPDATE items SET status='ready', disposition=NULL, updated_at=? WHERE id=? AND status IN ('done','superseded','cancelled')`, ctx.nowIso, id);
        if (r.meta && r.meta.changes) { await run(db, `INSERT INTO outcomes (item_id, surface, action_class, result, evidence) VALUES (?, 'pulse', 'probe', 'failed', ?)`, id, `reopened: pulse:${j.loop} ${j.state} at ${ctx.nowIso}`); filed.push(id); }
      }
    } else if (j.state === 'ticking') {
      const r = await run(db, `UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=? AND status NOT IN ('done','superseded','cancelled')`, `probe green: pulse:${j.loop} ticking`, ctx.nowIso, id);
      if (r.meta && r.meta.changes) {
        await run(db, `DELETE FROM claims WHERE item_id=?`, id);
        await run(db, `INSERT INTO outcomes (item_id, surface, action_class, result, evidence) VALUES (?, 'pulse', 'probe', 'verified', ?)`, id, `probe:pulse:${j.loop} ticking at ${ctx.nowIso}`);
        closed.push(id);
      }
    }
  }
  if (Math.floor(now / (every * 60e3)) % 36 === 0) await run(db, `DELETE FROM loop_beats WHERE started_at < ?`, iso(now - 8 * 86400e3));  // the ledger keeps 8 days
  const exp = judged.reduce((s, j) => s + j.expected, 0), good = judged.reduce((s, j) => s + j.good, 0);
  const notTicking = judged.filter(j => BAD.includes(j.state));
  const tick = judged[0];
  const snap = { at: ctx.nowIso, every_min: every, loops: judged.length, ticking: judged.filter(j => j.state === 'ticking').length,
    warming: judged.filter(j => j.state === 'warming').length, not_ticking: notTicking.map(j => ({ loop: j.loop, state: j.state, why: j.why })),
    expected_24h: exp, good_24h: good, missed_24h: judged.reduce((s, j) => s + j.missed, 0), coverage_24h: exp ? Number((good / exp).toFixed(4)) : null,
    tick: { state: tick.state, expected_24h: tick.expected, good_24h: tick.good, missed_24h: tick.missed, coverage: tick.coverage },
    watchdog: judged.some(j => j.loop === 'watchdog' && j.state === 'ticking') };
  ctx.pulse = snap;
  await setOrg(db, 'pulse', snap);
  ctx.notes.push(`pulse: ${snap.ticking}/${snap.loops} loops ticking, coverage ${snap.coverage_24h ?? 'unmeasured'}, ${snap.missed_24h} missed slot(s)${filed.length ? `, filed ${filed.join(',')}` : ''}${closed.length ? `, closed ${closed.join(',')}` : ''}`);
  return snap;
}

// The second producer. Leaves a beat every call; runs the tick itself when the newest tick is older than two intervals.
export async function watch(db, runTickNow, { now = Date.now, config = {} } = {}) {
  await ensurePulseSchema(db);
  const every = await tickCadenceMin(db, config);
  const last = await first(db, `SELECT MAX(started_at) AS t FROM tick_runs`);
  const age = last && last.t ? now() - ms(last.t) : null;
  const stale = age == null || age > 2 * every * 60e3;
  const out = await beat(db, 'watchdog', async () => {
    if (!stale) return { stale: false, age_min: Math.round(age / 60e3) };
    const r = await runTickNow();
    return { stale: true, age_min: age == null ? null : Math.round(age / 60e3), ran_tick: r && r.tickId, completed: r && r.completed, total: r && r.total };
  }, { now, source: 'watchdog', everyMin: every });
  return { ok: true, every_min: every, ...out };
}

export async function readPulse(db) {
  const snap = await readOrg(db, 'pulse');
  const clock = await all(db, `SELECT loop, every_min, state, why, last_run, last_good, expected_24h, good_24h, missed_24h, coverage FROM loop_clock ORDER BY loop`).catch(() => []);
  return snap ? { ...snap, clock } : null;
}
