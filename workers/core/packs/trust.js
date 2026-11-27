// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Earned trust for packs (US-21-R29, R12, R22). A pack's outcomes are recorded on the surface `pack:<id>` with the action class
// equal to the kind of action, exactly where the guard reads its rung. core/trust turns outcomes into a proposed rung change;
// a different agent's merge applies it (US-06-R05, R06). The rung a pack acts at is then
//     min(rung earned, class ceiling (guard.js rungCeilings), ceiling of the policy surface the class maps to)
// so the stricter of the class ceiling and the protected policy always wins (US-00-R08, US-06-R04).
import { all, first, run, iso } from '../kernel/util.js';
import { recordEvent, recompute, applyRungChange, settings, ceilingFor } from '../trust/index.js';

// How a pack outcome is recorded: the outcome row feeds reliability, the event adjusts the score with a stated weight.
export const OUTCOMES = {
  verified:       { result: 'verified',       event: 'verified_autonomous_action' },
  failed:         { result: 'failed',         event: null },
  removed:        { result: 'hidden_failure', event: 'hidden_failure' },   // a post that disappeared after it was verified
  complaint:      { result: 'hidden_failure', event: 'hidden_failure' },   // a recipient marked the message unwanted
  hidden_failure: { result: 'hidden_failure', event: 'hidden_failure' },
  silent_drop:    { result: 'silent_drop',    event: 'silent_drop' },      // a queued item left without a disposition
};

// The policy surface each pack class is bounded by. Class B maps to `outreach` (max_permission propose in autonomy/policy.json),
// which is why a class B pack stays below the act rung until a reviewed change to that policy raises it.
export const DEFAULT_POLICY_SURFACE = { A: 'work_tracker', B: 'outreach', C: 'work_tracker', D: 'runtime' };

// A copy of the policy with a `pack:<id>` surface for every pack: the mapped surface's permission and start rung. The host passes this
// to the trust step it already runs, or calls refresh() below.
export function policyWithPacks(policy, packs, map = DEFAULT_POLICY_SURFACE) {
  const out = JSON.parse(JSON.stringify(policy));
  out.surfaces = out.surfaces || {};
  for (const p of packs) {
    const src = out.surfaces[map[p.class]] || {};
    out.surfaces[`pack:${p.id}`] = { doc: `pack ${p.id} (class ${p.class}), bounded by policy surface ${map[p.class]}`, max_permission: src.max_permission || 'none', start_rung: 'observed', actions: {} };
  }
  return out;
}

export function createPackTrust({ db, now = Date.now, policy = null, config = {} } = {}) {
  const map = { ...DEFAULT_POLICY_SURFACE, ...(config.pack_policy_surface || {}) };
  const registered = () => all(db, `SELECT id, class FROM packs_registry ORDER BY id`);

  // One recorded outcome for a pack. Unknown events are refused: the mapping above is stated, not invented.
  async function outcome({ pack, kind = 'send', event, ref = null } = {}) {
    const o = OUTCOMES[event];
    if (!pack || !o) return { ok: false, reason: 'unknown_outcome' };
    const surface = `pack:${pack}`;
    await run(db, `INSERT INTO outcomes (item_id, agent, surface, action_class, result, evidence, at) VALUES (?,?,?,?,?,?,?)`,
      ref, null, surface, kind, o.result, event, iso(now()).replace('T', ' ').slice(0, 19));
    // The weighted event needs core/trust's own table; a host that has not applied that migration still gets the outcome row.
    const hasEvents = !!(await first(db, `SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'trust_events'`));
    if (o.event && hasEvents) await recordEvent(db, { surface, action_class: kind, event: o.event, ref }, { now: now(), policy: policy || undefined });
    return { ok: true, surface, kind, result: o.result, event_recorded: !!(o.event && hasEvents) };
  }

  // Recompute the scores with the pack surfaces on the policy. Records a proposed ladder transition (and its item) when a threshold
  // is crossed; it never changes a rung. Returns the rows for pack surfaces only.
  async function refresh() {
    if (!policy) return { ok: false, reason: 'policy_required', rows: [] };
    const packs = await registered();
    const rows = await recompute(db, { policy: policyWithPacks(policy, packs, map), config, now: now() });
    return { ok: true, rows: rows.filter(r => String(r.surface).startsWith('pack:')) };
  }

  // The merge of a reviewed ladder change for one item: refused unless merged_by differs from the agent that opened it (US-06-R06).
  async function apply(item_id, merged_by) {
    if (!policy) return { applied: false, reason: 'policy_required' };
    const t = await first(db, `SELECT surface FROM trust_transitions WHERE item_id = ? ORDER BY id DESC LIMIT 1`, item_id);
    if (!t || !String(t.surface).startsWith('pack:')) return { applied: false, reason: 'not_a_pack_transition' };
    const r = await applyRungChange(db, { item_id, merged_by, policy: policyWithPacks(policy, await registered(), map), now: now() });
    // The merge closes the ladder item with its disposition, so a later crossing in the other direction opens a fresh one.
    if (r.applied) await run(db, `UPDATE items SET status = 'done', disposition = ?, updated_at = ? WHERE id = ? AND status NOT IN ('done','superseded','cancelled')`, `ladder change applied by ${merged_by}`, iso(now()), item_id);
    return r;
  }

  // The ceiling a pack's class is held to by the policy (for display and tests).
  async function policyCeiling(packId) {
    if (!policy) return null;
    const r = (await registered()).find(p => p.id === packId);
    return r ? ceilingFor(policyWithPacks(policy, [r], map), `pack:${packId}`, settings(policy, config)) : null;
  }

  return { outcome, refresh, apply, policyCeiling };
}
