// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// workers/core/tenantstore/ (spec: US-SPEC-25). TenantStore: the one door to a tenant's data. SqlPort contract (every adapter implements it):
//   sql.exec(text, params[], limits?) -> { rows: object[], rowsRead: number, rowsWritten: number }
//   optional: sql.storageBytes() -> number (the store's size, read by the storage ceiling, US-25-R15)
//   optional limits { maxRowsRead, maxRowsWritten }: an adapter that can roll a write back refuses a statement that crosses them by
//   throwing an error with code 'statement_too_wide' and rowsRead, rowsWritten set, having undone the statement; an adapter that cannot
//   ignores limits and the store still refuses and charges after the fact.
// The tenant's store is private to the tenant (one Durable Object, one SQLite file, one D1 database, one Postgres schema),
// which is the sandbox; the guard meters it; hot reads can be served from a cache port and survive a spent budget.
//
// What the store issues itself (US-25-R14): every statement it issues for a caller is metered. Five store-issued statements are exempt by
// a stated constant, because metering them would make a spent budget unobservable or burn the allowance it protects: the tenant pin and
// halt rows (PIN_ROWS, written once per store lifetime and once per halt), the budget flush (2 rows per flushEvery operations), the first
// load of a period's budget row (1 row per period), the load of the two vector-state rows when a store object starts, and status()
// (STATUS_READ_ROWS in vector.js). Promotion's own writes (the mode and stored-count rows, the counter update) are metered (vectorport.js).
import { BudgetGuard, BudgetError, DEFAULT_BUDGET } from './budget.js';
import { VectorIndex } from './vector.js';
import { Rollups } from './rollup.js';
import { TenantVectors } from './vectorport.js';
import { isWriteStatement, freesSpace, isMultiStatement } from './sqlclass.js';

export const PIN_ROWS = 1;
const TENANT_SCHEMA = `CREATE TABLE IF NOT EXISTS _tenant (k TEXT PRIMARY KEY, v TEXT NOT NULL);`;
const coded = (code, msg, extra = {}) => Object.assign(new Error(msg || code), { code }, extra);

export class TenantStore {
  // vectorize: an optional Vectorize-shaped binding (vectorport.js); with it, vectors past maxVectors are promoted instead of failing (US-25-R09).
  constructor({ tenantId, sql, budget = DEFAULT_BUDGET, now = () => new Date(), cache = null, vectorize = null }) {
    if (!tenantId) throw new Error('tenantId required');
    this.tenantId = tenantId; this.sql = sql; this.cache = cache;
    // US-25-R12: the store pins the first tenant id it serves, inside its own storage, so a second id (or a new object over the same
    // storage) can neither use this tenant's budget nor read its data under another name.
    sql.exec(TENANT_SCHEMA);
    sql.exec(`INSERT OR IGNORE INTO _tenant(k, v) VALUES('id', ?)`, [tenantId]);
    const pinned = sql.exec(`SELECT v FROM _tenant WHERE k = 'id'`).rows[0].v;
    if (pinned !== tenantId) throw coded('tenant_mismatch', 'tenant_mismatch');
    this.guard = new BudgetGuard(sql, { budget, now });
    this.guard.storageBytes = typeof sql.storageBytes === 'function' ? () => sql.storageBytes() : null;
    const h = sql.exec(`SELECT v FROM _tenant WHERE k = 'halt'`).rows[0];
    this.guard.halted = h ? h.v : null;       // held in memory: an object is single-threaded and authoritative while alive
    this.vectors = new VectorIndex(sql, this.guard);
    this.rollups = new Rollups(sql, this.guard, now);
    this.tv = new TenantVectors({ store: this, binding: vectorize });   // the async facade over vectors: local, promoting, or promoted
  }
  // US-25-R13: an independent per-tenant halt. Every read, write, vector and rollup refuses with tenant_halted until resume().
  halt(reason = 'halted') {
    const why = String(reason || 'halted').slice(0, 200);
    this.sql.exec(`INSERT OR REPLACE INTO _tenant(k, v) VALUES('halt', ?)`, [why]);
    this.guard.halted = why;
    return { halted: true, reason: why };
  }
  resume() {
    this.sql.exec(`DELETE FROM _tenant WHERE k = 'halt'`);
    this.guard.halted = null;
    return { halted: false };
  }
  // Metered statement. Refuses when the budget is spent, when a read statement read more rows than perQueryReads (a scan), when a write
  // statement scanned more than perQueryReads or wrote more than perQueryWrites (rolled back where the adapter can), and when a write
  // would grow a store already at its storage ceiling. A refused statement is charged for the rows it touched (TS-3).
  query(text, params = []) {
    // One statement per call (US-25-R03): a second statement after a ';' would run outside the classification below. Refused before it runs,
    // after the halt and the budget, and charged as one request.
    if (isMultiStatement(text)) { this.guard.check(); this.guard.record({}); throw coded('multiple_statements'); }
    const write = isWriteStatement(text);        // a WITH ... INSERT is a write (sqlclass.js), so the ceiling and the write cap apply to it
    if (write && !freesSpace(text)) this.guard.checkWrite(); else this.guard.check();
    const b = this.guard.budget;
    let r;
    try { r = this.sql.exec(text, params, write ? { maxRowsRead: b.perQueryReads, maxRowsWritten: b.perQueryWrites } : undefined); }
    catch (e) {
      if (e && e.code === 'statement_too_wide') {
        this.guard.record({ reads: e.rowsRead || 0, writes: e.rowsWritten || 0 });
        throw coded(e.rowsWritten > b.perQueryWrites && !(e.rowsRead > b.perQueryReads) ? 'write_too_wide' : 'query_too_wide', undefined, { rowsRead: e.rowsRead, rowsWritten: e.rowsWritten });
      }
      throw e;
    }
    const hot = this.guard.record({ reads: r.rowsRead, writes: r.rowsWritten });
    if (r.rowsRead > b.perQueryReads) throw coded('query_too_wide', undefined, { rowsRead: r.rowsRead });
    if (write && b.perQueryWrites && r.rowsWritten > b.perQueryWrites) throw coded('write_too_wide', undefined, { rowsWritten: r.rowsWritten });
    return { rows: r.rows, rowsRead: r.rowsRead, rowsWritten: r.rowsWritten, hot };
  }
  // Hot read: serve from cache; recompute on miss; if the budget is spent, serve the stale value instead of failing.
  async cached(key, ttlSec, compute) {
    const k = `t:${this.tenantId}:${key}`;
    const hit = this.cache ? await this.cache.get(k) : null;
    if (hit && JSON.parse(hit).exp > Date.now()) return JSON.parse(hit).v;
    try {
      const v = await compute(this);
      if (this.cache) await this.cache.put(k, JSON.stringify({ v, exp: Date.now() + ttlSec * 1000 }), { expirationTtl: Math.max(60, ttlSec * 10) });
      return v;
    } catch (e) {
      if (e instanceof BudgetError && hit) return JSON.parse(hit).v;
      throw e;
    }
  }
  // US-25-R21: write the in-memory metering to the store now. A host calls this before it lets an object go (the Durable Object adapter does,
  // from an alarm), so usage is not lost when an object is evicted rather than crashed.
  flush() { this.guard.flush(); return { flushed: true }; }
  status() { return { tenantId: this.tenantId, ...this.guard.snapshot(), vectors: this.vectors.count(), vectorMode: this.tv.mode(), halted: this.guard.halted }; }
}
export { BudgetError, DEFAULT_BUDGET };
