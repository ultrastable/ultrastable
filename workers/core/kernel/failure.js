// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Failure-mode register, remediation contracts, loop breaker and remedies (US-SPEC-17, US-SPEC-05 s5).
import { all, first, run, iso, parseIso, compare, improvement, assertReadOnly, ensureItem, TERMINAL_SQL } from './util.js';
import { readMetric } from './metrics.js';

// ---- Register and detectors -------------------------------------------------------------------

const FIRE_RE = /^\s*value\s*(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)\s*(\*\s*expected)?\s*$/;
export function parseFireWhen(s) {
  const m = FIRE_RE.exec(s || '');
  return m ? { op: m[1], n: Number(m[2]), times_expected: Boolean(m[3]) } : null;
}
const PASS_RE = /^\s*(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)\s*$/;

// The module-local state of core/remediation (migrations/0002_state.sql) is optional: a store with only the kernel tables works
// without relapse counts, firing links and breaker sources, and every read of those tables goes through this guard.
const hasTable = async (db, name) => !!(await first(db, `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, name));

function checkContract(c) {
  for (const f of ['owner', 'doer', 'closing_probe', 'pass', 'max_attempts', 'backoff_h', 'deadline_h']) {
    if (c[f] === undefined || c[f] === null || c[f] === '') throw new Error(`remediation contract requires ${f}`);
  }
  assertReadOnly(c.closing_probe);
  if (c.verify_probe) assertReadOnly(c.verify_probe); // US-17-R09: an independent reading of whether the failure is real
  if (!PASS_RE.test(c.pass)) throw new Error('contract pass must look like "= 0"');
  if (!Array.isArray(c.backoff_h) || !c.backoff_h.length) throw new Error('backoff_h must be a non-empty array');
}

// US-17-R03/R04: a detector, a severity and a full contract are required to register a failure mode.
export async function registerFailureMode(db, fm, now = Date.now()) {
  assertReadOnly(fm.detector_sql);
  if (!parseFireWhen(fm.fire_when)) throw new Error('fire_when must look like "value < 0.8*expected" or "value > 0"');
  if (!Number.isInteger(fm.severity) || fm.severity < 1 || fm.severity > 5) throw new Error('severity must be 1..5');
  checkContract(fm.contract);
  await run(db, `INSERT INTO kernel_failure_modes (id, name, surface, detector_sql, fire_when, severity, contract_json, interval_h, first_seen)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, surface=excluded.surface, detector_sql=excluded.detector_sql, fire_when=excluded.fire_when,
        severity=excluded.severity, contract_json=excluded.contract_json, interval_h=excluded.interval_h`,
    fm.id, fm.name ?? null, fm.surface ?? null, fm.detector_sql, fm.fire_when, fm.severity, JSON.stringify(fm.contract), fm.interval_h ?? 1, iso(now));
}

// The item id of a remediation: FM-<id>-<yyyymmddhh>, with -2, -3, ... when that id is already taken (US-17-R04). Two remediations
// of one failure mode in the same clock hour no longer collide, so a relapse is never swallowed by the closed one before it.
async function remediationItemId(db, fmId, nowIso) {
  const base = `FM-${fmId}-${nowIso.slice(0, 13).replace(/[- :]/g, '')}`;
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!(await first(db, `SELECT 1 AS x FROM items WHERE id = ?`, id)) && !(await first(db, `SELECT 1 AS x FROM kernel_remediations WHERE item_id = ?`, id))) return id;
  }
}
async function linkFiring(db, itemId, hitId) {
  if (hitId == null || !(await hasTable(db, 'remediation_firings'))) return;
  await run(db, `INSERT INTO remediation_firings (item_id, hit_id, verified_at) VALUES (?,?,NULL) ON CONFLICT(item_id) DO UPDATE SET hit_id = excluded.hit_id, verified_at = NULL`, itemId, hitId);
}

// US-17-R04, R16: open the remediation for a firing. A failure mode with an open one gets none. One whose latest remediation closed
// inside `relapse_window_h` has relapsed: that remediation reopens (attempts reset, item ready again) and the relapse is counted.
// Otherwise a new remediation opens under a collision-free item id.
async function openRemediation(db, fm, nowIso, { hitId = null, relapse_window_h = 168 } = {}) {
  const open = await first(db, `SELECT 1 AS x FROM kernel_remediations WHERE fm_id = ? AND status IN ('open','needs_human')`, fm.id);
  if (open) return null;
  const c = JSON.parse(fm.contract_json);
  if (await hasTable(db, 'remediation_relapses')) {
    const last = await first(db, `SELECT item_id, opened_at FROM kernel_remediations WHERE fm_id = ? AND status = 'closed' ORDER BY rowid DESC LIMIT 1`, fm.id);
    const closed = last && (await first(db, `SELECT updated_at FROM items WHERE id = ?`, last.item_id));
    if (closed && parseIso(nowIso) - parseIso(closed.updated_at) <= relapse_window_h * 3600e3) {
      await run(db, `UPDATE kernel_remediations SET status='open', attempts=0, next_attempt_at=?, opened_at=?, evidence='relapse: the detector fired again after closure' WHERE item_id=?`, nowIso, nowIso, last.item_id);
      await run(db, `UPDATE items SET status='ready', disposition=NULL, blocker=NULL, updated_at=? WHERE id=?`, nowIso, last.item_id);
      await run(db, `INSERT INTO remediation_relapses (fm_id, count, last_at) VALUES (?,1,?) ON CONFLICT(fm_id) DO UPDATE SET count = count + 1, last_at = excluded.last_at`, fm.id, nowIso);
      await run(db, `DELETE FROM remediation_passes WHERE item_id = ?`, last.item_id).catch(() => null);
      await linkFiring(db, last.item_id, hitId);
      return last.item_id;
    }
  }
  const itemId = await remediationItemId(db, fm.id, nowIso);
  await ensureItem(db, {
    id: itemId, title: `Failure mode ${fm.id} fired${fm.name ? `: ${fm.name}` : ''}`, owner_role: c.owner, doer: c.doer,
    priority: Math.max(0, 5 - fm.severity), done_check: `closing probe passes: ${c.closing_probe} ${c.pass}`, closing_probe: c.closing_probe,
    surface: fm.surface, critical: fm.severity >= 4,
  });
  const [, pop, pval] = PASS_RE.exec(c.pass);
  await run(db, `INSERT OR IGNORE INTO kernel_remediations (item_id, fm_id, severity, owner, doer, alt_doers, trigger_kind, closing_probe, pass_op, pass_value,
      max_attempts, backoff_h, deadline_h, interrupt_eligible, next_attempt_at, opened_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    itemId, fm.id, fm.severity, c.owner, c.doer, JSON.stringify(c.alt_doers || []), c.trigger || 'on_fire', c.closing_probe, pop, Number(pval),
    c.max_attempts, JSON.stringify(c.backoff_h), c.deadline_h, c.interrupt_eligible ? 1 : 0, nowIso, nowIso);
  await linkFiring(db, itemId, hitId);
  return itemId;
}

// US-17-R14: a detector that cannot run is a finding, never a pass. One missing reading may be transient; `broken_after` consecutive
// readings with no value (an error, or a statement that returned nothing) file DETECTOR-BROKEN-<id>, closed when a value returns.
async function trackBroken(db, fm, hadValue, nowIso, broken_after) {
  const id = `DETECTOR-BROKEN-${fm.id}`;
  if (hadValue) {
    const r = await run(db, `UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=? AND status NOT IN ${TERMINAL_SQL}`, 'the detector returned a value again', nowIso, id);
    return r.meta.changes ? { closed: id } : null;
  }
  const last = await all(db, `SELECT value FROM kernel_failure_mode_hits WHERE fm_id = ? ORDER BY id DESC LIMIT ?`, fm.id, broken_after);
  if (last.length < broken_after || last.some(h => h.value !== null)) return null;
  let c = {}; try { c = JSON.parse(fm.contract_json); } catch { /* the register refuses a contract it cannot parse; an unreadable one still files */ }
  const made = await ensureItem(db, { id, title: `Detector ${fm.id} cannot produce a reading: ${broken_after} runs in a row returned no value`, owner_role: c.owner || 'operations', priority: 1,
    done_check: 'the detector returns a value', closing_probe: fm.detector_sql, surface: fm.surface });
  if (made) return { filed: id };
  const reopened = await run(db, `UPDATE items SET status='ready', disposition=NULL, updated_at=? WHERE id=? AND status IN ${TERMINAL_SQL}`, nowIso, id);
  return reopened.meta.changes ? { filed: id, reopened: true } : null;
}

// US-17-R01: one hit row per run, fired or not. A detector error is a row too (value null), never silence, and (R14) enough rows
// in a row with no value file DETECTOR-BROKEN-<id>. With due_only (R15) a detector runs on its own schedule: no new row while the
// newest one is younger than its interval_h. The result is the list of firings; `result.broken` (not enumerable) lists the
// DETECTOR-BROKEN items filed or closed by this run.
export async function runDetectors(db, { now = Date.now(), due_only = false, broken_after = 2, relapse_window_h = 168 } = {}) {
  const nowIso = iso(now);
  const fired = [], broken = [];
  for (const fm of await all(db, `SELECT * FROM kernel_failure_modes WHERE status IN ('armed','probation') ORDER BY id`)) {
    if (due_only) {
      const prev = await first(db, `SELECT MAX(ts) AS ts FROM kernel_failure_mode_hits WHERE fm_id = ?`, fm.id);
      if (prev && prev.ts && parseIso(prev.ts) + fm.interval_h * 3600e3 > now) continue;
    }
    let value = null, expected = null, evidence = null, fire = 0;
    try {
      const row = await first(db, assertReadOnly(fm.detector_sql));
      value = row && row.value !== null && row.value !== undefined ? Number(row.value) : null;
      expected = row && row.expected !== null && row.expected !== undefined ? Number(row.expected) : null;
      const w = parseFireWhen(fm.fire_when);
      const rhs = w.times_expected ? (expected === null ? null : w.n * expected) : w.n;
      fire = value !== null && rhs !== null && compare(w.op, value, rhs) ? 1 : 0;
      if (value === null) evidence = 'detector returned no value';
    } catch (e) { evidence = `detector error: ${e.message}`; }
    const ins = await run(db, `INSERT INTO kernel_failure_mode_hits (fm_id, ts, value, expected, fired, evidence) VALUES (?,?,?,?,?,?)`, fm.id, nowIso, value, expected, fire, evidence);
    const b = await trackBroken(db, fm, value !== null, nowIso, broken_after);
    if (b) broken.push({ fm: fm.id, ...b });
    if (fire) {
      await run(db, `UPDATE kernel_failure_modes SET last_fired = ? WHERE id = ?`, nowIso, fm.id);
      if (fm.status === 'armed') fired.push({ fm: fm.id, item: await openRemediation(db, fm, nowIso, { hitId: Number(ins.meta.last_row_id), relapse_window_h }) });
    }
  }
  Object.defineProperty(fired, 'broken', { value: broken, enumerable: false });
  return fired;
}

// FM-FROZEN applied to the register itself: an armed detector with no hit row for 2 intervals is a failure.
// The age is computed from the clock passed in with the data it compares (US-17-R02 / US-05-R14).
export async function detectStaleDetectors(db, { now = Date.now() } = {}) {
  const filed = [];
  for (const fm of await all(db, `SELECT id, interval_h, first_seen FROM kernel_failure_modes WHERE status = 'armed'`)) {
    const last = await first(db, `SELECT MAX(ts) AS ts FROM kernel_failure_mode_hits WHERE fm_id = ?`, fm.id);
    const ref = parseIso(last.ts || fm.first_seen);
    const ratio = (now - ref) / 3600e3 / fm.interval_h;
    if (ratio > 2) {
      const id = `FM-STALE-${fm.id}-${iso(now).slice(0, 10)}`;
      if (await ensureItem(db, { id, title: `Detector ${fm.id} has written no hit row for ${ratio.toFixed(1)} intervals`, owner_role: 'operations', priority: 1,
        done_check: `a hit row for ${fm.id} is newer than 2 intervals` })) filed.push(id);
    }
  }
  return filed;
}

// US-17-R09: a detector whose last `window` confirmed firings were mostly false goes to probation.
export async function confirmFiring(db, hitId, real) {
  await run(db, `UPDATE kernel_failure_mode_hits SET confirmed = ? WHERE id = ?`, real ? 1 : 0, hitId);
}
export async function reviewProbation(db, { window = 10, min_share = 0.5 } = {}) {
  const demoted = [];
  for (const fm of await all(db, `SELECT id FROM kernel_failure_modes WHERE status = 'armed'`)) {
    const rows = await all(db, `SELECT confirmed FROM kernel_failure_mode_hits WHERE fm_id = ? AND fired = 1 AND confirmed IS NOT NULL ORDER BY id DESC LIMIT ?`, fm.id, window);
    if (rows.length < window) continue;
    if (rows.filter(r => r.confirmed === 1).length / rows.length < min_share) {
      await run(db, `UPDATE kernel_failure_modes SET status = 'probation' WHERE id = ?`, fm.id); demoted.push(fm.id);
    }
  }
  return demoted;
}

// US-17-T06: classify a payload by structure. A key named "failed" holding a count is not a failure.
export function payloadIsFailure(payload) {
  let o = payload;
  if (typeof payload === 'string') { try { o = JSON.parse(payload); } catch { return false; } }
  if (!o || typeof o !== 'object') return false;
  if (o.ok === false || o.success === false) return true;
  if (typeof o.error === 'string' && o.error) return true;
  if (o.error && typeof o.error === 'object') return true;
  if (typeof o.exception === 'string' && o.exception) return true;
  return false;
}

// ---- Remediation consumer and accounting invariant ---------------------------------------------

// US-17-R05: scanned == executed + failed + needs_human + no_action, else an incident and the unaccounted items reopen.
export async function recordLoopRun(db, { loop, scanned, executed = 0, failed = 0, needs_human = 0, no_action = 0, unaccounted_item_ids = [], now = Date.now() }) {
  const balanced = scanned === executed + failed + needs_human + no_action ? 1 : 0;
  await run(db, `INSERT INTO kernel_loop_runs (loop, scanned, executed, failed, needs_human, no_action, balanced, at) VALUES (?,?,?,?,?,?,?,?)`,
    loop, scanned, executed, failed, needs_human, no_action, balanced, iso(now));
  let incident = null; let reopened = 0;
  if (!balanced) {
    incident = `UNACCOUNTED-${loop}-${iso(now).slice(0, 13).replace(/[- :]/g, '')}`;
    await ensureItem(db, { id: incident, title: `Loop ${loop} scanned ${scanned} but booked ${executed + failed + needs_human + no_action}`, owner_role: 'operations', priority: 0,
      done_check: 'next run of the loop balances: scanned = executed + failed + needs_human + no_action' });
    for (const id of unaccounted_item_ids) {
      await run(db, `UPDATE items SET status = 'open', updated_at = ? WHERE id = ?`, iso(now), id); reopened++;
    }
  }
  return { balanced: Boolean(balanced), incident, reopened };
}

// US-17-R09: the first reading of a remediation judges its firing. The verify_probe of the contract (an independent reading, falling
// back to the closing probe) is read; the firing was real when the failure is still there. confirmFiring feeds reviewProbation, so a
// detector that keeps firing over nothing goes to probation without anyone calling confirmFiring by hand.
async function verifyFiring(db, r, contract, nowIso) {
  if (!(await hasTable(db, 'remediation_firings'))) return;
  const f = await first(db, `SELECT hit_id FROM remediation_firings WHERE item_id = ? AND verified_at IS NULL`, r.item_id);
  if (!f) return;
  let real = true;
  try {
    const row = await first(db, assertReadOnly(contract.verify_probe || r.closing_probe));
    const v = row ? Number(row.value ?? Object.values(row)[0]) : null;
    real = !(v !== null && !Number.isNaN(v) && compare(r.pass_op, v, r.pass_value));
  } catch { real = true; } // a verification that cannot read does not refute the detector
  await confirmFiring(db, f.hit_id, real);
  await run(db, `UPDATE remediation_firings SET verified_at = ? WHERE item_id = ?`, nowIso, r.item_id);
}

// US-17-R17: closure needs the probe to pass `passes_to_close` times in a row (contract field, default 1); once a failure mode has
// relapsed three times the default is 2 (`passes_after_reopen`), so a flapping fix is not closed on one lucky reading.
async function passesNeeded(db, r, contract) {
  if (!(await hasTable(db, 'remediation_passes')) || !(await hasTable(db, 'remediation_relapses'))) return 1;
  const rel = r.fm_id ? await first(db, `SELECT count FROM remediation_relapses WHERE fm_id = ?`, r.fm_id) : null;
  const base = Number(contract.passes_to_close) >= 1 ? Number(contract.passes_to_close) : 1;
  return rel && rel.count >= 3 ? Math.max(base, Number(contract.passes_after_reopen) >= 1 ? Number(contract.passes_after_reopen) : 2) : base;
}

// invokeDoer(r) does the work; scorePrediction(item_id) (optional, US-17-R21) scores the prediction logged for the item on closure.
export async function consumeRemediations(db, { now = Date.now(), invokeDoer = null, scorePrediction = null } = {}) {
  const nowIso = iso(now);
  const b = { scanned: 0, executed: 0, failed: 0, needs_human: 0, no_action: 0 };
  const rems = await all(db, `SELECT * FROM kernel_remediations WHERE status = 'open' ORDER BY severity DESC, opened_at, item_id`);
  for (const r of rems) {
    b.scanned++;
    if (r.next_attempt_at > nowIso) { b.no_action++; continue; }
    let contract = {};
    if (r.fm_id) { const fm = await first(db, `SELECT contract_json FROM kernel_failure_modes WHERE id = ?`, r.fm_id); try { contract = JSON.parse((fm && fm.contract_json) || '{}'); } catch { contract = {}; } }
    await verifyFiring(db, r, contract, nowIso);
    let doerErr = null;
    if (invokeDoer) { try { await invokeDoer(r); } catch (e) { doerErr = `doer ${r.doer} threw: ${String((e && e.message) || e).slice(0, 200)}`; } } // the probe below stays the verdict; the error is kept as evidence
    let value = null, err = null;
    try { const row = await first(db, assertReadOnly(r.closing_probe)); value = row ? Number(row.value ?? Object.values(row)[0]) : null; } catch (e) { err = e.message; }
    const note = [doerErr, err || `probe value ${value}`].filter(Boolean).join('; ');
    if (value !== null && !Number.isNaN(value) && compare(r.pass_op, value, r.pass_value)) {
      const need = await passesNeeded(db, r, contract);
      if (need > 1) {
        await run(db, `INSERT INTO remediation_passes (item_id, streak) VALUES (?,1) ON CONFLICT(item_id) DO UPDATE SET streak = streak + 1`, r.item_id);
        const { streak } = await first(db, `SELECT streak FROM remediation_passes WHERE item_id = ?`, r.item_id);
        if (streak < need) {
          await run(db, `UPDATE kernel_remediations SET evidence=? WHERE item_id=?`, `probe value ${value}: pass ${streak} of ${need} needed to close`, r.item_id);
          b.no_action++; continue;
        }
      }
      // US-17-R06: closes only when the closing probe passes.
      let scored = '';
      if (scorePrediction) { try { scored = `; prediction: ${JSON.stringify(await scorePrediction(r.item_id))}`.slice(0, 300); } catch (e) { scored = `; prediction not scored: ${String((e && e.message) || e).slice(0, 120)}`; } }
      await run(db, `UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=?`, `closed by probe: ${r.closing_probe} = ${value}`, nowIso, r.item_id);
      await run(db, `UPDATE kernel_remediations SET status='closed', evidence=? WHERE item_id=?`, `probe value ${value}${scored}`, r.item_id);
      b.executed++; continue;
    }
    if (await hasTable(db, 'remediation_passes')) await run(db, `DELETE FROM remediation_passes WHERE item_id = ?`, r.item_id);
    const attempts = r.attempts + 1;
    const deadlinePassed = now > parseIso(r.opened_at) + r.deadline_h * 3600e3;
    if (attempts >= r.max_attempts || deadlinePassed) {
      b.needs_human++;
      await escalate(db, r, nowIso, note);
      continue;
    }
    const backoff = JSON.parse(r.backoff_h);
    const wait = backoff[Math.min(attempts - 1, backoff.length - 1)];
    await run(db, `UPDATE kernel_remediations SET attempts=?, next_attempt_at=?, evidence=? WHERE item_id=?`, attempts, iso(now + wait * 3600e3), note, r.item_id);
    b.failed++;
  }
  const acct = await recordLoopRun(db, { loop: 'remediation', ...b, now });
  return { ...b, balanced: acct.balanced };
}

// US-17-R07: after max_attempts, interrupt-eligible work goes through the gate; everything else is reassigned. When no other doer
// is left the remediation is `exhausted`, its item is blocked and ESCALATE-<item> asks the portfolio manager to change the approach:
// an exhausted remediation is a visible state with an owner, never a quiet dead end.
async function escalate(db, r, nowIso, evidence) {
  if (r.interrupt_eligible) {
    await run(db, `INSERT OR IGNORE INTO gate_cards (id, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe) VALUES (?,?,?,?,?,?)`,
      `GATE-${r.item_id}`, `Remediation ${r.item_id} exhausted ${r.max_attempts} attempts`, 'irreversible and identity-bound step remains',
      'the item stays open; nothing further is attempted', `evidence: ${evidence}`, `item_done:${r.item_id}`);
    await run(db, `UPDATE kernel_remediations SET status='needs_human', evidence=? WHERE item_id=?`, evidence, r.item_id);
    return;
  }
  const alts = JSON.parse(r.alt_doers || '[]');
  const idx = alts.indexOf(r.doer);
  const next = alts[idx + 1];
  if (next) {
    await run(db, `UPDATE kernel_remediations SET doer=?, attempts=0, next_attempt_at=?, evidence=? WHERE item_id=?`, next, nowIso, `reassigned from ${r.doer}: ${evidence}`, r.item_id);
    await run(db, `INSERT INTO kernel_item_meta (item_id, doer) VALUES (?, ?) ON CONFLICT(item_id) DO UPDATE SET doer = excluded.doer`, r.item_id, next);
  } else {
    await run(db, `UPDATE kernel_remediations SET status='exhausted', evidence=? WHERE item_id=?`, evidence, r.item_id);
    await run(db, `UPDATE items SET status='blocked', blocker=?, updated_at=? WHERE id=?`, `all doers exhausted: ${evidence}`, nowIso, r.item_id);
    await ensureItem(db, { id: `ESCALATE-${r.item_id}`, title: `Remediation ${r.item_id} exhausted every doer: change the approach (${String(evidence).slice(0, 160)})`, owner_role: 'portfolio-manager', priority: 0,
      done_check: `a different approach to ${r.fm_id || r.item_id} is filed with its own closing probe`, closing_probe: r.closing_probe });
  }
}

// ---- Loop breaker (US-17 s5) --------------------------------------------------------------------

const breakerLog = async (db, target, signature, at, event, detail = null) => {
  if (await hasTable(db, 'remediation_breaker_log')) await run(db, `INSERT INTO remediation_breaker_log (target, signature, at, event, detail) VALUES (?,?,?,?,?)`, target, signature, iso(at), event, detail);
};

// May the next attempt happen? An open breaker refuses until its half-open time. With `source_hash` (US-17-R18) an open breaker whose
// recorded hash differs is re-armed: the thing that kept failing has changed, so one fresh attempt is allowed and the breaker closes.
export async function canAttempt(db, target, signature, now = Date.now(), { source_hash = null } = {}) {
  const b = await first(db, `SELECT * FROM kernel_breakers WHERE target = ? AND signature = ?`, target, signature);
  if (!b || b.state !== 'open') return { allowed: true };
  if (source_hash && await hasTable(db, 'remediation_breaker_sources')) {
    const src = await first(db, `SELECT source_hash FROM remediation_breaker_sources WHERE target = ? AND signature = ?`, target, signature);
    if (src && src.source_hash && src.source_hash !== source_hash) {
      await run(db, `UPDATE kernel_breakers SET state='closed' WHERE target=? AND signature=?`, target, signature);
      await run(db, `UPDATE remediation_breaker_sources SET source_hash=? WHERE target=? AND signature=?`, source_hash, target, signature);
      // ok = 2 marks a source change: failures before it are not counted against the new source (and FM-UNBOUNDED-RETRY reads the same mark)
      await run(db, `INSERT INTO kernel_attempts (target, signature, ok, at) VALUES (?,?,2,?)`, target, signature, iso(now));
      await breakerLog(db, target, signature, now, 'rearmed', `source changed from ${src.source_hash} to ${source_hash}`);
      return { allowed: true, rearmed: true };
    }
  }
  return parseIso(b.half_open_at) <= now ? { allowed: true, half_open: true } : { allowed: false, until: b.half_open_at };
}

// US-17-R08, R18: count failures of one (target, signature) since its last success or source change, inside the window. At k the breaker
// opens, a root-cause item is filed and a half-open probe is scheduled. A failure recorded while it is open doubles the interval only
// when it is the half-open probe itself (at or after half_open_at); a failure earlier than that changes nothing.
export async function recordAttempt(db, { target, signature, ok, now = Date.now(), k = 3, window_h = 24, half_open_h = 24, source_hash = null }) {
  await run(db, `INSERT INTO kernel_attempts (target, signature, ok, at) VALUES (?,?,?,?)`, target, signature, ok ? 1 : 0, iso(now));
  const b = await first(db, `SELECT * FROM kernel_breakers WHERE target = ? AND signature = ?`, target, signature);
  if (ok) {
    if (b && b.state === 'open') { await run(db, `UPDATE kernel_breakers SET state='closed' WHERE target=? AND signature=?`, target, signature); await breakerLog(db, target, signature, now, 'closed', 'an attempt succeeded'); }
    return { state: 'closed' };
  }
  if (b && b.state === 'open') {
    if (parseIso(b.half_open_at) > now) return { state: 'open', half_open_at: b.half_open_at, extended: false };
    const interval = b.interval_h * 2;
    await run(db, `UPDATE kernel_breakers SET interval_h=?, half_open_at=? WHERE target=? AND signature=?`, interval, iso(now + interval * 3600e3), target, signature);
    await breakerLog(db, target, signature, now, 'half-open-failed', `next probe in ${interval} h`);
    return { state: 'open', half_open_at: iso(now + interval * 3600e3), extended: true };
  }
  const reset = (await first(db, `SELECT COALESCE(MAX(id), 0) AS id FROM kernel_attempts WHERE target=? AND signature=? AND ok<>0`, target, signature)).id;
  const n = (await first(db, `SELECT COUNT(*) AS n FROM kernel_attempts WHERE target=? AND signature=? AND ok=0 AND id>? AND at >= ?`, target, signature, reset, iso(now - window_h * 3600e3))).n;
  if (n < k) return { state: 'closed', failures: n };
  const slug = `${target}-${signature}`.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 60);
  const root = `ROOTCAUSE-${slug}`;
  await ensureItem(db, { id: root, title: `Retry loop on ${target} (${signature}) opened the breaker after ${n} failures`, owner_role: 'operations', priority: 1,
    done_check: `a half-open probe of ${target} passes, or the cause is changed`, closing_probe: `half-open probe of ${target}` });
  const halfOpen = iso(now + half_open_h * 3600e3);
  await run(db, `INSERT INTO kernel_breakers (target, signature, state, opened_at, half_open_at, interval_h, root_item_id) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(target, signature) DO UPDATE SET state='open', opened_at=excluded.opened_at, half_open_at=excluded.half_open_at, interval_h=excluded.interval_h, root_item_id=excluded.root_item_id`,
    target, signature, 'open', iso(now), halfOpen, half_open_h, root);
  if (await hasTable(db, 'remediation_breaker_sources')) await run(db, `INSERT INTO remediation_breaker_sources (target, signature, source_hash) VALUES (?,?,?)
      ON CONFLICT(target, signature) DO UPDATE SET source_hash = excluded.source_hash`, target, signature, source_hash);
  await breakerLog(db, target, signature, now, 'opened', `${n} failures; root item ${root}`);
  return { state: 'open', failures: n, root_item_id: root, half_open_at: halfOpen };
}

