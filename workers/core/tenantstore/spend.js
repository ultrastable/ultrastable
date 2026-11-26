// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Spend probe: turns tenant usage into an estimated monthly Cloudflare bill and a status. ESTIMATES from prices.js (list prices, as_of date),
// never a bill. Because every tenant is hard-capped by its BudgetGuard, the worst case is computable up front (worstCase), not just observed.
import { PRICES } from './prices.js';
export const prices = () => PRICES;

const over = (used, included, perMillion) => Math.max(0, used - included) / 1e6 * perMillion;

// usage: { reads, writes, requests, storageBytes, vecDims, gbSeconds } summed across tenants for one month. Durable Object SQLite pricing.
// plan 'paid' (the default, as before) charges the base and the overage; plan 'free' (the deployed profile) costs USD 0 because a spent
// budget refuses work instead of billing, and `paidEquivalentUsd` says what the same usage would cost on the paid plan (US-25-R17).
export function estimateMonth(usage, p = PRICES, { plan = 'paid' } = {}) {
  const d = p.do_sqlite;
  const parts = {
    base: p.workers_paid_base_month,
    rows_read: over(usage.reads || 0, d.rows_read.included_month, d.rows_read.per_million),
    rows_written: over(usage.writes || 0, d.rows_written.included_month, d.rows_written.per_million),
    requests: over(usage.requests || 0, d.requests.included_month, d.requests.per_million),
    storage: Math.max(0, (usage.storageBytes || 0) / 2 ** 30 - d.storage_gb_month.included) * d.storage_gb_month.per_gb,
    duration: over(usage.gbSeconds || 0, d.duration_gb_s.included_month, d.duration_gb_s.per_million),
    vectorize_queries: over(usage.vecDims || 0, p.vectorize.queried_dimensions.included_month, p.vectorize.queried_dimensions.per_million) * (usage.useVectorize ? 1 : 0),
  };
  const paidEquivalentUsd = Object.values(parts).reduce((a, b) => a + b, 0);
  return { parts, plan, total: plan === 'free' ? 0 : paidEquivalentUsd, paidEquivalentUsd, estimate: true, pricesAsOf: p.as_of };
}

// Worst case if every tenant spends its whole monthly budget (this is the hard bound, because the guard refuses past it).
// opts.vectorize: true when any tenant may query a Vectorize index (a VECTORIZE binding is configured, or a tenant is promoting). Without it the
// bound covers local-vector mode only, where vector search is rows read inside the tenant store and queried dimensions are not billed; with it the
// month's vecDims budgets are costed as Vectorize queried dimensions (US-25-R07, R09), which for the default budgets is far above the ceiling:
// see maxVecDimsMonth for the cap that keeps the Vectorize worst case under it.
export function worstCase(tenantBudgets, p = PRICES, opts = {}) {
  const sum = (f) => tenantBudgets.reduce((a, b) => a + (b.month[f] || 0), 0);
  const vectorize = !!opts.vectorize;
  const est = estimateMonth({ reads: sum('reads'), writes: sum('writes'), requests: sum('requests'), vecDims: sum('vecDims'), useVectorize: vectorize, storageBytes: tenantBudgets.reduce((a, b) => a + (b.maxStorageBytes || 0), 0) }, p, opts);
  return { ...est, vectorize };
}

// The monthly vecDims budget each of `tenants` tenants may hold so that the Vectorize worst case stays inside ceilingUsd, given the other parts
// of the worst case of `budgets` (the headroom left under the ceiling, spent on queried dimensions beyond the included allowance).
export function maxVecDimsMonth(budgets, { ceilingUsd = 8, p = PRICES, plan = 'paid' } = {}) {
  const rest = worstCase(budgets.map(b => ({ ...b, month: { ...b.month, vecDims: 0 } })), p, { plan, vectorize: false }).paidEquivalentUsd;
  const q = p.vectorize.queried_dimensions, headroom = Math.max(0, ceilingUsd - rest);
  const total = q.included_month + headroom / q.per_million * 1e6;
  return Math.floor(total / Math.max(1, budgets.length));
}

// snapshots: [{ tenantId, month: {reads,writes,requests,vec_dims}, storageBytes }]; ceiling: USD per month the owner accepts.
// budgets (optional): each tenant's budget row, so the probe also states the worst case the budgets imply (TS-7). plan as for estimateMonth.
export function probe(snapshots, { ceilingUsd = 8, dayOfMonth, daysInMonth = 30, p = PRICES, plan = 'paid', budgets = null, vectorize = null } = {}) {
  // Vectorize is costed when the host says a binding exists, or any tenant reports a mode other than local (promoting or vectorize).
  const useVectorize = vectorize !== null ? !!vectorize : snapshots.some(s => s.vectorMode && s.vectorMode !== 'local');
  const tot = snapshots.reduce((a, s) => ({ reads: a.reads + s.month.reads, writes: a.writes + s.month.writes, requests: a.requests + s.month.requests, vecDims: a.vecDims + (s.month.vec_dims || 0), storageBytes: a.storageBytes + (s.storageBytes || 0), gbSeconds: a.gbSeconds + (s.gbSeconds || 0) }), { reads: 0, writes: 0, requests: 0, vecDims: 0, storageBytes: 0, gbSeconds: 0 });
  const f = daysInMonth / Math.max(1, dayOfMonth || daysInMonth);
  const projected = estimateMonth({ reads: tot.reads * f, writes: tot.writes * f, requests: tot.requests * f, vecDims: tot.vecDims * f, storageBytes: tot.storageBytes, gbSeconds: tot.gbSeconds * f, useVectorize }, p, { plan });
  const status = projected.total > ceilingUsd ? 'breach' : projected.total > ceilingUsd * 0.8 ? 'warn' : 'ok';
  const top = [...snapshots].sort((a, b) => b.month.reads - a.month.reads).slice(0, 3).map(s => s.tenantId);
  const wc = budgets && budgets.length ? worstCase(budgets, p, { plan, vectorize: useVectorize }) : null;
  return { status, plan, ceilingUsd, vectorize: useVectorize, projectedUsd: Number(projected.total.toFixed(2)), paidEquivalentUsd: Number(projected.paidEquivalentUsd.toFixed(2)), parts: projected.parts, topReaders: top,
    worstCase: wc ? { totalUsd: Number(wc.total.toFixed(2)), paidEquivalentUsd: Number(wc.paidEquivalentUsd.toFixed(2)), plan, vectorize: useVectorize } : null, estimate: true, pricesAsOf: p.as_of };
}
