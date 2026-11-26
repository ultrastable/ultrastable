// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// TS-10: self-metered usage against the platform's own analytics. A divergence over the tolerance (default 20 percent) is a
// finding, and a metric the platform did not report is unmeasured, never a match. Pure: the caller fetches the analytics.
export function crossCheck(self, platform, { tolerance = 0.2 } = {}) {
  const findings = [];
  for (const [metric, mine] of Object.entries(self || {})) {
    const theirs = platform ? platform[metric] : undefined;
    if (typeof theirs !== 'number' || !Number.isFinite(theirs)) { findings.push({ metric, kind: 'unmeasured', self: mine }); continue; }
    const base = Math.max(Math.abs(mine), Math.abs(theirs));
    const divergence = base === 0 ? 0 : Math.abs(mine - theirs) / base;
    if (divergence > tolerance) findings.push({ metric, kind: 'divergence', self: mine, platform: theirs, divergence });
  }
  return { ok: findings.length === 0, findings };
}
