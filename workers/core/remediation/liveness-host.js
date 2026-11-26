// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// A deployable host for the external liveness detector (US-SPEC-17 R10): a second worker with its own database that watches a
// probe table (or a health endpoint) written by another worker. A monitor cannot detect its own stop, so the host refuses to watch
// a writer it is. Ports only: { db: its own store (with the remediation migrations), probeDb: a read-only handle on the writer's
// store, config, now(), fetch }. No platform import: an adapter binds the two databases and the clock (see wrangler.liveness.template.jsonc).
import { externalLiveness, httpLiveness, cfg } from './index.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function createLivenessHost({ db, probeDb = null, config = {}, now = () => Date.now(), fetch = null } = {}) {
  if (!db) throw new Error('the host needs its own database');
  const ctx = { db, probeDb, config: { host: 'liveness-watcher', ...config }, now, fetch };
  const entries = () => [...(ctx.config.liveness || []).map(e => ({ kind: 'table', ...e })), ...(ctx.config.http || []).map(e => ({ kind: 'http', ...e }))];

  /** One run: every configured table or endpoint, each in this host's own store. An entry whose writer is this host is refused, and files its item. */
  async function scheduled() {
    const results = [];
    for (const e of entries()) {
      const r = e.kind === 'table' ? await externalLiveness(ctx, e) : await httpLiveness(ctx, e);
      results.push({ kind: e.kind, target: e.table || e.url, writer: e.writer, ok: r.ok, fired: !!r.fired, reason: r.reason || null, evidence: r.evidence || null });
    }
    return { host: ctx.config.host, ran: results.filter(r => r.ok).length, refused: results.filter(r => r.reason === 'same_host').map(r => r.target), results };
  }

  /** GET /health: the newest reading of each detector this host runs. 503 when one fired or when this host's own last run is more than 2 intervals old. */
  async function health() {
    const c = cfg(ctx), at = new Date(now()).toISOString().replace('T', ' ').slice(0, 19);
    const rows = (await db.prepare(`SELECT h.detector, h.fired, h.ts, h.evidence FROM remediation_hits h WHERE h.host = ? AND h.id IN
      (SELECT MAX(id) FROM remediation_hits WHERE host = ? GROUP BY detector) ORDER BY h.detector`).bind(c.host, c.host).all()).results || [];
    const last = (await db.prepare(`SELECT MAX(ts) AS ts FROM remediation_hits WHERE host = ?`).bind(c.host).first()) || {};
    const every = Math.min(...entries().map(e => Number(e.interval_min)).filter(n => n > 0), 60);
    const stale = !last.ts || (now() - Date.parse(last.ts.replace(' ', 'T') + 'Z')) / 60000 > c.stale_intervals * every;
    const ok = rows.length > 0 && !stale && rows.every(r => !r.fired);
    return { ok, host: c.host, at, last_run: last.ts || null, stale, detectors: rows.map(r => ({ detector: r.detector, fired: !!r.fired, ts: r.ts, evidence: r.evidence })) };
  }

  async function handle(request) {
    const u = new URL(request.url);
    if (request.method === 'GET' && u.pathname === '/health') { const h = await health(); return json(h, h.ok ? 200 : 503); }
    return json({ error: 'not_found' }, 404);
  }
  return { ctx, scheduled, health, fetch: handle };
}

/**
 * The module-worker shape an adapter exports: `export default livenessWorker(env => ({ db: env.DB, probeDb: env.PROBE_DB, config: ... }))`.
 * The adapter, not this file, knows the platform's bindings.
 */
export function livenessWorker(makeOptions) {
  return {
    async fetch(request, env) { return createLivenessHost(makeOptions(env)).fetch(request); },
    async scheduled(_event, env, waitUntil) { const p = createLivenessHost(makeOptions(env)).scheduled(); if (waitUntil) waitUntil(p); return p; },
  };
}
