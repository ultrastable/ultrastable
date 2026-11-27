// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// core/router/caps (US-SPEC-09 section 3): a switch row per loop that stops the loop's actions and not its measurement
// (US-09-R01), the global switch as a port the claim service, the deploy path and the router read (US-09-R02), and the
// bounded drill of the global switch with the age of its last pass (US-09-R03). Ports: db (D1-style), now (ms).
export const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);
export const GLOBAL = '*';
export const DEFAULT_DRILL_BOUND_MS = 9 * 60 * 1000; // under the 10 minutes the specification allows

const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const msOf = v => (typeof v === 'function' ? msOf(v()) : v instanceof Date ? v.getTime() : Number(v));
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();

/** Engage (on) or release (off) a loop's switch, or the global switch with name '*'. */
export async function setSwitch(db, name, on, { by = 'system', reason = '', now = Date.now() } = {}) {
  if (!name) throw new Error('caps: a switch needs a name');
  await run(db, `INSERT INTO caps_switches (name, is_on, reason, set_by, set_at) VALUES (?,?,?,?,?)
    ON CONFLICT(name) DO UPDATE SET is_on=excluded.is_on, reason=excluded.reason, set_by=excluded.set_by, set_at=excluded.set_at`, name, on ? 1 : 0, reason, by, iso(msOf(now)));
}
/** Is the loop stopped? The global switch stops every loop. */
export async function isOn(db, name) {
  const r = await first(db, `SELECT 1 AS on1 FROM caps_switches WHERE is_on = 1 AND name IN (?, ?)`, GLOBAL, name);
  return !!r;
}
/** The port for core/claims (`ctx.killSwitch`), core/deploy and the router: true while the global switch is on. */
export const killSwitchPort = db => async () => !!(await first(db, `SELECT 1 AS on1 FROM caps_switches WHERE name = ? AND is_on = 1`, GLOBAL));

/**
 * Run one iteration of a loop under its switch (US-09-R01). `measure` always runs, first, and its result is returned;
 * `act` runs only when neither the loop's switch nor the global switch is engaged.
 */
export async function guardLoop(db, name, { act, measure }) {
  const measured = measure ? await measure() : undefined;
  if (await isOn(db, name)) return { acted: false, measured, stopped_by: (await isOn(db, GLOBAL)) ? GLOBAL : name };
  const result = act ? await act() : undefined;
  return { acted: true, measured, result };
}

/**
 * Drill of the global switch (US-09-R03). Turns it on, asks every probe whether its path refused work and left its observation
 * event, turns the switch off in every case (also when a probe throws, and by direct write if the port fails), then proves
 * work is granted again with `resume`. A drill that overruns `boundMs` is recorded as failed and still ends with the switch off.
 * A drill never touches a switch it did not engage: when the global switch is already on (an operator or a loop engaged it for a
 * real incident) the drill refuses to run, writes no switch row and no drill row, and returns `skipped`.
 *   probes: [{ name, refused: async () => boolean, event?: async () => boolean }]   resume: async () => boolean
 */
export async function drill({ db, now = Date.now, boundMs = DEFAULT_DRILL_BOUND_MS, probes = [], resume = async () => true } = {}) {
  const started = msOf(now);
  if (await first(db, `SELECT 1 AS on1 FROM caps_switches WHERE name = ? AND is_on = 1`, GLOBAL)) {
    return { passed: false, skipped: 'switch already engaged', refused_ok: false, event_seen: false, resumed_ok: false, switch_off_after: false, elapsed_ms: 0, error: null };
  }
  let refusedOk = probes.length > 0, eventSeen = true, resumedOk = false, error = null;
  try {
    await setSwitch(db, GLOBAL, true, { by: 'drill', reason: 'drill', now: started });
    for (const p of probes) {
      if ((await p.refused()) !== true) { refusedOk = false; error = error || `${p.name}: work was not refused while the switch was on`; }
      if (p.event && (await p.event()) !== true) { eventSeen = false; error = error || `${p.name}: no observation event`; }
    }
  } catch (e) { refusedOk = false; error = String(e?.message || e).slice(0, 200); }
  finally {
    try { await setSwitch(db, GLOBAL, false, { by: 'drill', reason: 'drill finished', now: msOf(now) }); }
    catch (e) { error = error || String(e?.message || e).slice(0, 200); await run(db, `UPDATE caps_switches SET is_on = 0 WHERE name = ?`, GLOBAL); }
  }
  const off = !(await first(db, `SELECT 1 AS on1 FROM caps_switches WHERE name = ? AND is_on = 1`, GLOBAL));
  if (off) { try { resumedOk = (await resume()) === true; } catch (e) { error = error || String(e?.message || e).slice(0, 200); } }
  const finished = msOf(now), elapsed = finished - started, overran = elapsed > boundMs;
  if (overran) error = error || `drill took ${elapsed} ms, over its bound of ${boundMs} ms`;
  const passed = refusedOk && eventSeen && resumedOk && off && !overran && !error;
  await run(db, `INSERT INTO caps_drills (started_at, finished_at, bound_ms, elapsed_ms, refused_ok, event_seen, resumed_ok, switch_off_after, passed, error) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    iso(started), iso(finished), boundMs, elapsed, refusedOk ? 1 : 0, eventSeen ? 1 : 0, resumedOk ? 1 : 0, off ? 1 : 0, passed ? 1 : 0, error);
  return { passed, refused_ok: refusedOk, event_seen: eventSeen, resumed_ok: resumedOk, switch_off_after: off, elapsed_ms: elapsed, error };
}

/** Hours since the last passing drill, or null before any (the metric of US-09-R03). */
export async function drillAgeHours(db, now = Date.now) {
  const r = await first(db, `SELECT finished_at FROM caps_drills WHERE passed = 1 ORDER BY id DESC LIMIT 1`);
  return r ? (msOf(now) - Date.parse(r.finished_at.replace(' ', 'T') + 'Z')) / 3600000 : null;
}
