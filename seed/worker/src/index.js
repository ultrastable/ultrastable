// Ultrastable seed Worker: the server-side heartbeat for one org.
// Cron fires runTick; GET /health shows the last tick's four-line report.
// Standard issue: first-party web analytics (analytics/analytics.js): /a.js beacon, /a/e collector, GET /api/analytics (bearer ANALYTICS_TOKEN).
import { runTick, lastTickForHealth } from './tick.js';
import { claimsReleasedUnworked24h } from './doer.js';
import { runExecutor, noteExecutor } from './executor.js';
import { runLane } from './lane.js';
import { ingestDeploys } from './selfaudit.js';
import { sampleCosts } from './costsample.js';
import { runGate } from './worker-gate.js';
import { runHandoffs, makeDeployer, makeRollback } from './handoff.js';
import { syncIssues } from './issuesync.js';
import { sweepOpenLoops, recordSweep, lastSweep } from './sweeper.js';
import { probe as probeAgents } from './codeagent.js';
import { hiddenByHealthOnly } from './visibility.js';
import config from './config.js';
import { handleAuth } from './auth/routes.js';
import { getToken, refreshDue } from './auth/index.js';
import { checkRepoAccess, readRepoAccess } from './auth/access.js';
import { readCriticality, addSample } from './criticality.js';
import { beat, readIgnition, watchPulse } from './pulse.js';
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
    ctx.waitUntil(runTick(env.DB, { config, env: presence(env), ai: env.AI || null }));  // DOER-1: the AI binding reaches the in-tick doer
    // PULSE-1: every loop leaves a beat (started, finished, ok, evidence) and is isolated, so one failing loop cannot starve the ones after it
    // and a loop that was cut off or never started is visible to the tick's selfknow step as an unfinished or missing row.
    ctx.waitUntil((async () => {
      const db = env.DB, tenant = env.TENANT || config.org_slug || 'default';
      const repos = config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []);
      const main = repos.find(r => r.endsWith('/ultrastable')) || repos[0];
      let token = env.GITHUB_TOKEN || '';
      await beat(db, 'credentials', async () => {  // AUTH-1: one token for the lane and the executor, minted from the GitHub App (a bound GITHUB_TOKEN is only a fallback); refresh runs first so nothing lapses
        await refreshDue(db, env);
        const t = await getToken(db, env, tenant, 'github-app');
        if (t && t.ok && t.token) token = t.token;
        return { ok: Boolean(token), source: t && t.ok ? 'github-app' : token ? 'bound-token' : 'none', ...(token ? {} : { error: (t && t.error) || 'no token' }) };
      });
      await beat(db, 'executor', async () => { const r = await runExecutor({ ...env, GITHUB_DISPATCH_TOKEN: token || env.GITHUB_DISPATCH_TOKEN, GITHUB_REPO: env.GITHUB_REPO || repos[0] }); await noteExecutor(db, r); return r; });
      await beat(db, 'gate', () => runGate({ token, repos }));  // ZERO-MINUTES-1
      await beat(db, 'lane', () => runLane({ token, repos, issueWorkflow: null, zeroActions: env.ZERO_ACTIONS === '1', evidenceRepo: env.EVIDENCE_REPO || repos[0] || null }));
      const site = env.SITE && env.INTERNAL_DEPLOY_KEY ? env.SITE : null;  // HANDOFF-1: the server owns every handed-off PR after it opens: merge noticed, deploy, live probe, close or roll back
      await beat(db, 'handoffs', () => runHandoffs({ db, token, repos, deployer: site ? makeDeployer({ token, site, key: env.INTERNAL_DEPLOY_KEY }) : null, rollback: site ? makeRollback({ site, key: env.INTERNAL_DEPLOY_KEY }) : null }));
      await beat(db, 'issuesync', () => syncIssues({ db, token, repo: main }));  // ISSUESYNC-1: filed roadmap items reach the queue on the server, no Actions needed
      await beat(db, 'repo-access', async () => { const r = await checkRepoAccess(db, env, tenant, repos, { token, origin: env.PUBLIC_ORIGIN || '' }); return { ok: r.ok, covered: (r.covered || []).length, missing: r.missing || [] }; });  // REPO-ACCESS-1: missing access is a result (its own gate card), not a failed run
      await beat(db, 'sweeper', async () => { const sw = await sweepOpenLoops({ token, repos }); await recordSweep(db, sw); return sw; });  // SERVER-OWNS-LOOPS-1
      await beat(db, 'deploy-evidence', () => ingestDeploys(db, { token, repo: repos.find(r => r.endsWith('/ultrastable')) }));  // SELFAUDIT-1: independent deploy evidence feeds k_eff
      await beat(db, 'cost-samples', () => sampleCosts(db, { token: env.CF_ANALYTICS_TOKEN, budgets: config.cost_budgets }));  // COSTGUARD-1: hourly D1 rows-read sample feeds the D1 budget failure modes
    })().catch(e => console.error('lane', e && e.message)));
    ctx.waitUntil(beat(env.DB, 'analytics-selfcheck', () => selfcheck(env, hosts(env)[0])));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (hiddenByHealthOnly(env, request.method, url.pathname)) return new Response('Not found', { status: 404 });
    const au = await handleAuth(request, env, { tenant: env.TENANT || config.org_slug || 'default', name: config.org_slug, repos: config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []) });
    if (au) return au;
    if (url.pathname === '/hook/github' && request.method === 'POST') {  // event-driven trigger: signed GitHub webhook wakes a role now
      const body = await request.text();
      if (!(await verifySignature(env.GITHUB_WEBHOOK_SECRET, body, request.headers.get('x-hub-signature-256')))) return Response.json({ error: 'bad signature' }, { status: 401 });
      const hit = routeEvent(request.headers.get('x-github-event'), JSON.parse(body || '{}'), EVENT_TABLE);
      if (!hit) return Response.json({ routed: false }, { status: 202 });
      const work = runTick(env.DB, { config, env: presence(env), wake: hit.role, ai: env.AI || null });
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
      const released = await claimsReleasedUnworked24h(env.DB, Date.now()).catch(() => null);  // workers#173 closing probe, target 0
      return Response.json({ ok, org: config.org_slug, last_tick: last || null, claims_released_unworked_24h: released }, { status: ok ? 200 : 503 });
    }
    if (url.pathname === '/internal/pulse') {  // PULSE-1: an outside watcher's call; a stale clock is restarted on the spot
      const r = await watchPulse(env.DB, config, String(url.searchParams.get('from') || '').slice(0, 30), () => runTick(env.DB, { config, env: presence(env), ai: env.AI || null }));
      return Response.json(r, { status: r.ok ? 200 : 503 });
    }
    if (url.pathname === '/api/ignition') return Response.json({ ok: true, org: config.org_slug, ...(await readIgnition(env.DB)) });  // PULSE-1: bootstrapped? critical? which stage blocks?
    if (url.pathname === '/live' || url.pathname === '/metrics/criticality.json') {  // CRITICALITY-1: k_eff of the last tick
      const c = await readCriticality(env.DB);
      return Response.json(url.pathname === '/live' ? { ok: true, org: config.org_slug, k_eff: c ? c.k_eff : null, open_ignition_gaps: c && c.open_ignition_gaps !== undefined ? c.open_ignition_gaps : null, self_sustaining: c ? Boolean(c.self_sustaining) : false, criticality: c, ignition: (await readIgnition(env.DB).catch(() => ({}))).ignition || null, sweeper: await lastSweep(env.DB).catch(() => null), repo_access: await readRepoAccess(env.DB).catch(() => null) } : (c || {}), { headers: { 'cache-control': 'no-store' } });
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
