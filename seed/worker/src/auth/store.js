// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// AUTH-1: per-tenant credential rows (migration 0006). Modules take `db` and `env` as arguments.
import { seal, open } from './seal.js';
const iso = d => new Date(d).toISOString().replace(/\.\d+Z$/, 'Z');
export async function get(db, tenant, provider) {
  return db.prepare('SELECT * FROM credentials WHERE tenant = ? AND provider = ?').bind(tenant, provider).first();
}
export async function put(db, env, tenant, provider, { secret, meta, access, expiresAt, status = 'ok', error = null }) {
  const prev = await get(db, tenant, provider);
  const sealed = secret === undefined ? (prev && prev.sealed) : await seal(env, secret);
  const m = JSON.stringify({ ...(prev ? JSON.parse(prev.meta) : {}), ...(meta || {}) });
  const acc = access === undefined ? (prev && prev.access_sealed) : (access ? await seal(env, { token: access }) : null);
  await db.prepare(`INSERT INTO credentials (tenant, provider, sealed, meta, access_sealed, expires_at, status, last_error, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(tenant, provider) DO UPDATE SET sealed=excluded.sealed, meta=excluded.meta, access_sealed=excluded.access_sealed, expires_at=excluded.expires_at, status=excluded.status, last_error=excluded.last_error, updated_at=excluded.updated_at`)
    .bind(tenant, provider, sealed || null, m, acc || null, expiresAt ? iso(expiresAt) : (prev && prev.expires_at) || null, status, error, iso(Date.now())).run();
}
export async function event(db, tenant, provider, ev, detail = '') {
  await db.prepare('INSERT INTO credential_events (tenant, provider, event, detail) VALUES (?,?,?,?)').bind(tenant, provider, ev, String(detail).slice(0, 300)).run();
}
export async function material(db, env, tenant, provider) {
  const r = await get(db, tenant, provider);
  if (!r) return null;
  return { secret: await open(env, r.sealed), meta: JSON.parse(r.meta), access: (await open(env, r.access_sealed))?.token || null, expiresAt: r.expires_at, status: r.status };
}