// ---- Remedies: a remedy that did not move its metric is replaced, not repeated -----------------

const fingerprint = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

export async function proposeRemedy(db, { id, metric_id, description, window_h = 168, min_delta = 0, now = Date.now() }) {
  if (!id || !metric_id || !description) throw new Error('remedy needs id, metric_id and description');
  const fp = fingerprint(description);
  if (await first(db, `SELECT 1 AS x FROM kernel_remedies WHERE metric_id = ? AND fingerprint = ? AND status = 'replaced'`, metric_id, fp)) {
    throw new Error('remedy repeats one that already failed to move this metric; propose a different approach');
  }
  if (await first(db, `SELECT 1 AS x FROM kernel_remedies WHERE metric_id = ? AND status = 'active'`, metric_id)) {
    throw new Error('one remedy at a time per metric (self-change protocol)');
  }
  const baseline = (await readMetric(db, metric_id, now)).value;
  await run(db, `INSERT INTO kernel_remedies (id, metric_id, description, fingerprint, applied_at, window_h, baseline, min_delta) VALUES (?,?,?,?,?,?,?,?)`,
    id, metric_id, description, fp, iso(now), window_h, baseline, min_delta);
  return { id, baseline };
}

export async function judgeRemedies(db, { now = Date.now() } = {}) {
  const out = [];
  for (const r of await all(db, `SELECT * FROM kernel_remedies WHERE status = 'active'`)) {
    if (parseIso(r.applied_at) + r.window_h * 3600e3 > now) continue;
    const m = await first(db, `SELECT op, target FROM kernel_metrics WHERE id = ?`, r.metric_id);
    const observed = (await readMetric(db, r.metric_id, now)).value;
    const gain = improvement(m.op, m.target, r.baseline, observed);
    const moved = gain !== null && gain > 0 && gain >= r.min_delta;
    if (moved) {
      await run(db, `UPDATE kernel_remedies SET status='effective', observed=?, outcome=? WHERE id=?`, observed, `moved ${gain}`, r.id);
      out.push({ id: r.id, status: 'effective' }); continue;
    }
    const item = `REMEDY-REPLACE-${r.id}`;
    await ensureItem(db, { id: item, title: `Remedy ${r.id} did not move ${r.metric_id} in ${r.window_h}h; replace it with a different approach, not a repeat of: ${r.description}`,
      owner_role: 'operations', priority: 2, metric_id: r.metric_id, done_check: `a different remedy for ${r.metric_id} is proposed with its own prediction` });
    await run(db, `UPDATE kernel_remedies SET status='replaced', observed=?, outcome=?, replacement_item_id=? WHERE id=?`, observed, gain === null ? 'unmeasured' : `no movement (${gain})`, item, r.id);
    out.push({ id: r.id, status: 'replaced', item });
  }
  return out;
}

