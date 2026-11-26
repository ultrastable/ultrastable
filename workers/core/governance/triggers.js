// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Triggers on the numbers of US-SPEC-07 section 3.1 (US-07-R22): the five recognition rates (target 0) and the self-adoption
// rate (target 1). A breach files one work item per number and day, with the target as its done check and a SQL closing probe
// the tick can run; a number with too few observations is reported as unmeasured and files nothing.
// Ports: db, now (ms), config { min_scans, days, targets, min_self_adoption, self_adoption_tolerance, owner_role }.
import { all, first, run, iso } from './register.js';
import { rates } from './engine.js';

export const TRIGGER_DEFAULTS = { min_scans: 10, days: 7, min_self_adoption: 1, self_adoption_tolerance: 0, owner_role: 'operations' };
// The shapes each rate counts (rates() in engine.js). `null` means every shape.
const RATE_SHAPES = {
  false_stop_rate: null,
  conditional_offer_rate: ['conditional_offer'],
  question_rate: ['question_ending'],
  actor_assignment_rate: ['principal_actor', 'principal_executor'],
  narration_rate: ['narration'],
};
// The deferral shapes of the self-adoption rate: an output that asked, offered or waited instead of executing the default.
export const DEFERRAL_SHAPES = ['conditional_offer', 'question_ending', 'menu', 'stop_not_eligible'];
const sqlList = (a) => a.map(x => `'${x}'`).join(',');
const slug = (k) => k.replace(/_/g, '-');

/** Share of recent identified actions that were executed by self-adoption: verified adoptions / (verified adoptions + deferral hits). Null when unmeasurable. */
export async function selfAdoptionRate(db, { now = Date.now(), days = TRIGGER_DEFAULTS.days } = {}) {
  const since = iso(now - days * 86400e3);
  let adopted;
  try { adopted = (await first(db, `SELECT COUNT(*) AS n FROM trust_adoptions WHERE verified = 1 AND at >= ?`, since)).n; }
  catch (e) { if (/no such table/i.test(String(e && e.message))) return null; throw e; } // core/trust is not installed: unmeasured, not zero
  const deferred = (await first(db, `SELECT COUNT(*) AS n FROM governance_false_stop_hits WHERE excluded = 0 AND pattern_key IN (${sqlList(DEFERRAL_SHAPES)}) AND ts >= ?`, since)).n;
  const denom = adopted + deferred;
  return denom ? { rate: adopted / denom, adopted, deferred } : null;
}

async function file(db, it, nowIso) {
  if (await first(db, `SELECT 1 AS x FROM items WHERE id = ?`, it.id)) return false;
  await run(db, `INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, created_at, updated_at) VALUES (?,?,'fix',?,?,?,5,'ready',?,?)`,
    it.id, String(it.title).slice(0, 300), it.owner_role, it.done_check, it.closing_probe, nowIso, nowIso);
  return true;
}

/**
 * US-07-R22. Reads the rates over `days` and the self-adoption rate and files one item per breached number and day. Returns
 * { measured, scans, rates, self_adoption, breaches[], filed[] }. With fewer than `min_scans` scans the rates are unmeasured
 * (`measured: false`) and nothing is filed for them; the self-adoption rate is unmeasured without observations.
 */
export async function checkRates(db, { now = Date.now(), config = {} } = {}) {
  const c = { ...TRIGGER_DEFAULTS, ...config };
  const nowIso = iso(now), day = nowIso.slice(0, 10), since = `datetime('now', '-${Math.floor(c.days)} days')`;
  const r = await rates(db, { now, days: c.days });
  const out = { measured: r.scans >= c.min_scans, scans: r.scans, rates: r, self_adoption: null, breaches: [], filed: [] };
  if (out.measured) {
    for (const [key, shapes] of Object.entries(RATE_SHAPES)) {
      const target = c.targets && typeof c.targets[key] === 'number' ? c.targets[key] : 0;
      if (r[key] === null || !(r[key] > target)) continue;
      out.breaches.push(key);
      const where = `excluded = 0 AND scan_id IS NOT NULL AND ts >= ${since}${shapes ? ` AND pattern_key IN (${sqlList(shapes)})` : ''}`;
      const probe = `SELECT CASE WHEN (SELECT COUNT(DISTINCT scan_id) FROM governance_false_stop_hits WHERE ${where}) * 1.0 <= ${Number(target)} * (SELECT COUNT(*) FROM governance_scans WHERE ts >= ${since}) THEN 1 ELSE 0 END`;
      const id = `GOV-${slug(key)}-${day}`;
      if (await file(db, { id, owner_role: c.owner_role, title: `${key} ${(r[key] * 100).toFixed(0)}% over ${c.days} days is above its target ${(target * 100).toFixed(0)}% (${r.scans} scans)`, done_check: `${key} <= ${target}`, closing_probe: probe }, nowIso)) out.filed.push(id);
    }
  }
  const sa = await selfAdoptionRate(db, { now, days: c.days });
  if (sa) {
    out.self_adoption = sa;
    const floor = c.min_self_adoption - c.self_adoption_tolerance;
    if (sa.rate < floor) {
      out.breaches.push('self_adoption_rate');
      const id = `GOV-self-adoption-${day}`;
      const probe = `SELECT CASE WHEN (SELECT COUNT(*) FROM trust_adoptions WHERE verified = 1 AND at >= ${since}) * 1.0 >= ${Number(floor)} * ((SELECT COUNT(*) FROM trust_adoptions WHERE verified = 1 AND at >= ${since}) + (SELECT COUNT(*) FROM governance_false_stop_hits WHERE excluded = 0 AND pattern_key IN (${sqlList(DEFERRAL_SHAPES)}) AND ts >= ${since})) THEN 1 ELSE 0 END`;
      if (await file(db, { id, owner_role: c.owner_role, title: `Self-adoption rate ${(sa.rate * 100).toFixed(0)}% over ${c.days} days is under its target ${(floor * 100).toFixed(0)}% (${sa.adopted} adopted, ${sa.deferred} deferred)`, done_check: `self_adoption_rate >= ${floor}`, closing_probe: probe }, nowIso)) out.filed.push(id);
    }
  }
  return out;
}
