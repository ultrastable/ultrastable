// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Promotion past maxVectors (TS-9, US-25-R09). A tenant's vectors live in its own store (vector.js) up to maxVectors. When a Vectorize-shaped
// binding is configured, the next vector that would not fit starts a promotion instead of failing: the stored vectors are copied, in bounded
// and charged batches, to the binding, namespaced by tenant, and every later call goes through the port. With no binding the same upsert still
// fails with vector_cap, never silently.
//
// The binding is a VectorPort, the shape core/discover already uses (core/tenantstore may not import discover, so the three methods are
// restated here): { upsert(rows: [{ id, values, namespace, metadata }]), query(values, { topK, namespace, filter }) -> { matches: [{ id, score,
// metadata }] }, deleteByIds?(ids) }. Nothing here knows Cloudflare.
//
// States, kept in the store's own `_vec_state` table so a crash or a spent budget resumes where it stopped:
//   local      every vector is in _vec
//   promoting  new and changed vectors go to the port (and their local copy is deleted, so the copy cannot overwrite them); old local rows are
//              copied and deleted batch by batch; a query merges local and port results by score
//   vectorize  everything is in the port; queries charge (stored + 1) x dimensions, with `stored` an upper bound counted here
import { BudgetError } from './budget.js';
import { dequantize } from './vector.js';

const STATE_SCHEMA = `CREATE TABLE IF NOT EXISTS _vec_state (k TEXT PRIMARY KEY, v TEXT NOT NULL);`;
const toI8 = (blob) => new Int8Array(blob.buffer ? blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) : blob);

export class TenantVectors {
  constructor({ store, binding = null, namespace = store.tenantId, batch = 500 }) {
    this.store = store; this.sql = store.sql; this.guard = store.guard; this.local = store.vectors; this.binding = binding; this.namespace = namespace; this.batch = batch;
    this.sql.exec(STATE_SCHEMA);
    this.state = { mode: this._get('mode') || 'local', stored: Number(this._get('stored') || 0) };
  }
  _get(k) { const r = this.sql.exec('SELECT v FROM _vec_state WHERE k = ?', [k]).rows[0]; return r ? r.v : null; }
  // Every row this facade writes is charged (US-25-R14): the state row (mode, stored count) is a metered write like any other, so promotion
  // does not write rows the budget never sees. Only the one-time load of the two state rows in the constructor is exempt.
  _set(k, v) { const r = this.sql.exec('INSERT OR REPLACE INTO _vec_state(k, v) VALUES(?, ?)', [k, String(v)]); this.guard.record({ writes: r.rowsWritten, requests: 0 }); }
  _mode(m) { this.state.mode = m; this._set('mode', m); }
  _stored(n) { this.state.stored = Math.max(0, n); this._set('stored', this.state.stored); }
  mode() { return this.state.mode; }
  status() { return { mode: this.state.mode, local: this.local.count(), stored: this.state.stored, binding: !!this.binding }; }

  async _put(rows) { this.guard.record({ requests: 1 }); await this.binding.upsert(rows.map(r => ({ id: r.id, values: Array.from(r.values), namespace: this.namespace, metadata: { ns: r.ns, ...(r.meta || {}) } }))); }

  async upsert(id, vector, { ns = '', meta = null } = {}) {
    if (this.state.mode !== 'local') return this._remoteUpsert(id, vector, ns, meta);
    try { return this.local.upsert(id, vector, { ns, meta }); }
    catch (e) {
      if (!(e && e.code === 'vector_cap') || !this.binding) throw e;       // no binding: the cap stays a failure, never a silent spill
      this._mode('promoting'); this._stored(0);
      return this._remoteUpsert(id, vector, ns, meta);
    }
  }
  async _remoteUpsert(id, vector, ns, meta) {
    this.guard.checkWrite();
    await this._put([{ id, values: vector, ns, meta }]);
    if (this.state.mode === 'promoting') this.local.remove(id);               // the port holds the newest value; the old local row must not be copied over it
    this._stored(this.state.stored + 1);
  }
  async remove(id) {
    if (this.state.mode !== 'vectorize') this.local.remove(id);
    if (this.state.mode !== 'local' && this.binding.deleteByIds) { this.guard.record({ requests: 1 }); await this.binding.deleteByIds([id]); this._stored(this.state.stored - 1); }
  }

