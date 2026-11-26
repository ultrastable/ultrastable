// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Cloudflare adapter for the tenant store: one SQLite-backed Durable Object per tenant (the sandbox), addressed by tenant id.
// Cloudflare-only imports live here, never in core/. The DO reports rowsRead/rowsWritten per cursor, which feeds the BudgetGuard.
// STATUS: tested against a fake ctx.storage.sql in core/tenantstore/tenantstore.test.js and adapters/cloudflare/src/tenant-do.test.js;
// deployed as ultrastable-tenants from the vendored copy tenants/src/tenant-do.js (ops/deploys.jsonl).
import { TenantStore, DEFAULT_BUDGET } from '../../../core/tenantstore/store.js';
import { isWriteStatement } from '../../../core/tenantstore/sqlclass.js';

// US-25-R21: how long after the first unflushed operation of a burst the object writes its metering (env TENANT_FLUSH_MS overrides). An object is
// evicted when idle, and eviction is not a crash: a flush before it keeps the daily bound a bound across lifetimes. Cost: one alarm and a two-row
// flush per burst, and none while nothing is unflushed.
export const FLUSH_DELAY_MS = 5000;

const stmtTooWide = (cur, rows) => Object.assign(new Error('statement_too_wide'), { code: 'statement_too_wide', rowsRead: cur.rowsRead ?? rows, rowsWritten: cur.rowsWritten ?? 0 });

// Wraps ctx.storage.sql. A SELECT is drained row by row and aborted once the cursor's rowsRead passes the per-query cap, so a runaway scan stops early.
// A write that carries limits ({ maxRowsRead, maxRowsWritten }) runs inside ctx.storage.transactionSync (extra.transactionSync): crossing a limit
// throws, which rolls the statement back, so a refused write changes nothing (US-25-R03, R15). storageBytes() is the database size.
export function doSqlPort(sqlStorage, perQueryReads = DEFAULT_BUDGET.perQueryReads, extra = {}) {
  const run = (text, params) => {
    const cur = sqlStorage.exec(text, ...params), rows = [];
    for (const r of cur) { rows.push(r); if (cur.rowsRead > perQueryReads * 2) break; } // hard stop; TenantStore then refuses and charges
    return { cur, rows };
  };
  return {
    storageBytes() { return sqlStorage.databaseSize; },
    exec(text, params = [], limits) {
      if (limits && extra.transactionSync && isWriteStatement(text)) {
        let out;
        extra.transactionSync(() => {
          const { cur, rows } = run(text, params);
          out = { rows, rowsRead: cur.rowsRead ?? rows.length, rowsWritten: cur.rowsWritten ?? 0 };
          if ((limits.maxRowsRead && out.rowsRead > limits.maxRowsRead) || (limits.maxRowsWritten && out.rowsWritten > limits.maxRowsWritten)) throw stmtTooWide(cur, rows.length);   // throwing inside transactionSync rolls the statement back
        });
        return out;
      }
      const { cur, rows } = run(text, params);
      return { rows, rowsRead: cur.rowsRead ?? rows.length, rowsWritten: cur.rowsWritten ?? 0 };
    },
  };
}

const err = (code, message) => Object.assign(new Error(message || code), { code });
const asData = (e) => ({ ok: false, error: { code: e.code || 'error', message: String(e.message || e), limit: e.limit, period: e.period, resetsAt: e.resetsAt } });

