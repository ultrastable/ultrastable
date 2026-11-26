// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The spend report a Worker serves at GET /spend (US-25-R07, R10, R16): the probe over every tenant's own status, the worst case the budgets
// imply, and (when the host supplies a platform reading) the 20 percent cross-check. The route itself belongs to the Worker; this builds the
// body so any host answers the same thing. All figures are ESTIMATES from prices.js with their date; none is a bill.
import { probe } from './spend.js';
import { crossCheck, sumSelf } from './crosscheck.js';

// statuses: the `value` of each tenant's status() ({ tenantId, month, storageBytes }); budgets: each tenant's budget row; platform: { requests, reads,
// writes } from the platform's analytics or null; plan: 'free' (the deployed profile) or 'paid'.
export function spendReport({ statuses = [], budgets = null, ceilingUsd = 8, plan = 'free', now = () => new Date(), platform = null, overhead = {}, vectorize = null } = {}) {
  const t = now(), dayOfMonth = t.getUTCDate(), daysInMonth = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  const snapshots = statuses.map(s => ({ tenantId: s.tenantId, month: s.month, storageBytes: s.storageBytes, vectorMode: s.vectorMode }));
  const body = probe(snapshots, { ceilingUsd, dayOfMonth, daysInMonth, plan, budgets, vectorize });
  body.tenants = statuses.length;
  body.crossCheck = platform ? crossCheck({ self: sumSelf(statuses), platform, overhead }) : null;
  return body;
}
