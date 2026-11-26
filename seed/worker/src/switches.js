// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// KILL-SWITCH-1 (US-09-R01, US-09-R03): one on/off row per loop, and a drill that proves the global row works.
//   row     loop_switches holds one row per loop that is switched off ('*' is every loop). A row may carry `until`: past it the row no longer
//           counts, so a switch somebody forgot, or a drill that died half way, ends by itself. The worker variable LOOPS_OFF (a comma list,
//           '*' allowed) switches loops off without a deploy and without a database write, the same way HALT does for the whole Worker (HALT-1).
//   action  a switched-off loop does not run its body. Its beat is still written (pulse.js), and the tick still runs every measuring step:
//           only the acting steps (ACTION_STEPS) wait. Off stops actions, never measurement.
//   drill   drill() turns the global row on for a bounded time, checks that a loop is refused, turns the row off in every case (finally),
//           checks that the loop runs again, and records the test in switch_drills. A global row the owner set is never touched by a drill.
// HALT=1 remains the outer stop (no loop, no tick, pages keep serving); these rows are the finer one. No I/O besides the database handle.
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const iso = (t) => new Date(t).toISOString();

export const ALL = '*';
export const ACTION_STEPS = ['dispatch', 'execute'];   // the tick steps that start or do work; every other step measures, files or repairs
export const DRILL_MAX_MS = 9 * 60e3;                  // US-09-R03: bounded, under 10 minutes
export const DRILL_EVERY_H = 24;
export const SWITCH_DDL = [
  `CREATE TABLE IF NOT EXISTS loop_switches (loop TEXT PRIMARY KEY, reason TEXT NOT NULL, set_by TEXT NOT NULL, set_at TEXT NOT NULL, until TEXT)`,
  `CREATE TABLE IF NOT EXISTS switch_drills (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, ok INTEGER NOT NULL, refused INTEGER, turned_off INTEGER, resumed INTEGER, skipped TEXT, duration_ms INTEGER, error TEXT)`,
];
let ready = new WeakSet();
export async function ensureSwitches(db) {
  if (ready.has(db)) return;
  for (const sql of SWITCH_DDL) await db.prepare(sql).run();
  ready.add(db);
}
export const _resetForTests = () => { ready = new WeakSet(); };

// -> { <loop>: { reason, set_by, until } } for every switch that is off now. Rows whose `until` has passed are not returned.
export async function readSwitches(db, { env = {}, now = Date.now() } = {}) {
  const off = {};
  for (const name of String((env && env.LOOPS_OFF) || '').split(',').map(s => s.trim()).filter(Boolean)) off[name] = { reason: 'worker variable LOOPS_OFF', set_by: 'env', until: null };
  await ensureSwitches(db);
  for (const r of await all(db, `SELECT loop, reason, set_by, until FROM loop_switches WHERE until IS NULL OR until > ?`, iso(now))) off[r.loop] = { reason: r.reason, set_by: r.set_by, until: r.until };
  return off;
}

// The reason a loop is off, or null. The global row covers every loop.
export function offReason(switches, loop) {
  const s = switches && (switches[loop] || switches[ALL]);
  return s ? `${switches[loop] ? loop : 'every loop'} switched off: ${s.reason}` : null;
}

export async function setSwitch(db, loop, off, { reason = '', by = 'system', until = null, now = Date.now() } = {}) {
  await ensureSwitches(db);
  if (!off) return run(db, `DELETE FROM loop_switches WHERE loop = ?`, loop);
  if (!String(reason).trim()) throw new Error('a switch that is turned off states its reason');
  return run(db, `INSERT INTO loop_switches (loop, reason, set_by, set_at, until) VALUES (?,?,?,?,?)
    ON CONFLICT(loop) DO UPDATE SET reason=excluded.reason, set_by=excluded.set_by, set_at=excluded.set_at, until=excluded.until`,
    loop, String(reason).slice(0, 300), by, iso(now), until ? iso(until) : null);
}

