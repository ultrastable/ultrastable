// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Per-tenant read/write budgets with enforcement. Cloudflare has no native spend cap, so the cap is ours:
// every statement is metered in the tenant's own store (same transaction domain, no cross-store race) and
// refused once a day or month limit is spent. Portable: it only needs the SqlPort (see store.js).

export class BudgetError extends Error {
  constructor(limit, period, used, max, resetsAt) {
    super(`budget_exceeded:${limit}:${period}`);
    this.code = 'budget_exceeded'; this.limit = limit; this.period = period; this.used = used; this.max = max; this.resetsAt = resetsAt;
  }
}

// Two profiles. FREE fits five tenants inside the Workers Free plan's account-wide Durable Object limits (100,000 requests,
// 100,000 rows written and 5,000,000 rows read per day) in the worst case worstCaseDay computes, not only at the budget; PAID fits
// the Workers Paid inclusions. A tenant raises its cap only through a reviewed change to its budget row, never at runtime.
export const FREE_PLAN_BUDGET = Object.freeze({
  day:   { reads: 800_000, writes: 15_000, requests: 15_000, vecDims: 100_000_000 },
  month: { reads: 24_800_000, writes: 465_000, requests: 465_000, vecDims: 3_100_000_000 },
  perQueryReads: 50_000,   // one statement may not read more rows than this (stops scans)
  perQueryWrites: 3_000,   // and may not write more than this: under a third of a day's writes, small enough that five tenants' worst case fits (US-25-R02, R15)
  maxStorageBytes: 200_000_000,
  maxVectors: 20_000,
  warnAt: 0.8,
});
export const PAID_PLAN_BUDGET = Object.freeze({
  day:   { reads: 20_000_000, writes: 200_000, requests: 200_000, vecDims: 400_000_000 },
  month: { reads: 400_000_000, writes: 3_000_000, requests: 3_000_000, vecDims: 4_000_000_000 },
  perQueryReads: 50_000,
  perQueryWrites: 66_666,  // derived: day.writes / 3
  maxStorageBytes: 1_073_741_824,
  maxVectors: 20_000,
  warnAt: 0.8,
});
export const DEFAULT_BUDGET = FREE_PLAN_BUDGET;

const FIELDS = { reads: 'reads', writes: 'writes', requests: 'requests', vecDims: 'vec_dims' };

