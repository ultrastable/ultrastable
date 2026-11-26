// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The standards gate (US-09 section 5): every advertised or configured model carries a maximum output of at least 32,768 tokens
// and a context of at least 128,000, unless an exemption registered with per-model evidence covers it; all layers (server
// constants, client configuration, catalog) are verified after every model change. A missing limit is a violation, never a pass.
import { iso, msOf, all, run, fileItem, closeItem, exempts } from './util.js';

export const MIN_MAX_OUT = 32768, MIN_CONTEXT = 128000;
const FIELDS = [['max_out', MIN_MAX_OUT], ['context', MIN_CONTEXT]];

/** Pure. models: [{ id, layer?, role?, max_out, context }]. Returns { ok, violations, exempt }. */
export function standardsGate(models, { exemptions = [], nowIso = iso(Date.now()), min = {} } = {}) {
  const violations = [], exempt = [];
  for (const m of models) for (const [field, floor] of FIELDS) {
    const need = min[field] ?? floor, v = m[field];
    const bad = v == null ? 'unmeasured' : Number(v) < need ? 'below' : null;
    if (!bad) continue;
    const row = { id: m.id, layer: m.layer ?? null, field, value: v ?? null, min: need, reason: bad };
    const ex = exempts(exemptions, { kind: 'standards', model: m.id, role: m.role || 'unspecified', field, nowIso });
    (ex ? exempt : violations).push(ex ? { ...row, evidence: ex.evidence } : row);
  }
  return { ok: violations.length === 0, violations, exempt };
}

/** Pure. The three layers' lists, each [{ id, max_out, context }]: a model whose limit differs between layers is truncated somewhere. */
export function verifyLayers({ server = [], client = [], catalog = [] }) {
  const layers = { server, client, catalog }, ids = new Set(Object.values(layers).flatMap(l => l.map(m => m.id))), mismatches = [];
  for (const id of ids) for (const [field] of FIELDS) {
    const seen = {};
    for (const [name, list] of Object.entries(layers)) { const m = list.find(x => x.id === id); seen[name] = m ? (m[field] ?? null) : 'absent'; }
    if (new Set(Object.values(seen).map(String)).size > 1) mismatches.push({ id, field, ...seen });
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** Register an exemption. Evidence is required: a bare wish is not one. */
export async function registerExemption(db, { kind = 'standards', model, role, field = null, evidence, expires_at = null }, { now = Date.now } = {}) {
  if (!model || !role) throw new Error('an exemption names a model and a role');
  if (!String(evidence || '').trim()) throw new Error('an exemption needs evidence of what was observed');
  if (kind === 'standards' && !FIELDS.some(([f]) => f === field)) throw new Error('a standards exemption names the field: max_out or context');
  if (role === 'reader-facing') throw new Error('a reader-facing role is never exempt');
  await run(db, `INSERT INTO ladder_exemptions (kind, model, role, field, evidence, registered_at, expires_at) VALUES (?,?,?,?,?,?,?)`, kind, model, role, field, evidence, iso(msOf(now)), expires_at);
}

/**
 * Run the gate over `models` (and the layers when given) and file STANDARDS-<model> (priority 20) per violating model; an item
 * closes when the limit or an exemption appears. Called by ladder.step with config.standards_models after every model change.
 */
export async function standardsRun(db, { models = [], layers = null, now = Date.now } = {}) {
  const ts = iso(msOf(now)), exemptions = await all(db, `SELECT * FROM ladder_exemptions WHERE kind='standards'`);
  const g = standardsGate(models, { exemptions, nowIso: ts }), bad = new Set(g.violations.map(v => v.id)), filed = [];
  for (const id of bad) {
    const vs = g.violations.filter(v => v.id === id);
    await fileItem(db, { id: `STANDARDS-${id}`.replace(/[^\w.:-]/g, '_'), title: `Model ${id} is under the standards: ${vs.map(v => `${v.field} ${v.value ?? 'unmeasured'} < ${v.min}`).join(', ')}`,
      done_check: 'the model meets the output and context minimums, or an exemption with evidence is registered', closing_probe: 'standards gate: ok', priority: 20 }, ts);
    filed.push(id);
  }
  for (const m of models) if (!bad.has(m.id)) await closeItem(db, `STANDARDS-${m.id}`.replace(/[^\w.:-]/g, '_'), 'the model meets the standards or is exempt with evidence', ts);
  const l = layers ? verifyLayers(layers) : { ok: true, mismatches: [] };
  if (!l.ok) await fileItem(db, { id: 'STANDARDS-LAYERS', title: `Model limits differ between layers: ${l.mismatches.slice(0, 3).map(m => `${m.id} ${m.field}`).join(', ')}`, done_check: 'server, client and catalog carry the same limits', closing_probe: 'standards gate: layers agree', priority: 20 }, ts);
  else if (layers) await closeItem(db, 'STANDARDS-LAYERS', 'the layers agree', ts);
  return { ok: g.ok && l.ok, violations: g.violations, exempt: g.exempt, mismatches: l.mismatches, filed };
}
