// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// SLA-1: one written service level for every PR, enforced by the tick Worker sweeper every tick (data: doctrine/sla.json, mirrored here as defaults).
// Pure decision: given a PR's age, idle time, state and branch, return the escalation tier. No I/O.
export const SLA = { pr: { green_merge_min: 3, act_min: 15, hard_min: 60, idle_min: 30 }, issue: { p0_days: 2, p1_days: 7, default_days: 14 } };
const BOT_PREFIX = ['claude/', 'agent/', 'worker/', 'parked/'];
// tier: ok | act | supersede. A PR that is merge-ready (clean) is never superseded; the sweeper merges it. Anything else past hard_min and idle for idle_min is superseded.
export function prTier({ ageMin, idleMin, state, branch }, sla = SLA.pr) {
  if (!BOT_PREFIX.some(p => String(branch || '').startsWith(p))) return 'ok';
  if (state === 'clean') return 'ok';
  // PR-NEVER-LOSE-1: only a real conflict or a failing check is superseded. An unknown or empty state (GitHub still computing it), a branch that is only behind, and a PR
  // that is mergeable are never closed on this clock; sweeper.js also re-reads the PR live before it closes.
  if (!['dirty', 'blocked', 'unstable'].includes(String(state || '').toLowerCase())) return 'ok';
  if (ageMin > sla.hard_min && idleMin > sla.idle_min) return 'supersede';
  if (ageMin > sla.act_min) return 'act';
  return 'ok';
}
export const portItemId = branch => 'PORT-BRANCH-' + String(branch).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