// Runs fn unless the loop is off. A refused loop returns its reason and fn is not called.
export async function gated(switches, loop, fn) {
  const why = offReason(switches, loop);
  return why ? { switched_off: why } : fn();
}

// US-09-R03. Never throws; the row it writes is the record of the test. `probe` is the loop name the drill asks about (any name: '*' covers it).
export async function drill(db, { env = {}, now = Date.now, maxMs = DRILL_MAX_MS, probe = 'kill-drill-probe' } = {}) {
  const t0 = now();
  const out = { ok: false, refused: null, turned_off: null, resumed: null, skipped: null, error: null };
  let mine = false;
  try {
    await ensureSwitches(db);
    const before = await readSwitches(db, { env, now: t0 });
    if (before[ALL]) { out.skipped = `the global switch is already on (${before[ALL].set_by}): a real stop is in effect and the drill leaves it alone`; }
    else {
      await setSwitch(db, ALL, true, { reason: 'kill-switch drill', by: 'drill', until: t0 + Math.min(maxMs, DRILL_MAX_MS), now: t0 });
      mine = true;
      let ran = 0;
      const r = await gated(await readSwitches(db, { env, now: now() }), probe, async () => { ran++; return { ran: true }; });
      out.refused = Boolean(r && r.switched_off) && ran === 0;
    }
  } catch (e) { out.error = String((e && e.message) || e).slice(0, 300); }
  finally {
    if (mine) {  // off in every case, and only the drill's own row
      try {
        await run(db, `DELETE FROM loop_switches WHERE loop = ? AND set_by = 'drill'`, ALL);
        out.turned_off = !(await readSwitches(db, { env: {}, now: now() }))[ALL];
        let ran = 0;
        await gated(await readSwitches(db, { env, now: now() }), probe, async () => { ran++; });
        out.resumed = ran === 1;
      } catch (e) { out.turned_off = false; out.error = (out.error ? out.error + '; ' : '') + 'switch not turned off: ' + String((e && e.message) || e).slice(0, 200) + ` (the row expires by itself within ${Math.round(Math.min(maxMs, DRILL_MAX_MS) / 60e3)} minutes)`; }
    }
  }
  out.ok = Boolean(out.refused && out.turned_off && out.resumed);
  out.duration_ms = now() - t0;
  try { await run(db, `INSERT INTO switch_drills (at, ok, refused, turned_off, resumed, skipped, duration_ms, error) VALUES (?,?,?,?,?,?,?,?)`, iso(t0), out.ok ? 1 : 0, out.refused == null ? null : +out.refused, out.turned_off == null ? null : +out.turned_off, out.resumed == null ? null : +out.resumed, out.skipped, out.duration_ms, out.error); }
  catch (e) { out.error = (out.error ? out.error + '; ' : '') + 'drill not recorded: ' + String((e && e.message) || e).slice(0, 200); }
  if (out.skipped && !out.error) return { ...out, status: 'skipped' };
  return out.ok ? out : { ...out, ok: false, error: out.error || 'the drill did not prove refusal, switch-off and resumption' };
}

// The metric: hours since the last drill that passed (null when none has). A drill is due when none passed inside DRILL_EVERY_H.
export async function lastDrill(db, now = Date.now()) {
  await ensureSwitches(db);
  const r = await first(db, `SELECT at FROM switch_drills WHERE ok = 1 ORDER BY id DESC LIMIT 1`);
  const any = await first(db, `SELECT at FROM switch_drills ORDER BY id DESC LIMIT 1`);
  const age = (x) => x && x.at ? +(((now - Date.parse(x.at)) / 3600e3).toFixed(2)) : null;
  const passed = age(r), tried = age(any);
  return { last_pass_age_h: passed, last_run_age_h: tried, due: tried == null || tried >= DRILL_EVERY_H };
}
