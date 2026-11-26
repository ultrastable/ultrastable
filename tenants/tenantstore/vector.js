// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Vector search inside the tenant's own store. Embeddings are int8-quantized (1 byte per dimension, about 4x smaller than float32)
// and ranked by cosine similarity. Brute force is exact, needs no extra service, and is bounded by maxVectors, so cost is bounded too.
// Past the cap a tenant is promoted to its own index through the VectorPort (TS-9), never silently: with no port the upsert fails with
// vector_cap; with one, every stored vector is copied to the port, the copy is counted, and only then are the in-store rows removed.
// VectorPort contract (async; adapters implement it, core imports no platform):
//   port.upsert([{ id, values, namespace, metadata }])   port.query(values, { topK, namespace }) -> [{ id, score, metadata }]
//   port.remove(ids)
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS _vec (id TEXT PRIMARY KEY, ns TEXT NOT NULL DEFAULT '', dim INTEGER NOT NULL, scale REAL NOT NULL, q BLOB NOT NULL, meta TEXT);
CREATE INDEX IF NOT EXISTS _vec_ns ON _vec(ns);
`;
// A statement of its own: a SqlPort may run only the first statement of a text (adapters/sqlite does).
export const PORT_SCHEMA = 'CREATE TABLE IF NOT EXISTS _vec_port (k TEXT PRIMARY KEY, v TEXT NOT NULL)';
const BATCH = 100;

export function quantize(v) {
  let max = 0; for (const x of v) max = Math.max(max, Math.abs(x));
  const scale = max / 127 || 1, q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i] / scale);
  return { q, scale };
}
export function cosineQ(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
const toI8 = (blob) => new Int8Array(blob.buffer ? blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) : blob);

export class VectorIndex {
  constructor(sql, guard, port = null) { this.sql = sql; this.guard = guard; this.port = port; this.sql.exec(SCHEMA); this.sql.exec(PORT_SCHEMA); }
  // TS-9 state, kept in the tenant's own store so it survives a restart: when the tenant was promoted and how many vectors were copied.
  promoted() { const r = this.sql.exec("SELECT v FROM _vec_port WHERE k='promoted'").rows[0]; return r ? JSON.parse(r.v) : null; }
  /** Copy every stored vector to the port in batches, then remove the in-store rows. Idempotent: a second call returns the first record.
   *  A port failure throws before anything is removed, so the in-store index stays whole and the next call starts again. */
  async promote() {
    if (!this.port) { const e = new Error('no_vector_port'); e.code = 'no_vector_port'; throw e; }
    const done = this.promoted(); if (done) return done;
    this.guard.check();
    const r = this.sql.exec('SELECT id,ns,scale,q,meta FROM _vec');
    this.guard.record({ reads: r.rowsRead });
    for (let i = 0; i < r.rows.length; i += BATCH) {
      await this.port.upsert(r.rows.slice(i, i + BATCH).map(row => ({ id: row.id, namespace: row.ns, values: Array.from(toI8(row.q), x => x * row.scale), metadata: row.meta ? JSON.parse(row.meta) : null })));
    }
    const rec = { at: this.guard.now().toISOString(), copied: r.rows.length };
    const w = this.sql.exec("INSERT OR REPLACE INTO _vec_port(k,v) VALUES('promoted',?)", [JSON.stringify(rec)]);
    const d = this.sql.exec('DELETE FROM _vec');
    this.guard.record({ writes: w.rowsWritten + d.rowsWritten });
    return rec;
  }
  /** Upsert that spills (TS-9): in the store while under maxVectors; at the cap the tenant is promoted and the vector goes to the port. */
  async upsertAny(id, vector, { ns = '', meta = null } = {}) {
    if (!this.promoted()) {
      try { this.upsert(id, vector, { ns, meta }); return { where: 'store' }; }
      catch (e) { if (e.code !== 'vector_cap' || !this.port) throw e; await this.promote(); }
    }
    this.guard.check();
    await this.port.upsert([{ id, namespace: ns, values: Array.from(vector), metadata: meta }]);
    this.guard.record({ vecDims: vector.length });
    return { where: 'port' };
  }
  /** Query the store, or the port once promoted. A port query is charged its dimensions against the same vecDims budget. */
  async queryAny(vector, { k = 5, ns = '' } = {}) {
    if (!this.promoted()) return this.query(vector, { k, ns });
    this.guard.check();
    const out = await this.port.query(Array.from(vector), { topK: k, namespace: ns });
    this.guard.record({ vecDims: vector.length });
    return (out || []).slice(0, k).map(m => ({ id: m.id, score: m.score, meta: m.metadata ?? null }));
  }
  async removeAny(id) {
    if (!this.promoted()) return this.remove(id);
    this.guard.check(); await this.port.remove([id]); this.guard.record({});
  }
  count() { return this.sql.exec('SELECT COUNT(*) n FROM _vec').rows[0].n; }
  upsert(id, vector, { ns = '', meta = null } = {}) {
    this.guard.check();
    const exists = this.sql.exec('SELECT 1 x FROM _vec WHERE id=?', [id]).rows.length;
    if (!exists && this.count() >= this.guard.budget.maxVectors) { const e = new Error('vector_cap'); e.code = 'vector_cap'; e.max = this.guard.budget.maxVectors; throw e; }
    const { q, scale } = quantize(vector);
    const r = this.sql.exec('INSERT OR REPLACE INTO _vec(id,ns,dim,scale,q,meta) VALUES(?,?,?,?,?,?)', [id, ns, vector.length, scale, q, meta === null ? null : JSON.stringify(meta)]);
    this.guard.record({ writes: r.rowsWritten, reads: r.rowsRead });
  }
  remove(id) { const r = this.sql.exec('DELETE FROM _vec WHERE id=?', [id]); this.guard.record({ writes: r.rowsWritten }); }
  // Reads only the namespace's rows and charges every one of them: the cost of a query is its candidate count, visibly.
  query(vector, { k = 5, ns = '' } = {}) {
    this.guard.check();
    const { q } = quantize(vector);
    const r = this.sql.exec('SELECT id,q,meta FROM _vec WHERE ns=? AND dim=?', [ns, vector.length]);
    if (r.rowsRead > this.guard.budget.perQueryReads) { this.guard.record({ reads: r.rowsRead, vecDims: r.rowsRead * vector.length }); const e = new Error('query_too_wide'); e.code = 'query_too_wide'; throw e; }
    const scored = r.rows.map(row => ({ id: row.id, score: cosineQ(q, toI8(row.q)), meta: row.meta ? JSON.parse(row.meta) : null }));
    scored.sort((a, b) => b.score - a.score);
    this.guard.record({ reads: r.rowsRead, vecDims: r.rowsRead * vector.length });
    return scored.slice(0, k);
  }
}