// The most one tenant can cost the platform in a day under its budget (US-25-R02, R21), for a caller that stops at the first refusal: the budget
// itself, one statement past what is left (a statement is checked before it runs, so it may overshoot by its own size: perQueryWrites rows written,
// and at most 2 x perQueryReads rows read, since a Durable Object cursor is only cut off after it passed the cap), count-triggered metering
// flushes (flushRows rows each flushEvery operations), the first refusal (one request), and a single late alarm once the day's budget is gone
// (its request, its setAlarm row and its flush rows). Every other alarm is charged to the tenant's own budget (chargeAlarm, chargeFlush), so it is inside; a refusal arms no alarm and
// writes no row. It holds when a refused statement stops at its caps: a scanning write on the Durable Object adapter runs to completion before the
// caps are read, which this bound does not cover (US-SPEC-25 section 5, PLANNED).
export function worstCaseDay(budget = DEFAULT_BUDGET, { flushEvery = 25, flushRows = 2 } = {}) {
  const d = budget.day;
  const countFlushes = Math.ceil((d.requests + 1) / flushEvery);
  return {
    reads: d.reads + 2 * budget.perQueryReads,
    writes: d.writes + budget.perQueryWrites + flushRows * countFlushes + 1 + flushRows,
    requests: d.requests + 1 + 1,
  };
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS _budget (period TEXT PRIMARY KEY, reads INTEGER NOT NULL DEFAULT 0, writes INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0, vec_dims INTEGER NOT NULL DEFAULT 0, denied INTEGER NOT NULL DEFAULT 0);
`;

const dayKey = (d) => 'd:' + d.toISOString().slice(0, 10);
const monthKey = (d) => 'm:' + d.toISOString().slice(0, 7);
const nextDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
const nextMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();

export class BudgetGuard {
  constructor(sql, { budget = DEFAULT_BUDGET, now = () => new Date(), flushEvery = 25 } = {}) {
    // dirty: periods whose usage changed (written by count and by the alarm); denyDirty: periods whose only change is a refusal count, written
    // with the next flush of any kind and never the cause of one, so a refused call costs no alarm and no row (US-25-R21, R02).
    this.mem = new Map(); this.dirty = new Set(); this.denyDirty = new Set(); this.pending = 0; this.flushEvery = flushEvery;
    this.sql = sql; this.budget = { ...DEFAULT_BUDGET, ...budget, day: { ...DEFAULT_BUDGET.day, ...budget.day }, month: { ...DEFAULT_BUDGET.month, ...budget.month } };
    // A tenant's own day.writes sets its statement write cap unless it states one (a third of a day's writes, US-25-R15).
    if (budget.perQueryWrites === undefined && budget.day && budget.day.writes !== undefined) this.budget.perQueryWrites = Math.max(1, Math.floor(budget.day.writes / 3));
    this.halted = null; this.storageBytes = null;     // set by the store: a halt reason (US-25-R13) and a () => bytes reader (US-25-R15)
    this.now = now; this.sql.exec(SCHEMA);
  }
  // Usage is held in memory (a Durable Object is single-threaded and authoritative while alive) and flushed to the _budget table every
  // flushEvery operations, so metering does not itself burn the plan's rows-written allowance. A crash loses at most flushEvery operations.
  // An object the platform evicts is not a crash: the host calls flush() (the Durable Object adapter arms an alarm after the first unflushed
  // operation of a burst, US-25-R21), so usage survives an eviction and a new object over the same storage reloads it.
  hasUnflushed() { return this.dirty.size > 0; }
  _row(period) {
    if (!this.mem.has(period)) this.mem.set(period, { ...(this.sql.exec('SELECT * FROM _budget WHERE period=?', [period]).rows[0] || { period, reads: 0, writes: 0, requests: 0, vec_dims: 0, denied: 0 }) });
    return this.mem.get(period);
  }
  usage() { const t = this.now(); return { day: this._row(dayKey(t)), month: this._row(monthKey(t)) }; }
  check() {
    if (this.halted) { const e = new Error(`tenant_halted:${this.halted}`); e.code = 'tenant_halted'; e.reason = this.halted; throw e; }
    const t = this.now(), u = this.usage();
    for (const [scope, key, resets] of [['day', dayKey(t), nextDay(t)], ['month', monthKey(t), nextMonth(t)]]) {
      for (const [name, col] of Object.entries(FIELDS)) {
        const used = u[scope][col], max = this.budget[scope][name];
        if (used >= max) { this._deny(key); throw new BudgetError(name, scope, used, max, resets); }
      }
    }
  }
  // The same gate for anything that writes (a statement, a vector, a rollup): the budget, then the storage ceiling. Deleting is not gated
  // by storage, because deleting is how a full store gets back under the ceiling.
  checkWrite() {
    this.check();
    if (this.storageBytes) {
      const used = this.storageBytes(), max = this.budget.maxStorageBytes;
      if (used >= max) { const t = this.now(); this._deny(dayKey(t)); throw new BudgetError('storage', 'total', used, max, null); }
    }
  }
  record({ reads = 0, writes = 0, requests = 1, vecDims = 0 }) {
    const u = this.usage();
    for (const r of [u.day, u.month]) { r.reads += reads; r.writes += writes; r.requests += requests; r.vec_dims += vecDims; this.dirty.add(r.period); }
    if (++this.pending >= this.flushEvery) this.flush();
    return this.warn();
  }
  // US-25-R21: an alarm flush is a platform request and writes one row per dirty period. It is charged to the tenant's own day and month (the
  // rows it writes include these counters), so the alarm costs nothing outside the budget. Returns the rows charged.
  chargeFlush() {
    if (!this.dirty.size) return 0;
    const u = this.usage();
    for (const r of [u.day, u.month]) this.dirty.add(r.period);
    const rows = this.dirty.size;
    for (const r of [u.day, u.month]) { r.writes += rows; r.requests += 1; }
    return rows;
  }
  // Arming an alarm is itself billed as one row written (Cloudflare Durable Objects pricing: each setAlarm() is a row written), so the adapter
  // charges it to the tenant's own day and month when it arms one. Returns the rows charged.
  chargeAlarm() {
    const u = this.usage();
    for (const r of [u.day, u.month]) { r.writes += 1; this.dirty.add(r.period); }
    return 1;
  }
  flush() {
    for (const period of new Set([...this.dirty, ...this.denyDirty])) {
      const r = this.mem.get(period);
      this.sql.exec('INSERT OR REPLACE INTO _budget(period,reads,writes,requests,vec_dims,denied) VALUES(?,?,?,?,?,?)', [period, r.reads, r.writes, r.requests, r.vec_dims, r.denied]);
    }
    this.dirty.clear(); this.denyDirty.clear(); this.pending = 0;
  }
  warn() {
    const u = this.usage(), w = this.budget.warnAt; let hot = false;
    for (const scope of ['day', 'month']) for (const [name, col] of Object.entries(FIELDS)) if (u[scope][col] >= this.budget[scope][name] * w) hot = true;
    return hot;
  }
  // A refusal is counted in memory only. It does not make the guard dirty (no alarm is armed for it, US-25-R21) and does not count toward a flush
  // by count, so a caller that retries past a spent budget costs one platform request per call and no row; the counts are written with the next
  // flush, and an eviction before one loses only refusal counts, never usage.
  _deny(key) { this._row(key).denied += 1; this.denyDirty.add(key); }
  snapshot() { const u = this.usage(); return { day: u.day, month: u.month, budget: { day: this.budget.day, month: this.budget.month } }; }
}
