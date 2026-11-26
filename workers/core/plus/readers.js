// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Usage readers for the plus loop (US-04-R09, R14): the reader port of plusStep, filled two ways.
//  firstPartyReader   reads the system's own cookieless hits (the table of seed/analytics: at in epoch ms, host, bot, name). It needs no
//                     account and no credential, only the database handle, and it separates machine requests from human ones.
//  cloudflareAnalyticsReader  reads a platform's analytics API through a fetch port with a token read from the environment by name. It
//                     counts machine and human requests together and says so. Only the real call needs an account; the port is exercised
//                     here with a fake fetch.
// A reader that cannot read throws. measureUsage (core/plus) then records null with the reason, never 0.
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DAY_H = 24;
const perDay = (metric) => /_per_day$/.test(String(metric || ''));

export function firstPartyReader({ db, table = 'hits', window_h = 168, now = () => Date.now() } = {}) {
  if (!db) throw new Error('firstPartyReader needs a db');
  if (!IDENT.test(table)) throw new Error('table must be a table name');
  return async function read({ host, usage_metric } = {}) {
    if (!host || !String(host).trim()) throw new Error('the product has no host, so its hits cannot be counted');
    const t = typeof now === 'function' ? now() : now, since = t - window_h * 3600e3;
    let hasBot = true;
    try { await db.prepare(`SELECT bot FROM ${table} LIMIT 1`).first(); } catch (e) { if (/no such column/i.test(String(e.message))) hasBot = false; else throw e; }
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE host = ? AND at >= ? AND at <= ? AND name = 'pageview'${hasBot ? ' AND bot = 0' : ''}`).bind(host, since, t).first();
    const n = Number(row?.n);
    if (!Number.isFinite(n)) throw new Error('the hits table returned no count');
    return { value: perDay(usage_metric) ? n / (window_h / DAY_H) : n, window_h, includes_machine: hasBot ? false : true };
  };
}

// zones: { <host>: <zone tag> } or zone_for({ product, host }) -> zone tag. The token is read from env[token_env] and goes only in a header.
export function cloudflareAnalyticsReader({ fetch, env = {}, token_env = 'CLOUDFLARE_ANALYTICS_TOKEN', zones = {}, zone_for = null, window_h = 168, now = () => Date.now(), endpoint = 'https://api.cloudflare.com/client/v4/graphql' } = {}) {
  if (typeof fetch !== 'function') throw new Error('cloudflareAnalyticsReader needs a fetch port');
  return async function read({ product, host, usage_metric } = {}) {
    const token = env[token_env];
    const scrub = (m) => (token && String(token).length > 3 ? String(m).split(String(token)).join('[redacted]') : String(m)).slice(0, 200);
    if (!token) throw new Error(`the setting ${token_env} is not present`);
    const zone = zone_for ? await zone_for({ product, host }) : zones[host];
    if (!zone) throw new Error(`no zone is known for ${host ?? product}`);
    const t = typeof now === 'function' ? now() : now, day = (ms) => new Date(ms).toISOString().slice(0, 10);
    const query = 'query($zone: String!, $since: Date!, $until: Date!) { viewer { zones(filter: { zoneTag: $zone }) { httpRequests1dGroups(limit: 100, filter: { date_geq: $since, date_leq: $until }) { sum { requests } } } } }';
    let res;
    try { res = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables: { zone, since: day(t - window_h * 3600e3), until: day(t) } }) }); }
    catch (e) { throw new Error(`the analytics call failed: ${scrub(e.message)}`); }
    if (!res.ok) throw new Error(`the analytics service answered ${res.status}`);
    let body; try { body = await res.json(); } catch { throw new Error('the analytics service returned no JSON'); }
    if (Array.isArray(body?.errors) && body.errors.length) throw new Error(`the analytics service reported: ${scrub(body.errors[0]?.message ?? 'an error')}`);
    const groups = body?.data?.viewer?.zones?.[0]?.httpRequests1dGroups;
    if (!Array.isArray(groups)) throw new Error('the analytics response has no httpRequests1dGroups');
    const total = groups.reduce((s, g) => s + Number(g?.sum?.requests), 0);
    if (!Number.isFinite(total)) throw new Error('the analytics response holds no request count');
    return { value: perDay(usage_metric) ? total / (window_h / DAY_H) : total, window_h, includes_machine: true };
  };
}

// The first reader that returns a number wins; when none does, the failures of all are the error.
export function composeReaders(readers = []) {
  return async function read(req) {
    const why = [];
    for (const [i, r] of readers.entries()) {
      try { const out = await r(req); if (out && Number.isFinite(Number(out.value)) && out.value !== null) return out; why.push(`reader ${i + 1}: returned no number`); }
      catch (e) { why.push(`reader ${i + 1}: ${e.message}`); }
    }
    throw new Error(why.length ? why.join('; ') : 'no usage reader is configured');
  };
}
