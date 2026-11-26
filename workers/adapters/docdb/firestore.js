// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// A driver for a hosted document database (US-SPEC-14 section 4, US-14-R11): the document port of adapters/docdb/index.js over the Firestore
// REST API, with an injected fetch and token, in the pattern of adapters/gcp/deployer.js. No SDK, no network of its own.
//   create  POST  .../documents/<collection>?documentId=<key>     409 ALREADY_EXISTS is false: create-only, never overwrites
//   get     GET   .../documents/<collection>/<key>                404 is null
//   set     PATCH .../documents/<collection>/<key>                 replaces or creates
//   patch   PATCH ... ?updateMask.fieldPaths=...&currentDocument.exists=true     404 is false
//   remove  DELETE;  add: a create with a store-assigned, increasing key;  scan: list with paging
//   query   POST  .../documents:runQuery   (equality and IN filters, orderBy, limit); a query no declared index covers is refused here, as in
//           the reference store, so a production index is declared before it is needed
//   transaction  :beginTransaction, reads inside it, writes buffered and sent in one :commit with preconditions; an ABORTED commit (another
//           writer got there first) runs the whole function again, up to `retries` times, so claim correctness holds under contention.
// The token is a string or an async function; it is never logged and never put in an error.
import { INDEXES } from './index.js';

const enc = encodeURIComponent;
export const toValue = v => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
};
export const toFields = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toValue(v)]));
export const fromValue = v => {
  if (!v || 'nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields);
  return null;
};
export const fromFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, fromValue(v)]));
const keyOf = name => decodeURIComponent(String(name).split('/').pop());

export class FirestoreError extends Error { constructor(message, status) { super(message); this.name = 'FirestoreError'; this.status = status; } }

