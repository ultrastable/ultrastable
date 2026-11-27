// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Cross-check of self-metered usage against the platform's own analytics (TS-10, US-25-R10). The store meters itself; the platform bills from
// its own counters; a divergence over `threshold` (default 20 percent) is a finding, because either the metering or the platform reading is
// wrong and a bound that rests on wrong metering is not a bound. Pure: the caller supplies both readings.
//   self      { requests, reads, writes } summed from store.status().month across tenants
//   platform  the same meters from the platform (any may be null: not measured)
//   overhead  usage the store causes that its own metering declares exempt (the hourly self-test, budget flushes), added to self before comparing
// A meter the platform did not report is `unmeasured`, never zero and never a finding: an empty reading proves nothing (BLINDSPOT-RED-1).
export const METERS = ['requests', 'reads', 'writes'];

export function crossCheck({ self = {}, platform = {}, threshold = 0.2, overhead = {} } = {}) {
  const findings = [], unmeasured = [], compared = [];
  for (const meter of METERS) {
    const p = platform[meter];
    if (p === null || p === undefined || !Number.isFinite(p)) { unmeasured.push(meter); continue; }
    const mine = (Number(self[meter]) || 0) + (Number(overhead[meter]) || 0);
    const divergence = Math.abs(mine - p) / Math.max(p, 1);
    compared.push({ meter, self: mine, platform: p, divergence: Number(divergence.toFixed(4)) });
    if (divergence > threshold) findings.push({ meter, self: mine, platform: p, divergence: Number(divergence.toFixed(4)), threshold });
  }
  return { ok: findings.length === 0 && unmeasured.length < METERS.length, findings, unmeasured, compared, threshold };
}

// Sums store.status().month over tenants into the `self` shape.
export const sumSelf = (statuses) => statuses.reduce((a, s) => ({ requests: a.requests + (s.month?.requests || 0), reads: a.reads + (s.month?.reads || 0), writes: a.writes + (s.month?.writes || 0) }), { requests: 0, reads: 0, writes: 0 });
