// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Which tick steps run under the cost, free-tier and spend levels (FREE-TIER-1, SPEND-SOFT-1). Pure; imported by tick.js.
import { dueEvery } from './spend.js';

export const FREE_TIER_WIDE_STEPS = ['probe_gates', 'score_predictions', 'accrue_trust', 'selfaudit', 'pulse', 'ignition', 'check_plus_share', 'goals', 'age_sla', 'cost_probe'];  // FREE-TIER-1
export const COST_ESSENTIAL_STEPS = ['migrate', 'reconcile', 'measure', 'criticality'];
// SPEND-SOFT-1 (Rowan, 2026-11-21: "systems should never have hard stops"), ported from ultrastable/ultrastable: no step is skipped for good. Under
// lean (a cost breach or the free tier at shed) or spend crawl the other steps still run on the first tick of every few hours; under degrade or
// spend throttle the wide readers run once an hour. Spend crawl keeps the queue moving every tick: reap_claims, dispatch and execute are the work.
// The model in scripts/verify.py (VERIFY-1) checks that every essential step is kept at every spend level.
export const SPEND_KEEP_STEPS = [...COST_ESSENTIAL_STEPS, 'reap_claims', 'dispatch', 'execute'];
export const LEAN_EVERY_H = 3;
// Pure: what a tick does with one step given the levels. 'run' or 'defer' (a deferred step counts as completed: a decision, not a failure).
export function stepPlan(name, { lean = false, degrade = false, spend = null, now = Date.now() } = {}) {
  const sl = spend && spend.level, k = (spend && spend.knobs) || {};
  if (lean && !COST_ESSENTIAL_STEPS.includes(name)) return dueEvery(LEAN_EVERY_H, now) ? 'run' : 'defer';
  if (sl === 'crawl' && !SPEND_KEEP_STEPS.includes(name)) return dueEvery(k.extra_every_h || LEAN_EVERY_H, now) ? 'run' : 'defer';
  if ((degrade || sl === 'throttle' || sl === 'crawl') && FREE_TIER_WIDE_STEPS.includes(name)) return dueEvery(Math.max(1, k.wide_every_h || 1), now) ? 'run' : 'defer';
  return 'run';
}
