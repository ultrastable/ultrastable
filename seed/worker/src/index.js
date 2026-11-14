// Ultrastable seed Worker: the server-side heartbeat for one org.
// Cron fires runTick; GET /health shows the last tick's four-line report.
// Standard issue: first-party web analytics (analytics/analytics.js): /a.js beacon, /a/e collector, GET /api/analytics (bearer ANALYTICS_TOKEN).
import { runTick, lastTickForHealth } from './tick.js';
import { runExecutor, noteExecutor } from './executor.js';
import { runLane } from './lane.js';
import { ingestDeploys } from './selfaudit.js';
import { sampleCosts } from './costsample.js';
import { sweepOpenLoops, recordSweep, lastSweep } from './sweeper.js';
import { runRoleWork, githubFileExists, aiNamer } from './work.js';
import { controlPlane } from './controlplane.js';
import { probe as probeAgents } from './codeagent.js';
import { hiddenByHealthOnly } from './visibility.js';
import config from './config.js';
import { handleAuth } from './auth/routes.js';
import { getToken, refreshDue } from './auth/index.js';
import { checkRepoAccess, readRepoAccess } from './auth/access.js';
import { readCriticality, addSample } from './criticality.js';
import { routeEvent, verifySignature, EVENT_TABLE } from './events.js';
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
    ctx.waitUntil((async () => {  // AUTH-1: one token for the lane and the executor, minted from the GitHub App (a bound GITHUB_TOKEN is only a fallback); refresh runs first so nothing lapses
      const tenant = env.TENANT || config.org_slug || 'default';
      await refreshDue(env.DB, env).catch(e => console.error('credentials', e && e.message));
      const t = await getToken(env.DB, env, tenant, 'github-app').catch(e => ({ ok: false, error: e && e.message }));
      const token = (t && t.ok && t.token) || env.GITHUB_TOKEN || '';
      const r = await runExecutor({ ...env, GITHUB_DISPATCH_TOKEN: token || env.GITHUB_DISPATCH_TOKEN }); console.log('executor', JSON.stringify(r)); await noteExecutor(env.DB, r);
      const l = await runLane({ token, repos: config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []), issueWorkflow: null }); console.log('lane', JSON.stringify(l));
      const repos = config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []);
      const ra = await checkRepoAccess(env.DB, env, tenant, repos, { token, origin: env.PUBLIC_ORIGIN || '' }).catch(e => ({ ok: false, error: e && e.message })); console.log('repo-access', JSON.stringify(ra));  // REPO-ACCESS-1
      const rw = await runRoleWork(env.DB, { fileExists: githubFileExists({ token, repo: env.GITHUB_REPO || repos.find(r => r.endsWith('/ultrastable')) || repos[0] }), namer: aiNamer(env) }).catch(e => ({ error: e && e.message })); console.log('role-work', JSON.stringify(rw));  // ROLE-WORK-1: roles consume their dispatches
      const sw = await sweepOpenLoops({ token, repos: config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []) }); console.log('sweeper', JSON.stringify(sw)); await recordSweep(env.DB, sw);  // SERVER-OWNS-LOOPS-1
      const dep = await ingestDeploys(env.DB, { token, repo: repos.find(r => r.endsWith('/ultrastable')) }).catch(e => ({ status: 'error ' + (e && e.message) })); console.log('deploy-evidence', JSON.stringify(dep));  // SELFAUDIT-1: independent deploy evidence feeds k_eff
      const cs = await sampleCosts(env.DB, { token: env.CF_ANALYTICS_TOKEN, budgets: config.cost_budgets }).catch(e => [{ error: e && e.message }]); console.log('cost-samples', JSON.stringify(cs));  // COSTGUARD-1: hourly D1 rows-read sample feeds the D1 budget failure modes
    })().catch(e => console.error('lane', e && e.message)));
    ctx.waitUntil(selfcheck(env, hosts(env)[0]).catch(e => console.error('analytics selfcheck', e && e.message)));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (hiddenByHealthOnly(env, request.method, url.pathname)) return new Response('Not found', { status: 404 });
    const cp = await controlPlane(request, env, { org: config.org_slug || 'org' });  // CONTROL-PLANE-1: /api/v1/* and /ops
    if (cp) return cp;
    const au = await handleAuth(request, env, { tenant: env.TENANT || config.org_slug || 'default', name: config.org_slug, repos: config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []) });
    if (au) return au;
    if (url.pathname === '/hook/github' && request.method === 'POST') {  // event-driven trigger: signed GitHub webhook wakes a role now
      const body = await request.text();
      if (!(await verifySignature(env.GITHUB_WEBHOOK_SECRET, body, request.headers.get('x-hub-signature-256')))) return Response.json({ error: 'bad signature' }, { status: 401 });
      const hit = routeEvent(request.headers.get('x-github-event'), JSON.parse(body || '{}'), EVENT_TABLE);
      if (!hit) return Response.json({ routed: false }, { status: 202 });
      const work = runTick(env.DB, { config, env: presence(env), wake: hit.role });
      if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
      return Response.json({ routed: true, ...hit }, { status: 202 });
    }
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
    if (url.pathname === '/agents/probe') { const r = await probeAgents(env); return Response.json(r, { status: r.ok ? 200 : 503 }); }
    if (url.pathname === '/health') {
      const last = await lastTickForHealth(env.DB);
      const ok = Boolean(last && last.steps_completed === last.steps_total);
      return Response.json({ ok, org: config.org_slug, last_tick: last || null }, { status: ok ? 200 : 503 });
    }
    if (url.pathname === '/live' || url.pathname === '/metrics/criticality.json') {  // CRITICALITY-1: k_eff of the last tick
      const c = await readCriticality(env.DB);
      return Response.json(url.pathname === '/live' ? { ok: true, org: config.org_slug, k_eff: c ? c.k_eff : null, criticality: c, sweeper: await lastSweep(env.DB).catch(() => null), repo_access: await readRepoAccess(env.DB).catch(() => null) } : (c || {}), { headers: { 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/api/criticality/sample' && request.method === 'POST') {  // collectors push GitHub-run, cost and owner-touch samples
      if (!env.CRITICALITY_TOKEN || request.headers.get('authorization') !== 'Bearer ' + env.CRITICALITY_TOKEN) return Response.json({ error: 'unauthorized' }, { status: 401 });
      await addSample(env.DB, await request.json(), new Date().toISOString().replace('T', ' ').slice(0, 19));
      return Response.json({ ok: true }, { status: 202 });
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
