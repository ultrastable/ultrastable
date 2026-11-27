// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Deployment metadata and deployed-worker ports over the public Cloudflare Workers HTTP API (US-SPEC-11 R02, US-SPEC-12 R09 and R10), through an
// injected fetch. No network at import time; no account id or token in code; secret and variable values never leave the API reading.
//   cloudflareMetadata(cfg) -> { account, list(), describe(name) }     the `metadata` port of core/graph/wiring.js
//   cloudflareDeployed(cfg) -> { list() }                              the `deployed` port of core/fleet reconcile
// Two routes, so no single credential is the only way in:
//   direct   { accountId, token }: the Workers API read with a token that can read Workers scripts (and Queues, optionally).
//   gateway  { gateway, oidc }: the deploy gateway's read-only inventory route, proven by the run's own OIDC identity token (the gateway
//            holds the account credential). The gateway answers GET /inventory -> { scripts: [name] } and
//            GET /inventory?script=<name> -> the same shape `describe` returns here. core/deploygate does not serve /inventory yet:
//            this adapter is the client and the contract; the route is an integration request.
// Cost: `list()` of the deployed port makes three reads per worker (content, schedules, health) plus one for the script list, so a host on
// a 50-subrequest budget calls it for at most 15 workers per pass; nothing here truncates silently.
import { modulePart } from '../../../core/deploygate/index.js';

const API = 'https://api.cloudflare.com/client/v4';
/** Cloudflare binding type -> the wiring graph's binding type, and the field naming the target. A type not listed is dropped by the analyzer. */
const TYPES = {
  d1: ['database', b => b.database_name ?? b.id], kv_namespace: ['kv', b => b.namespace_id], r2_bucket: ['bucket', b => b.bucket_name],
  vectorize: ['vector', b => b.index_name], queue: ['queue', b => b.queue_name], durable_object_namespace: ['durable_object', b => b.class_name],
  workflow: ['workflow', b => b.workflow_name], service: ['service', b => b.service], ai: ['ai', () => null],
  secret_text: ['secret', null], plain_text: ['variable', null], json: ['variable', null],
};
/** One API binding as { type, name, target? }. A secret or a variable keeps its name only: its value is never copied. */
export function mapBinding(b) {
  const t = b && TYPES[b.type];
  if (!t) return null;
  if (t[1] === null) return { type: t[0], name: String(b.name) };
  const target = t[1](b);
  return { type: t[0], name: String(b.name), target: target == null ? null : String(target) };
}

const hex = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join('');

function reader({ fetch, accountId, token, gateway, oidc, apiBase }) {
  if (!fetch) throw new Error('a fetch port is required');
  const direct = Boolean(accountId && token), viaGateway = Boolean(gateway && oidc);
  if (!direct && !viaGateway) throw new Error('the metadata adapter needs { accountId, token } or { gateway, oidc }');
  const base = `${apiBase || API}/accounts/${accountId}`;
  // A failed read says which path and which status, never the response body or the credential.
  const get = async (path, as = 'json', auth = null) => {
    const headers = { authorization: `Bearer ${auth ?? token}`, 'user-agent': 'ultrastable-fleet-reader' };
    const r = await fetch(path.startsWith('http') ? path : base + path, { headers });
    if (!r.ok) throw new Error(`read ${path.replace(/^https?:\/\/[^/]+/, '').split('?')[0]} failed: status ${r.status}`);
    return as === 'json' ? r.json() : r.text();
  };
  return { direct, viaGateway, get, base, gatewayUrl: gateway ? gateway.replace(/\/$/, '') : null, oidc };
}

