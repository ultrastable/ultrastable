// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The client handle a tenant app uses to reach its own store (US-25-R16, TS-1). The store is a Worker; a tenant app holds a service binding
// (or a fetch) and this handle, and nothing else: it can name only its own tenant id, validated here as the Worker validates it, and every
// refusal comes back as an error with the fields the Worker sent (budget_exceeded keeps limit, period and resetsAt). No platform import:
// `fetcher` is { fetch(url, init) } (a service binding) or a fetch function.
//   const db = createTenantClient({ fetcher: env.TENANTS, token: env.TENANT_TOKEN, tenantId: 'acme' });
//   await db.query('SELECT n FROM jobs WHERE id = ?', [7]);  db.rollups.add('jobs_by_status', 'ok');  db.vectors.query(vec, { k: 5 });
import { BudgetError } from './budget.js';

export const TENANT_ID = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function errorFrom(status, body) {
  const b = body && typeof body === 'object' ? body : {};
  const code = b.code || (status === 401 ? 'unauthorized' : status === 404 ? 'not_found' : 'error');
  const e = code === 'budget_exceeded' ? new BudgetError(b.limit, b.period, b.used, b.max, b.resetsAt) : new Error(b.message || code);
  e.code = code; e.status = status;
  for (const k of ['limit', 'period', 'resetsAt', 'rowsRead', 'rowsWritten', 'reason', 'max']) if (b[k] !== undefined) e[k] = b[k];
  return e;
}

export function createTenantClient({ fetcher, baseUrl = 'https://tenants.invalid', token, tenantId } = {}) {
  if (!fetcher) throw new Error('fetcher required');
  if (!token) throw new Error('token required');
  if (!TENANT_ID.test(typeof tenantId === 'string' ? tenantId : '')) throw new Error('bad_tenant_id');
  const send = typeof fetcher === 'function' ? fetcher : (u, i) => fetcher.fetch(u, i);
  const root = `${baseUrl.replace(/\/+$/, '')}/t/${tenantId}`;
  async function call(path, body) {
    const res = await send(`${root}/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null; try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) throw errorFrom(res.status, data);
    return data;
  }
  return {
    tenantId,
    query: (sql, params = []) => call('query', { sql, params }),
    status: () => call('status'),
    vectors: {
      upsert: (id, vector, { ns, meta } = {}) => call('vec/upsert', { id, vector, ns, meta }),
      query: (vector, { k, ns } = {}) => call('vec/query', { vector, k, ns }),
    },
    rollups: {
      add: (name, key, { n, sum, val } = {}) => call('rollup', { name, key, n, sum, val }),
      // the rollup table's primary key (name, key): one row, never a scan
      get: async (name, key) => (await call('query', { sql: 'SELECT * FROM _rollup WHERE name = ? AND key = ?', params: [name, key] })).rows[0] || null,
    },
  };
}