// Durable Object class, built on the platform's DurableObject base (passed in, so this file imports nothing Cloudflare-only and tests run in Node).
// RPC works only on a class that extends DurableObject, which is why the entry file calls makeTenantDO(DurableObject).
export const makeTenantDO = (Base) => class TenantDO extends Base {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx; this.env = env;
    this.budgetFor = env.TENANT_BUDGETS ? JSON.parse(env.TENANT_BUDGETS) : {};
  }
  // US-25-R12: one object serves one tenant. The id is compared with the object's own name (where the platform provides it), with the
  // id this object already serves, and the store pins it in its own storage, so a caller-controlled id can never pick another tenant's budget.
  store(tenantId) {
    const name = this.ctx.id && this.ctx.id.name;
    if (name && name !== tenantId) throw err('tenant_mismatch');
    if (this._store && this._store.tenantId !== tenantId) throw err('tenant_mismatch');
    if (!this._store) {
      const budget = this.budgetFor[tenantId] || DEFAULT_BUDGET;
      const tx = this.ctx.storage.transactionSync ? (fn) => this.ctx.storage.transactionSync(fn) : null;
      this._store = new TenantStore({ tenantId, sql: doSqlPort(this.ctx.storage.sql, budget.perQueryReads ?? DEFAULT_BUDGET.perQueryReads, { transactionSync: tx }), budget, cache: this.env.HOT_KV || null, vectorize: this.env.VECTORIZE || null });
    }
    return this._store;
  }
  // RPC methods (Workers RPC): the caller never gets raw SQL access across tenants because it can only reach its own stub.
  // Errors become data ({ error: { code, ... } }) because a thrown custom error loses its fields across the RPC boundary.
  // HALT=1 (HALT-1: nothing is exempt) refuses everything except status, which must stay readable.
  _do(tenantId, fn, { readOnlyStatus = false } = {}) {
    try {
      if (!readOnlyStatus && this.env.HALT === '1') throw err('tenant_halted', 'tenant_halted:HALT=1');
      const value = fn(this.store(tenantId));
      this._armFlush();
      return { ok: true, value };
    } catch (e) { this._armFlush(); return asData(e); }
  }
  // US-25-R21: arm one alarm when metering is unflushed and none is armed. A failure to arm is recorded (flushError, shown by status), never thrown into the request.
  _armFlush() {
    const st = this._store, storage = this.ctx.storage;
    if (!st || this._alarmArmed || !st.guard.hasUnflushed() || typeof storage.setAlarm !== 'function') return;
    const ms = this.env.TENANT_FLUSH_MS !== undefined && Number(this.env.TENANT_FLUSH_MS) >= 0 ? Number(this.env.TENANT_FLUSH_MS) : FLUSH_DELAY_MS;
    this._alarmArmed = true;
    const failed = (e) => { this._alarmArmed = false; this.flushError = String((e && e.message) || e); };
    try { Promise.resolve(storage.setAlarm(Date.now() + ms)).catch(failed); } catch (e) { failed(e); }
  }
  // The Durable Object alarm: write the metering the object still holds. A fresh object after an eviction holds nothing and has nothing to write.
  alarm() {
    this._alarmArmed = false;
    try { if (this._store) this._store.flush(); this.flushError = null; } catch (e) { this.flushError = String((e && e.message) || e); }
  }
  // The same, for calls that await a port (the Vectorize binding, US-25-R09); the error shape is identical.
  async _doAsync(tenantId, fn) {
    try {
      if (this.env.HALT === '1') throw err('tenant_halted', 'tenant_halted:HALT=1');
      const value = await fn(this.store(tenantId));
      this._armFlush();
      return { ok: true, value };
    } catch (e) { this._armFlush(); return asData(e); }
  }
  query(tenantId, text, params) { return this._do(tenantId, s => s.query(text, params)); }
  // With no VECTORIZE binding these stay synchronous and local, exactly as before; with one, the promotion facade answers.
  vectorUpsert(tenantId, id, v, o) { return this.env.VECTORIZE ? this._doAsync(tenantId, async s => { await s.tv.upsert(id, v, o); return true; }) : this._do(tenantId, s => s.vectors.upsert(id, v, o) ?? true); }
  vectorQuery(tenantId, v, o) { return this.env.VECTORIZE ? this._doAsync(tenantId, s => s.tv.query(v, o)) : this._do(tenantId, s => s.vectors.query(v, o)); }
  vectorPromote(tenantId, o) { return this._doAsync(tenantId, s => s.tv.promote(o)); }
  rollupAdd(tenantId, name, key, d) { return this._do(tenantId, s => s.rollups.add(name, key, d) ?? true); }
  rollupGet(tenantId, name, key) { return this._do(tenantId, s => s.rollups.get(name, key)); }
  // US-25-R13: an independent halt for one tenant. A tenant halt never blocks resume (resume reads no budget); HALT=1 stops both, as it stops everything.
  halt(tenantId, reason) { return this._do(tenantId, s => s.halt(reason)); }
  resume(tenantId) { return this._do(tenantId, s => s.resume()); }
  status(tenantId) { return this._do(tenantId, s => ({ ...s.status(), storageBytes: this.ctx.storage.sql.databaseSize, flushError: this.flushError || null }), { readOnlyStatus: true }); }
};

// Router: one stub per tenant, never a shared namespace id. Tenant ids are validated so a caller cannot reach another tenant's object.
export function tenantStub(env, tenantId) {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(tenantId)) throw new Error('bad_tenant_id');
  return env.TENANT.get(env.TENANT.idFromName(tenantId));
}