export function cloudflareMetadata(cfg = {}) {
  const io = reader(cfg), zones = cfg.zones || [];
  const viaGateway = async path => get(io, `${io.gatewayUrl}${path}`, await io.oidc(io.gatewayUrl));
  const get = (r, url, auth) => r.get(url, 'json', auth);
  let queueMap = null;
  // Queue consumers: one read of the account's queues, cached for the sweep. An unreadable queue list leaves `queue_consumers` empty and says so in read_errors.
  async function queueConsumers() {
    if (queueMap) return queueMap;
    const map = new Map();
    for (const q of (await io.get('/queues')).result || []) for (const c of q.consumers || []) { const s = c.script || c.service; if (s) map.set(s, [...(map.get(s) || []), q.queue_name]); }
    return (queueMap = map);
  }
  return {
    account: cfg.label ?? null,
    async list() {
      if (!io.direct) { const r = await viaGateway('/inventory'); return (Array.isArray(r) ? r : r.scripts || []).map(String).sort(); }
      const names = [];
      for (let page = 1; page < 50; page++) {
        const body = await io.get(`/workers/scripts?page=${page}&per_page=100`);
        for (const w of body.result || []) names.push(String(w.id));
        const total = body.result_info && body.result_info.total_pages;
        if (!total || page >= total) break;
      }
      return names.sort();
    },
    async describe(name) {
      if (!io.direct) return viaGateway(`/inventory?script=${encodeURIComponent(name)}`);
      const n = encodeURIComponent(name), read_errors = [];
      const settings = (await io.get(`/workers/scripts/${n}/settings`)).result || {};
      const schedules = (await io.get(`/workers/scripts/${n}/schedules`)).result || {};
      const routes = [];
      try { for (const d of (await io.get(`/workers/domains?service=${n}`)).result || []) routes.push(String(d.hostname)); } catch (e) { read_errors.push(e.message); }
      for (const z of zones) { try { for (const r of (await io.get(`${cfg.apiBase || API}/zones/${encodeURIComponent(z)}/workers/routes`)).result || []) if (r.script === name) routes.push(String(r.pattern)); } catch (e) { read_errors.push(e.message); } }
      let queue_consumers = [];
      try { queue_consumers = (await queueConsumers()).get(name) || []; } catch (e) { read_errors.push(e.message); }
      return {
        version: null,                                                     // the deployed port carries versions; the metadata API has none
        crons: (schedules.schedules || []).map(s => s.cron).filter(Boolean).sort(),
        routes: routes.sort(), queue_consumers,
        bindings: (settings.bindings || []).map(mapBinding).filter(Boolean),
        read_errors,
      };
    },
  };
}

/**
 * The fleet's `deployed` port: for each script, its schedules, the SHA-256 of its stored module (the same hash core/hostsync
 * compares) and the health document its registered health URL answers. A health read that fails is reported as `{ status: 'unreachable', error }`,
 * never as healthy. `registry.list()` rows (or `healthUrls`) name the absolute health URL of each worker; a worker with none has `health: null`.
 */
export function cloudflareDeployed(cfg = {}) {
  const io = reader(cfg), meta = cloudflareMetadata(cfg);
  if (!io.direct) throw new Error('the deployed port reads module content: it needs { accountId, token }');
  return {
    async list() {
      const urls = { ...(cfg.healthUrls || {}) };
      if (cfg.registry && typeof cfg.registry.list === 'function') for (const r of await cfg.registry.list()) if (r.health_url && /^https?:\/\//.test(r.health_url)) urls[r.name] ??= r.health_url;
      const out = [];
      for (const name of await meta.list()) {
        const n = encodeURIComponent(name), row = { name };
        row.source_hash = await hex(modulePart(await io.get(`/workers/scripts/${n}/content/v2`, 'text')));
        row.crons = (((await io.get(`/workers/scripts/${n}/schedules`)).result || {}).schedules || []).map(s => s.cron).filter(Boolean).sort();
        if (urls[name]) {
          try {
            const r = await (cfg.healthFetch || cfg.fetch)(urls[name], { headers: { 'user-agent': 'ultrastable-fleet-reader' } });
            if (!r.ok) row.health = { status: 'unreachable', error: `status ${r.status}` };
            else { row.health = await r.json(); row.version = row.health.version ?? null; }
          } catch (e) { row.health = { status: 'unreachable', error: String((e && e.message) || e).slice(0, 120) }; }
        } else row.health = null;
        out.push(row);
      }
      return out;
    },
  };
}
