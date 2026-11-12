// Ultrastable seed Worker: the server-side heartbeat for one org.
// Cron fires runTick; GET /health shows the last tick's four-line report.
// Standard issue: first-party web analytics (analytics/analytics.js): /a.js beacon, /a/e collector, GET /api/analytics (bearer ANALYTICS_TOKEN).
import { runTick } from './tick.js';
import { runExecutor } from './executor.js';
import { runLane } from './lane.js';
import config from './config.js';
import { loadAnswers, saveAnswer, nextQuestion, QUESTIONS } from './interview.js';
import { nowScreen, nextScreen, needsScreen, questionScreen, doneScreen } from './ui.js';
import { handleAnalytics, selfcheck, report } from '../../analytics/analytics.js';
import { createAgenticHandler, DEFAULT_IDENTITY } from './agentic/handler.js';
import { d1Store } from './agentic/adapters/d1-store.js';
import { staticRegistries } from './agentic/adapters/memory.js';
import { bearerAuth } from './agentic/adapters/bearer-auth.js';
import { consoleTelemetry } from './agentic/adapters/console-telemetry.js';

const hosts = env => (env.ANALYTICS_HOSTS ? String(env.ANALYTICS_HOSTS).split(',') : [env.PUBLIC_HOST || config.org_slug + '.example']).map(h => h.trim());

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runTick(env.DB, { config, env: presence(env) }));
    ctx.waitUntil(runExecutor(env).then(r => console.log('executor', JSON.stringify(r))).catch(e => console.error('executor', e && e.message)));
    ctx.waitUntil(runLane({ token: env.GITHUB_TOKEN, repos: config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []), issueWorkflow: null }).then(r => console.log('lane', JSON.stringify(r))).catch(e => console.error('lane', e && e.message)));
    ctx.waitUntil(selfcheck(env, hosts(env)[0]).catch(e => console.error('analytics selfcheck', e && e.message)));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    // Agent-facing surfaces (MCP, discovery documents) are registered in seed/standards/surfaces.json.
    const agentic = createAgenticHandler({
      store: d1Store(env.DB), registries: staticRegistries(config.registries || {}), auth: bearerAuth, telemetry: consoleTelemetry,
      identity: { ...DEFAULT_IDENTITY, slug: config.org_slug, name: config.org_slug },
    });
    const ag = await agentic(request, env);
    if (ag) return ag;
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
    const db = env.DB;
    if (url.pathname === '/') return nowScreen({ org: config.org_slug, lastTick: await lastTick(db), answers: await loadAnswers(db) });
    if (url.pathname === '/next') {
      const { results } = await db.prepare(`SELECT title, owner_role FROM items WHERE status IN ('open','ready') ORDER BY priority, created_at LIMIT 5`).all();
      return nextScreen({ items: results });
    }
    if (url.pathname === '/needs-you') {
      const { results } = await db.prepare(`SELECT what, why_gated, default_in_effect FROM gate_cards WHERE status='open' ORDER BY id LIMIT 10`).all();
      return needsScreen({ cards: results, answers: await loadAnswers(db) });
    }
    if (url.pathname === '/start') {
      if (request.method === 'POST') {
        const form = await request.formData();
        const qid = form.get('qid');
        const all = form.getAll('value');
        const q = QUESTIONS.find(x => x.id === qid);
        try { await saveAnswer(db, qid, q && q.kind === 'multi' ? all : all[0]); }
        catch (e) { return new Response(String(e.message), { status: 400 }); }
        return Response.redirect(new URL('/start', url).toString(), 303);
      }
      const answers = await loadAnswers(db);
      const q = nextQuestion(answers);
      return q ? questionScreen(q, answers) : doneScreen();
    }
    // Code agents and scripts use the same data: GET /api/answers.
    return new Response('ultrastable seed worker\n', { headers: { 'content-type': 'text/plain' } });
  },
};

// The tick sees only whether a secret binding exists, never its value.
function presence(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && v) out[k] = true;
  return out;
}

const lastTick = db => db.prepare(
  `SELECT id, started_at, finished_at, steps_completed, steps_total, report, errors FROM tick_runs ORDER BY id DESC LIMIT 1`).first();