export function firestoreDocStore({ fetch: doFetch = globalThis.fetch, project, database = '(default)', token, indexes = INDEXES, base = 'https://firestore.googleapis.com/v1', now = () => Date.now(), retries = 6, pageSize = 300 } = {}) {
  if (!project) throw new Error('a project is required');
  const root = `projects/${project}/databases/${database}/documents`;
  const url = (p = '') => `${base}/${root}${p}`;
  let counter = 0;
  const covered = (c, fields) => fields.length === 0 || (indexes[c] || []).some(ix => fields.every(f => ix.includes(f)) && ix.slice(0, fields.length).every(f => fields.includes(f)));

  async function call(method, u, body) {
    const t = typeof token === 'function' ? await token() : token;
    if (!t) throw new FirestoreError('no token is present for the document database', 401);
    const res = await doFetch(u, { method, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await res.json(); } catch { json = null; }
    return { status: res.status, json };
  }
  const fail = (what, r) => new FirestoreError(`${what} failed with ${r.status}${r.json?.error?.status ? ` ${r.json.error.status}` : ''}`, r.status);
  const docOf = (c, e) => ({ key: keyOf(e.name), ...fromFields(e.fields) });
  const newKey = () => `${String(now()).padStart(15, '0')}${String(++counter).padStart(6, '0')}`;
  const filterOf = where => {
    const fs = Object.entries(where || {}).map(([field, v]) => ({ fieldFilter: { field: { fieldPath: field }, op: Array.isArray(v) ? 'IN' : 'EQUAL', value: Array.isArray(v) ? toValue(v) : toValue(v) } }));
    return fs.length === 0 ? undefined : fs.length === 1 ? fs[0] : { compositeFilter: { op: 'AND', filters: fs } };
  };
  async function runQuery(c, { where = {}, orderBy = [], limit } = {}, transaction) {
    const fields = Object.keys(where);
    if (!covered(c, fields)) throw new Error(`no index on ${c} for (${fields.join(', ')}): declare one`);
    const structuredQuery = { from: [{ collectionId: c }] };
    const f = filterOf(where); if (f) structuredQuery.where = f;
    structuredQuery.orderBy = [...orderBy.map(o => ({ field: { fieldPath: o }, direction: 'ASCENDING' })), { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }];
    if (Number.isFinite(limit)) structuredQuery.limit = limit;
    const r = await call('POST', url(':runQuery'), { structuredQuery, ...(transaction ? { transaction } : {}) });
    if (r.status !== 200) throw fail(`query on ${c}`, r);
    return (r.json || []).filter(x => x.document).map(x => docOf(c, x.document));
  }
  async function scan(c) {
    const out = []; let page = '';
    do {
      const r = await call('GET', url(`/${enc(c)}?pageSize=${pageSize}${page ? `&pageToken=${enc(page)}` : ''}`));
      if (r.status !== 200) throw fail(`scan of ${c}`, r);
      for (const d of r.json?.documents || []) out.push(docOf(c, d));
      page = r.json?.nextPageToken || '';
    } while (page);
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  const ops = {
    async create(c, key, doc) {
      const r = await call('POST', url(`/${enc(c)}?documentId=${enc(key)}`), { fields: toFields(doc) });
      if (r.status === 200) return true; if (r.status === 409) return false; throw fail(`create in ${c}`, r);
    },
    async get(c, key) { const r = await call('GET', url(`/${enc(c)}/${enc(key)}`)); if (r.status === 404) return null; if (r.status !== 200) throw fail(`get from ${c}`, r); return docOf(c, r.json); },
    async set(c, key, doc) { const r = await call('PATCH', url(`/${enc(c)}/${enc(key)}`), { fields: toFields(doc) }); if (r.status !== 200) throw fail(`set in ${c}`, r); },
    async patch(c, key, fields) {
      const mask = Object.keys(fields).filter(k => fields[k] !== undefined).map(k => `updateMask.fieldPaths=${enc(k)}`).join('&');
      const r = await call('PATCH', url(`/${enc(c)}/${enc(key)}?${mask}&currentDocument.exists=true`), { fields: toFields(fields) });
      if (r.status === 404 || r.status === 400 && r.json?.error?.status === 'FAILED_PRECONDITION') return false;
      if (r.status !== 200) throw fail(`patch in ${c}`, r); return true;
    },
    async remove(c, key) { const r = await call('DELETE', url(`/${enc(c)}/${enc(key)}`)); if (r.status !== 200 && r.status !== 404) throw fail(`remove from ${c}`, r); return r.status === 200; },
    async add(c, doc) { const key = newKey(); if (!(await ops.create(c, key, doc))) throw new FirestoreError(`a generated key collided in ${c}`, 409); return key; },
    query: (c, q) => runQuery(c, q),
    scan,
  };

  /** One attempt: reads go through the transaction id, writes are buffered and see each other (read-your-writes) and go out in one commit. */
  async function attempt(fn) {
    const begun = await call('POST', url(':beginTransaction'), {});
    if (begun.status !== 200) throw fail('beginTransaction', begun);
    const transaction = begun.json.transaction;
    const pending = new Map();                                          // 'collection/key' -> { c, key, doc | null (deleted), exists: precondition }
    const writes = [];
    const slot = (c, key) => `${c}/${key}`;
    const read = async (c, key) => {
      const p = pending.get(slot(c, key)); if (p) return p.doc ? { key, ...p.doc } : null;
      const r = await call('GET', url(`/${enc(c)}/${enc(key)}?transaction=${enc(transaction)}`));
      if (r.status === 404) return null; if (r.status !== 200) throw fail(`transactional get from ${c}`, r); return docOf(c, r.json);
    };
    const buffer = (c, key, doc, { mask = null, exists = null } = {}) => {
      pending.set(slot(c, key), { c, key, doc });
      writes.push(doc === null ? { delete: `${root}/${c}/${key}` }
        : { update: { name: `${root}/${c}/${key}`, fields: toFields(doc) }, ...(mask ? { updateMask: { fieldPaths: mask } } : {}), ...(exists === null ? {} : { currentDocument: { exists } }) });
    };
    const tx = {
      get: read,
      async create(c, key, doc) { if (await read(c, key)) return false; buffer(c, key, doc, { exists: false }); return true; },
      async set(c, key, doc) { buffer(c, key, doc); },
      async patch(c, key, fields) { const cur = await read(c, key); if (!cur) return false; const { key: _k, ...rest } = cur; const merged = { ...rest, ...fields }; buffer(c, key, merged); return true; },
      async remove(c, key) { const had = await read(c, key); buffer(c, key, null); return !!had; },
      async add(c, doc) { const key = newKey(); buffer(c, key, doc, { exists: false }); return key; },
      async query(c, q = {}) {
        const rows = await runQuery(c, q, transaction);
        const byKey = new Map(rows.map(r => [r.key, r]));
        for (const p of pending.values()) {                              // overlay this transaction's own writes
          if (p.c !== c) continue;
          const match = p.doc && Object.entries(q.where || {}).every(([f, v]) => (Array.isArray(v) ? v.includes(p.doc[f]) : p.doc[f] === v));
          if (p.doc && match) byKey.set(p.key, { key: p.key, ...p.doc }); else byKey.delete(p.key);
        }
        const out = [...byKey.values()].sort((a, b) => { for (const f of q.orderBy || []) { if (a[f] !== b[f]) return (a[f] ?? '') < (b[f] ?? '') ? -1 : 1; } return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
        return out.slice(0, Number.isFinite(q.limit) ? q.limit : undefined);
      },
    };
    let result;
    try { result = await fn(tx); } catch (e) {
      await call('POST', url(':rollback'), { transaction });             // best effort: a transaction the function abandoned holds nothing
      throw e;
    }
    const r = await call('POST', url(':commit'), { writes, transaction });
    if (r.status === 200) return { done: true, result };
    if (r.status === 409 || r.json?.error?.status === 'ABORTED') return { done: false };
    throw fail('commit', r);
  }

  return {
    ...ops,
    async transaction(fn) {
      for (let i = 0; i < retries; i++) { const a = await attempt(fn); if (a.done) return a.result; }
      throw new FirestoreError(`the transaction was aborted ${retries} times by other writers`, 409);
    },
  };
}