  // Copies up to maxBatches batches. Each batch's rows are charged as reads, the port call as a request, and the copied rows are deleted
  // locally. Safe to call again after a refusal (budget, port error): nothing is deleted before the port accepted it.
  async promote({ maxBatches = 4 } = {}) {
    if (!this.binding) return { done: false, reason: 'no_binding', mode: this.state.mode };
    if (this.state.mode === 'local') this._mode('promoting');
    if (this.state.mode === 'vectorize') return { done: true, copied: 0, mode: 'vectorize' };
    let copied = 0;
    for (let b = 0; b < maxBatches; b++) {
      this.guard.checkWrite();
      const r = this.sql.exec('SELECT id, ns, dim, scale, q, meta FROM _vec ORDER BY id LIMIT ?', [this.batch]);
      this.guard.record({ reads: r.rowsRead, requests: 0 });
      if (!r.rows.length) { this._mode('vectorize'); return { done: true, copied, mode: 'vectorize' }; }
      await this._put(r.rows.map(x => ({ id: x.id, values: dequantize(toI8(x.q), x.scale), ns: x.ns, meta: x.meta ? JSON.parse(x.meta) : null })));
      const ids = r.rows.map(x => x.id);
      const d = this.sql.exec(`DELETE FROM _vec WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      this.guard.record({ writes: d.rowsWritten, requests: 0 });
      const c = this.sql.exec(`UPDATE _vec_meta SET n = MAX(0, n - ?) WHERE k = 'count'`, [d.rowsWritten]);
      this.guard.record({ reads: c.rowsRead, writes: c.rowsWritten, requests: 0 });
      this._stored(this.state.stored + ids.length); copied += ids.length;
    }
    return { done: false, copied, mode: 'promoting' };
  }

  async query(vector, { k = 5, ns = '' } = {}) {
    const m = this.state.mode;
    if (m === 'local') return this.local.query(vector, { k, ns });
    this.guard.check();
    // (stored + 1) x dimensions: the platform bills queried dimensions as the vectors searched plus the query itself.
    this.guard.record({ requests: 1, vecDims: (this.state.stored + 1) * vector.length });
    const res = await this.binding.query(Array.from(vector), { topK: k, namespace: this.namespace, ...(ns !== '' ? { filter: { ns } } : {}), returnMetadata: true });
    const remote = (res.matches || []).map(x => { const { ns: _ns, ...meta } = x.metadata || {}; return { id: x.id, score: x.score, meta: Object.keys(meta).length ? meta : null }; });
    if (m === 'vectorize') return remote.slice(0, k);
    const local = this.local.query(vector, { k, ns });                          // promoting: what is not yet copied is still here
    const seen = new Set(remote.map(x => x.id));
    return [...remote, ...local.filter(x => !seen.has(x.id))].sort((a, b) => b.score - a.score).slice(0, k);
  }
}

// The gate card for the one step that needs the account: creating the Vectorize index and binding it to the tenants Worker. The default in
// effect is the local mode with vector_cap, so nothing waits; the probe is the Worker's own /health reading vectors.mode.
export function vectorizeGateCard({ id = 'tenant-vectorize', url = '/health' } = {}) {
  return {
    id, what: 'Create a Vectorize index for tenants that pass 20,000 vectors and bind it as VECTORIZE on the tenants Worker',
    why_gated: 'Creating a Vectorize index and a Worker binding uses the account\'s Cloudflare credential',
    default_in_effect: 'Local mode: vectors stay in the tenant store and the 20,001st fails with vector_cap (nothing is lost, nothing spills silently)',
    prepared_by_fleet: 'core/tenantstore/vectorport.js promotes through a VectorPort in bounded, charged, resumable batches; tested with a fake index',
    closing_probe: 'manual', probe: { get: url, path: 'vectors.mode', expect: 'vectorize' },
  };
}
export { BudgetError };
