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
// A refused connector callback (a bad state, a replayed approval) arrives on an unauthenticated route, so each one is recorded at most once per
// (tenant, provider, reason kind) per hour: the owner still sees that someone probed, and an anonymous caller cannot grow credential_events
// (kept 180 days) without bound. `kind` is the fixed part of the reason, so varying the rest of the text does not get past the limit. The
// newest REFUSAL_LOOKBACK rows of the pair are read through credential_events_tenant_provider. Returns true when a row was written.
export const REFUSAL_LOOKBACK = 20;
export async function refusal(db, tenant, provider, kind, detail = kind) {
  const prefix = 'callback: ' + kind;
  const seen = await db.prepare(`SELECT 1 AS x FROM (SELECT at, event, detail FROM credential_events WHERE tenant = ? AND provider = ? ORDER BY id DESC LIMIT ${REFUSAL_LOOKBACK})
    WHERE event = 'failed' AND substr(detail, 1, ?) = ? AND at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hour') LIMIT 1`).bind(tenant, provider, prefix.length, prefix).first();
  if (seen) return false;
  await event(db, tenant, provider, 'failed', 'callback: ' + detail);
  return true;
}
export async function material(db, env, tenant, provider) {
  const r = await get(db, tenant, provider);
  if (!r) return null;
  return { secret: await open(env, r.sealed), meta: JSON.parse(r.meta), access: (await open(env, r.access_sealed))?.token || null, expiresAt: r.expires_at, status: r.status };
}

// AUTH-1: the deploy uploads code only, so the Worker brings its own tables up on first use (idempotent; mirrors migrations/0006_credentials.sql).
const DDL = [
  "CREATE TABLE IF NOT EXISTS credentials (tenant TEXT NOT NULL, provider TEXT NOT NULL, sealed TEXT, meta TEXT NOT NULL DEFAULT '{}', access_sealed TEXT, expires_at TEXT, status TEXT NOT NULL DEFAULT 'pending', last_error TEXT, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), PRIMARY KEY (tenant, provider))",
  "CREATE TABLE IF NOT EXISTS credential_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), tenant TEXT NOT NULL, provider TEXT NOT NULL, event TEXT NOT NULL, detail TEXT)",
  "CREATE INDEX IF NOT EXISTS credential_events_at ON credential_events (at)",
];
const ready = new WeakMap();
export function ensureSchema(db) {
  // A missing binding rejects up front: a non-object cannot be a WeakMap key, and starting the DDL first would leave its rejection unobserved (US-30-R30).
  if (!db || typeof db.prepare !== 'function') return Promise.reject(new Error('credential store unavailable: no database bound'));
  if (!ready.has(db)) ready.set(db, (async () => { for (const q of DDL) await db.prepare(q).run(); })().catch(e => { ready.delete(db); throw e; }));
  return ready.get(db);
}