// ---- Retention (US-17-R24): the register's append-only tables are pruned by age ------------------------------------------------------

/**
 * Delete rows older than `keep_days` (default 30, the seed's retention for probe runs) from the tables the register only appends
 * to. The newest hit row of every failure mode, the hits of an open remediation, the newest attempt of every (target, signature)
 * (breaker windows are hours, far inside the retention), the newest remediation of every failure mode and the newest run of every
 * loop are kept; nothing the current state still needs is removed. Returns the number of rows deleted per table.
 */
export async function pruneHits(db, { keep_days = 30, now = Date.now() } = {}) {
  if (!(Number(keep_days) >= 0)) throw new Error('keep_days must be a non-negative number');
  const cutoff = iso(now - keep_days * 86400e3), out = { cutoff, keep_days: Number(keep_days) };
  const linked = await hasTable(db, 'remediation_firings');
  out.hits = (await run(db, `DELETE FROM kernel_failure_mode_hits WHERE ts < ? AND id NOT IN (SELECT MAX(id) FROM kernel_failure_mode_hits GROUP BY fm_id)${linked
    ? ` AND id NOT IN (SELECT f.hit_id FROM remediation_firings f JOIN kernel_remediations r ON r.item_id = f.item_id WHERE r.status IN ('open','needs_human'))` : ''}`, cutoff)).meta.changes;
  out.attempts = (await run(db, `DELETE FROM kernel_attempts WHERE at < ? AND id NOT IN (SELECT MAX(id) FROM kernel_attempts GROUP BY target, signature)`, cutoff)).meta.changes;
  out.loop_runs = (await run(db, `DELETE FROM kernel_loop_runs WHERE at < ? AND id NOT IN (SELECT MAX(id) FROM kernel_loop_runs GROUP BY loop)`, cutoff)).meta.changes;
  const old = await all(db, `SELECT item_id FROM kernel_remediations WHERE status = 'closed' AND opened_at < ? AND rowid NOT IN (SELECT MAX(rowid) FROM kernel_remediations GROUP BY fm_id)`, cutoff);
  for (const r of old) {
    if (linked) await run(db, `DELETE FROM remediation_firings WHERE item_id = ?`, r.item_id);
    if (await hasTable(db, 'remediation_passes')) await run(db, `DELETE FROM remediation_passes WHERE item_id = ?`, r.item_id);
    await run(db, `DELETE FROM kernel_remediations WHERE item_id = ?`, r.item_id);
  }
  out.remediations = old.length;
  return out;
}
