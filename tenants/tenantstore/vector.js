// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Vector search inside the tenant's own store. Embeddings are int8-quantized (1 byte per dimension, about 4x smaller than float32)
// and ranked by cosine similarity. Brute force is exact, needs no extra service, and is bounded by maxVectors, so cost is bounded too.
// Past the cap a tenant is promoted to a Vectorize namespace through the VectorPort (adapters), never silently.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS _vec (id TEXT PRIMARY KEY, ns TEXT NOT NULL DEFAULT '', dim INTEGER NOT NULL, scale REAL NOT NULL, q BLOB NOT NULL, meta TEXT);
CREATE INDEX IF NOT EXISTS _vec_ns ON _vec(ns);
CREATE TABLE IF NOT EXISTS _vec_meta (k TEXT PRIMARY KEY, n INTEGER NOT NULL);
`;

export function quantize(v) {
  let max = 0; for (const x of v) max = Math.max(max, Math.abs(x));
  const scale = max / 127 || 1, q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i] / scale);
  return { q, scale };
}
export function dequantize(q, scale) { const v = new Array(q.length); for (let i = 0; i < q.length; i++) v[i] = q[i] * scale; return v; }
export function cosineQ(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
const toI8 = (blob) => new Int8Array(blob.buffer ? blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) : blob);

export class VectorIndex {
  // One statement per exec: an adapter over a driver that prepares a single statement (node:sqlite) would otherwise skip all but the first.
  constructor(sql, guard) { this.sql = sql; this.guard = guard; for (const st of SCHEMA.split(';').map(x => x.trim()).filter(Boolean)) this.sql.exec(st); }
  // The vector count is a one-row counter (the count of rows in _vec is never scanned again once it exists). It is backfilled once, from the
  // rows already there, and every row that backfill reads is charged like any other read (US-25-R14).
  _counter(acc) {
    const r = this.sql.exec(`SELECT n FROM _vec_meta WHERE k = 'count'`);
    acc.reads += r.rowsRead;
    if (r.rows.length) return r.rows[0].n;
    const c = this.sql.exec('SELECT COUNT(*) n FROM _vec');
    acc.reads += c.rowsRead;
    const w = this.sql.exec(`INSERT OR REPLACE INTO _vec_meta(k, n) VALUES('count', ?)`, [c.rows[0].n]);
    acc.writes += w.rowsWritten;
    return c.rows[0].n;
  }
  // Uncharged on purpose: status() must work with a spent budget. It reads exactly one _vec_meta row (STATUS_READ_ROWS), never _vec.
  count() {
    const r = this.sql.exec(`SELECT n FROM _vec_meta WHERE k = 'count'`);
    if (r.rows.length) return r.rows[0].n;
    return this.sql.exec('SELECT COUNT(*) n FROM _vec').rows[0].n;   // a store that has never had a vector written: nothing to scan
  }
  upsert(id, vector, { ns = '', meta = null } = {}) {
    this.guard.checkWrite();
    const acc = { reads: 0, writes: 0 }, charge = () => this.guard.record({ reads: acc.reads, writes: acc.writes });
    const ex = this.sql.exec('SELECT 1 x FROM _vec WHERE id=?', [id]); acc.reads += ex.rowsRead;
    const exists = ex.rows.length;
    const n = this._counter(acc);
    if (!exists && n >= this.guard.budget.maxVectors) { charge(); const e = new Error('vector_cap'); e.code = 'vector_cap'; e.max = this.guard.budget.maxVectors; throw e; }
    const { q, scale } = quantize(vector);
    const r = this.sql.exec('INSERT OR REPLACE INTO _vec(id,ns,dim,scale,q,meta) VALUES(?,?,?,?,?,?)', [id, ns, vector.length, scale, q, meta === null ? null : JSON.stringify(meta)]);
    acc.reads += r.rowsRead; acc.writes += r.rowsWritten;
    if (!exists) acc.writes += this.sql.exec(`UPDATE _vec_meta SET n = n + 1 WHERE k = 'count'`).rowsWritten;
    charge();
  }
  remove(id) {
    this.guard.check();
    const acc = { reads: 0, writes: 0 };
    this._counter(acc);
    const r = this.sql.exec('DELETE FROM _vec WHERE id=?', [id]);
    acc.reads += r.rowsRead; acc.writes += r.rowsWritten;
    if (r.rowsWritten > 0) acc.writes += this.sql.exec(`UPDATE _vec_meta SET n = n - 1 WHERE k = 'count' AND n > 0`).rowsWritten;
    this.guard.record({ reads: acc.reads, writes: acc.writes });
  }
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
export const STATUS_READ_ROWS = 1;
