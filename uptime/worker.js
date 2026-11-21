// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// UPTIME-1: cron worker (every 5 minutes). Probes every declared site, keeps the last result in KV (binding STATE) and asks the repair path to act on a dead one.
import { checkAll } from './probe.js';
export const SITES = ['ultrastable.org', 'www.ultrastable.org', 'solutions.ultrastable.org', 'ultrastable.io', 'www.ultrastable.io', 'ultrastable.app', 'www.ultrastable.app', 'ultrastable.net', 'www.ultrastable.net'];
export const EXPECT_NS = ['grace.ns.cloudflare.com', 'leonidas.ns.cloudflare.com'];

export async function run(env, fetchImpl = fetch, now = Date.now) {
  const results = await checkAll(SITES, { fetchImpl, expectNs: EXPECT_NS });
  const dead = results.filter(r => r.verdict !== 'ok');
  let repair = null;
  if (dead.length && env.TICK) {  // repair: the tick Worker holds the org GitHub App; it redeploys the site, which re-attaches custom domains and DNS records
    try {
      const r = await env.TICK.fetch('https://tick/api/uptime/repair', { method: 'POST' });
      repair = { http: r.status, body: (await r.text()).slice(0, 120) };
    } catch (e) { repair = { err: String(e && e.message || e).slice(0, 80) }; }
  } else if (dead.length) repair = { dispatched: false, why: 'no TICK binding' };
  const rec = { at: new Date(now()).toISOString(), ok: dead.length === 0, dead: dead.map(d => d.host), repair, results };
  if (env.STATE) { await env.STATE.put('last', JSON.stringify(rec)); await env.STATE.put('at:' + rec.at, JSON.stringify({ ok: rec.ok, dead: rec.dead, repair }), { expirationTtl: 7 * 86400 }); }
  return rec;
}

export default {
  async scheduled(_e, env, ctx) { ctx.waitUntil(run(env)); },
  async fetch(req, env) {
    const last = env.STATE ? await env.STATE.get('last') : null;
    return new Response(last || '{"ok":null,"why":"no run yet"}', { status: last && JSON.parse(last).ok ? 200 : 503, headers: { 'content-type': 'application/json' } });
  },
};
