// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Guard against inverted guards (US-SPEC-09 section 4, US-24-R53): a cost guard or routing change is installed only after the
// resolved upstream of the path it guards has been observed, and it is refused when that target is dearer than the status quo.
// The resolved upstream is what the provider reported it served (router_upstream), not the model constant in the configuration.
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const msOf = v => (typeof v === 'function' ? msOf(v()) : v instanceof Date ? v.getTime() : Number(v));

/** Price of one model id across the configuration: dollars per 1k tokens in plus out; null when no provider lists it. */
export function unitCost(config, modelId) {
  for (const p of Object.values(config.providers || {})) for (const m of Object.values(p.models || {})) {
    if (m.id === modelId) return (m.usd_per_1k_in || 0) + (m.usd_per_1k_out || 0);
  }
  return null;
}
const latestResolved = async (db, requested) => (await db.prepare(`SELECT resolved FROM router_upstream WHERE requested = ? ORDER BY id DESC LIMIT 1`).bind(requested).first())?.resolved ?? null;

/** Requested and resolved model ids that differ, newest first: where an alias or gateway indirection is hiding a different model. */
export async function mismatches(db, limit = 50) {
  return (await db.prepare(`SELECT requested, resolved, COUNT(*) AS calls, MAX(at) AS last_at FROM router_upstream WHERE requested <> resolved GROUP BY requested, resolved ORDER BY last_at DESC LIMIT ?`).bind(limit).all()).results || [];
}

/**
 * { ok, reason?, guard, status_quo }. `guard.model` is the configured model the new path routes to, `status_quo.model` the one it
 * replaces. Refused when either has no observed resolved upstream ('resolved_upstream_unprobed') or when the guard's resolved
 * target costs more than the status quo's ('target_dearer_than_status_quo'). The price of each resolved id is looked up in the configuration; a resolved id the configuration does not list is a refusal too ('price_unknown_for_resolved').
 */
export async function guardAllowed({ db, config, guard, status_quo }) {
  const g = await latestResolved(db, guard.model), s = await latestResolved(db, status_quo.model);
  if (!g || !s) return { ok: false, reason: 'resolved_upstream_unprobed', guard: { model: guard.model, resolved: g }, status_quo: { model: status_quo.model, resolved: s } };
  // The price is the price of what was observed serving, never of the model that was asked for: an alias that resolves to a model
  // the configuration does not list is exactly the case this guard exists for, so an unlisted resolved id is a refusal.
  const gc = unitCost(config, g), sc = unitCost(config, s);
  if (gc == null || sc == null) return { ok: false, reason: 'price_unknown_for_resolved', guard: { model: guard.model, resolved: g, unit_cost: gc }, status_quo: { model: status_quo.model, resolved: s, unit_cost: sc } };
  const ok = gc <= sc;
  return { ok, reason: ok ? undefined : 'target_dearer_than_status_quo', guard: { model: guard.model, resolved: g, unit_cost: gc }, status_quo: { model: status_quo.model, resolved: s, unit_cost: sc } };
}

/** Record the probe of a cost change on the real path; a change is kept only when its guard is allowed. */
export async function costChangeProbe({ db, now = Date.now, config, change }) {
  const r = await guardAllowed({ db, config, guard: { model: change.model }, status_quo: { model: change.status_quo } });
  await db.prepare(`INSERT INTO router_cost_probes (at, change_name, requested, resolved, unit_cost, status_quo_unit_cost, kept, reason) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(iso(msOf(now)), change.name, change.model, r.guard.resolved ?? null, r.guard.unit_cost ?? null, r.status_quo.unit_cost ?? null, r.ok ? 1 : 0, r.reason ?? null).run();
  return { kept: r.ok, ...r };
}
