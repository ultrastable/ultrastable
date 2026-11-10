// Ultrastable seed Worker: the server-side heartbeat for one org.
// Cron fires runTick; GET /health shows the last tick's four-line report.
// Standard issue: first-party web analytics (analytics/analytics.js): /a.js beacon, /a/e collector, GET /api/analytics (bearer ANALYTICS_TOKEN).
import { runTick } from './tick.js';
import config from './config.js';
import { handleAnalytics, selfcheck, report } from '../../analytics/analytics.js';

const hosts = env => (env.ANALYTICS_HOSTS ? String(env.ANALYTICS_HOSTS).split(',') : [env.PUBLIC_HOST || config.org_slug + '.example']).map(h => h.trim());

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runTick(env.DB, { config, env: presence(env) }));
    ctx.waitUntil(selfcheck(env, hosts(env)[0]).catch(e => console.error('analytics selfcheck', e && e.message)));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const an = await handleAnalytics(request, env, { hosts: hosts(env) });
    if (an) return an;
    if (url.pathname === '/api/analytics') {
      if (!env.ANALYTICS_TOKEN || request.headers.get('authorization') !== 'Bearer ' + env.ANALYTICS_TOKEN) return Response.json({ error: 'unauthorized' }, { status: 401 });
      return Response.json(await report(env));
    }
    if (url.pathname === '/health') {
      const last = await env.DB.prepare(
        `SELECT id, started_at, finished_at, steps_completed, steps_total, report, errors FROM tick_runs ORDER BY id DESC LIMIT 1`
      ).first();
      const ok = Boolean(last && last.steps_completed === last.steps_total);
      return Response.json({ ok, org: config.org_slug, last_tick: last || null }, { status: ok ? 200 : 503 });
    }
    return new Response('ultrastable seed worker\n', { headers: { 'content-type': 'text/plain' } });
  },
};

// The tick sees only whether a secret binding exists, never its value.
function presence(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && v) out[k] = true;
  return out;
}
