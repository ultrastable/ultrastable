// Ultrastable seed Worker: the server-side heartbeat for one org.
// Cron fires runTick; GET /health shows the last tick's four-line report.
// Standard issue: first-party web analytics (analytics/analytics.js): /a.js beacon, /a/e collector, GET /api/analytics (bearer ANALYTICS_TOKEN).
import { runTick, lastTickForHealth } from './tick.js';
import { claimsReleasedUnworked24h } from './doer.js';
import { runExecutor, noteExecutor } from './executor.js';
import { runLane, githubBudget } from './lane.js';
import { ingestDeploys } from './selfaudit.js';
import { sampleCosts } from './costsample.js';
import { runGate } from './worker-gate.js';
import { runHandoffs, makeDeployer, makeRollback, makeVersionReader } from './handoff.js';
import { syncIssues } from './issuesync.js';
import { sweepOpenLoops, recordSweep, lastSweep } from './sweeper.js';
import { runSocial } from './social.js';  // REACH-1
import { probe as probeAgents } from './codeagent.js';
import { hiddenByHealthOnly } from './visibility.js';
import config from './config.js';
import { backendRecord } from './errors.js';  // USER-BACKEND-1
import { governedAI, budgetView, SHARES, halted } from './budget.js';
import { pruneAll } from './retention.js';
import { seal, verify, trace, head, r2Sink, githubSink, archiveRows } from './auditchain.js';  // AUDIT-CHAIN-1
import { bearerOk } from './auditauth.js';  // RETENTION-1  // SPEND-GOVERNOR-1: every model call goes through the owner's monthly budget
import { handleAuth } from './auth/routes.js';
import { getToken, refreshDue, pathGuard } from './auth/index.js';
import { checkRepoAccess, readRepoAccess } from './auth/access.js';
import { readCriticality, addSample } from './criticality.js';
import { watchGithub } from './watchdog.js';
import { beat, watch, readPulse, HEAVY_CADENCE_MIN } from './pulse.js';
import { decide, healthView, readState } from './cutover.js';
import { readIgnition } from './ignition.js';
import { loopHealth } from './critloop.js';
import { routeEvent, verifySignature, EVENT_TABLE } from './events.js';
import { loadAnswers, saveAnswer, nextQuestion, QUESTIONS } from './interview.js';
import { nowScreen, nextScreen, needsScreen, questionScreen, doneScreen } from './ui.js';
import { handleAnalytics, selfcheck, report, REPORT_CACHE_MINUTES } from '../../analytics/analytics.js';
import { createAgenticHandler, DEFAULT_IDENTITY } from './agentic/handler.js';
import { d1Store } from './agentic/adapters/d1-store.js';
import { staticRegistries } from './agentic/adapters/memory.js';
import { bearerAuth } from './agentic/adapters/bearer-auth.js';
import { consoleTelemetry } from './agentic/adapters/console-telemetry.js';

// SPEND-GOVERNOR-1: one metered AI handle per invocation. When the governor itself fails, the tick runs with no model (fail closed on cost).
// D1-LIMIT-503 (2026-11-16): on the free plan D1 refuses every query once the day's read allowance is used. A route that reads D1 answers
// 503 with a machine-readable code instead of throwing (error 1101), the same shape as the site's /api/v1/status.
export const d1Unavailable = (e) => {
  const msg = String(e && e.message || e);
  const limit = /daily row read limit|exceeded D1|7500/i.test(msg);
  backendRecord(e, 'd1-unavailable');  // USER-BACKEND-1: the detail goes to the log, not to the caller
  return Response.json(limit ? { error: 'the daily database read allowance is used up; live data returns at 00:00 UTC', code: 'd1_read_limit' } : { error: 'database unavailable', code: 'd1_unavailable' }, { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '600' } });
};
const aiFor = (env) => halted(config, env) ? Promise.resolve({ ai: null, state: { mode: 'halted', why: 'HALT-1' } }) : governedAI(env.DB, env.AI || null, { config, env, share: SHARES.tick }).catch(e => { console.error('budget governor', e && e.message); return { ai: null, state: null }; });
const hosts = env => (env.ANALYTICS_HOSTS ? String(env.ANALYTICS_HOSTS).split(',') : [env.PUBLIC_HOST || config.org_slug + '.example']).map(h => h.trim());

const LOOP_PHASE = { executor: 0, gate: 1, lane: 1, handoffs: 2, issuesync: 2, 'repo-access': 2, sweeper: 3, 'deploy-evidence': 3, social: 3, 'watchdog-gh': 3 };  // SUBREQUEST-ROTATION-2: executor alone, four phases

// AUDIT-CHAIN-1: archive sinks, every one that is available. R2 when the AUDIT bucket is bound; the repository as the independent second copy.
const auditSinks = (env, token, repos) => [...(env.AUDIT ? [r2Sink(env.AUDIT)] : []), ...(token && (env.AUDIT_REPO || repos[0]) ? [githubSink({ token, repo: env.AUDIT_REPO || (repos.find(r => r.endsWith('/ops')) || repos[0]), prefix: 'ledger/' })] : [])];

export default {
  async scheduled(_event, env, ctx) {
    if (halted(config, env)) { ctx.waitUntil(beat(env.DB, 'halted', async () => ({ halted: true })).catch(e => console.error('halted beat', e && e.message))); return; }  // HALT-1: no loops, lane, executor, deploys or model calls
    // ACCOUNT-SPLIT-2: decide first whether this account's tick runs the loops (one primary across both Cloudflare accounts).
    const tenantId = env.TENANT || config.org_slug || 'default';
    const githubOk = async () => { const t = await getToken(env.DB, env, tenantId, 'github-app').catch(() => null); return Boolean((t && t.ok && t.token) || env.GITHUB_TOKEN); };
    const cut = await decide(env.DB, env, { githubOk }).catch(e => ({ run: (env.SLOT || 'primary') !== 'standby', notes: ['cutover check failed: ' + String(e && e.message).slice(0, 160)] }));
    await beat(env.DB, 'cutover', async () => ({ run: cut.run, slot: cut.slot, epoch: cut.epoch, promoted: Boolean(cut.promoted), notes: cut.notes })).catch(e => console.error('cutover beat', e && e.message));
    if (!cut.run) { if (env.SLOT === 'standby' || cut.slot !== 'primary') ctx.waitUntil(refreshDue(env.DB, env).catch(() => null)); return; }
    const gov = await aiFor(env);
    if (gov.state) console.log('budget', JSON.stringify({ mode: gov.state.mode, why: gov.state.why, neurons_today: Math.round(gov.state.usage.ai_neurons_today), cap: gov.state.allowance.ai_neurons_day }));
    ctx.waitUntil(runTick(env.DB, { config, env: presence(env), ai: gov.ai, budget: gov.state }));  // DOER-1: the AI binding reaches the in-tick doer
    // LOOPPROOF-1: every loop below runs inside beat(): a row before it starts, its result or error after. One loop failing never stops the next,
    // and the tick's pulse step counts the slots each one ran in. The names are pulse.js LANE_LOOPS.
    ctx.waitUntil((async () => {
      // SUBREQUEST-ROTATION-1: three groups share the 50 subrequests of a Free-plan invocation, one group per tick (pulse.js HEAVY_LOOPS, every 30 min each).
      const phase = Math.floor((Number(_event && _event.scheduledTime) || Date.now()) / 600e3) % 4;
      const b = (loop, fn) => (loop in LOOP_PHASE && LOOP_PHASE[loop] !== phase) ? Promise.resolve(undefined) : beat(env.DB, loop, fn, { everyMin: loop in LOOP_PHASE ? HEAVY_CADENCE_MIN : 10 }).then(r => { console.log(loop, JSON.stringify(r === undefined ? null : r)); return r; });
      const tenant = env.TENANT || config.org_slug || 'default';
      const repos = config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []);
      const main = repos.find(r => r.endsWith('/ultrastable')) || repos[0];
      await b('credentials', () => refreshDue(env.DB, env));  // AUTH-1: refresh runs first so nothing lapses
      const t = await getToken(env.DB, env, tenant, 'github-app').catch(e => ({ ok: false, error: e && e.message }));  // one token for the lane and the executor, minted from the GitHub App (a bound GITHUB_TOKEN is only a fallback)
      const token = (t && t.ok && t.token) || env.GITHUB_TOKEN || '';
      await b('executor', async () => { const r = await runExecutor({ ...env, AI: gov.ai || undefined, GITHUB_DISPATCH_TOKEN: token || env.GITHUB_DISPATCH_TOKEN, GITHUB_REPO: env.GITHUB_REPO || repos[0] }); await noteExecutor(env.DB, r); return r; });
      await b('gate', () => runGate({ token, repos }));  // ZERO-MINUTES-1
      const ghBudget = githubBudget(env.GITHUB_CALLS_PER_TICK || config.github_calls_per_tick);  // GITHUB-BUDGET-1: one GitHub call budget for the lane and the handoffs of this tick (default 40)
      await b('lane', () => runLane({ token, repos, issueWorkflow: null, zeroActions: env.ZERO_ACTIONS === '1', evidenceRepo: env.EVIDENCE_REPO || repos[0] || null, budget: ghBudget }));
      const site = env.SITE && env.INTERNAL_DEPLOY_KEY ? env.SITE : null;  // HANDOFF-1: the server owns every handed-off PR after it opens: merge noticed, deploy, live probe, close or roll back
      await b('handoffs', () => runHandoffs({ db: env.DB, token, repos, deployer: site ? makeDeployer({ token, site, key: env.INTERNAL_DEPLOY_KEY }) : null, rollback: site ? makeRollback({ site, key: env.INTERNAL_DEPLOY_KEY }) : null, versionOf: site ? makeVersionReader({ site, key: env.INTERNAL_DEPLOY_KEY }) : null, budget: ghBudget }));  // DEPLOY-VERSION-1
      await b('issuesync', () => syncIssues({ db: env.DB, token, repo: main }));  // ISSUESYNC-1: filed roadmap items reach the queue on the server, no Actions needed
      await b('repo-access', () => checkRepoAccess(env.DB, env, tenant, repos, { token, origin: env.PUBLIC_ORIGIN || '' }));  // REPO-ACCESS-1
      await b('social', () => runSocial({ db: env.DB, env, tenant }));  // REACH-1: posts the due calendar item to the channels linked at /connect
      await b('sweeper', async () => { const sw = await sweepOpenLoops({ token, repos }); await recordSweep(env.DB, sw); return sw; });  // SERVER-OWNS-LOOPS-1
      await b('deploy-evidence', () => ingestDeploys(env.DB, { token, repo: repos.find(r => r.endsWith('/ultrastable')) }));  // SELFAUDIT-1: independent deploy evidence feeds k_eff
      await b('watchdog-gh', () => watchGithub({ token, repo: main }));  // RESILIENCE-1: the Worker restarts the GitHub watchdog when it stalls; the GitHub watchdog restarts this tick
      await b('cost-samples', async () => ({ samples: await sampleCosts(env.DB, { token: env.CF_ANALYTICS_TOKEN, budgets: config.cost_budgets }), retention: await pruneAll(env.DB, { rules: config.retention, archive: (table, rows) => archiveRows(env.DB, table)(rows) }), audit: await seal(env.DB, auditSinks(env, token, repos)) }));  // AUDIT-CHAIN-1: aged rows are chained, then sealed to the archive  // RETENTION-1: the daily prune rides the hourly cost beat (once a day by its own gate)  // COSTGUARD-1: hourly D1 rows-read sample feeds the D1 budget failure modes
    })().catch(e => console.error('lane', e && e.message)));
    ctx.waitUntil(beat(env.DB, 'analytics-selfcheck', () => selfcheck(env, hosts(env)[0])));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pg = pathGuard(request); if (pg) return pg;  // Q-LESSON-CRED-SCOPE: //x, /x/ and /x%2Fy never reach a route as themselves
    if (hiddenByHealthOnly(env, request.method, url.pathname)) return new Response('Not found', { status: 404 });
    const au = await handleAuth(request, env, { tenant: env.TENANT || config.org_slug || 'default', name: config.org_slug, repos: config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []) });
    if (au) return au;
    if (halted(config, env) && (url.pathname === '/hook/github' || url.pathname === '/pulse/watch')) return Response.json({ halted: true }, { status: 202 });  // HALT-1
    if (url.pathname === '/hook/github' && request.method === 'POST') {  // event-driven trigger: signed GitHub webhook wakes a role now
      const body = await request.text();
      if (!(await verifySignature(env.GITHUB_WEBHOOK_SECRET, body, request.headers.get('x-hub-signature-256')))) return Response.json({ error: 'bad signature' }, { status: 401 });
      const hit = routeEvent(request.headers.get('x-github-event'), JSON.parse(body || '{}'), EVENT_TABLE);
      if (!hit) return Response.json({ routed: false }, { status: 202 });
      const work = aiFor(env).then(g => runTick(env.DB, { config, env: presence(env), wake: hit.role, ai: g.ai, budget: g.state }));
      if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
      return Response.json({ routed: true, ...hit }, { status: 202 });
    }
    // Agent-facing surfaces (MCP, discovery documents) are registered in seed/standards/surfaces.json.
    const agentic = createAgenticHandler({
      store: d1Store(env.DB), registries: staticRegistries(config.registries || {}), auth: bearerAuth, telemetry: consoleTelemetry,
      identity: { ...DEFAULT_IDENTITY, slug: config.org_slug, name: config.org_slug },
    });
    if (url.pathname === '/api/audit/head') { try { return Response.json(await head(env.DB), { headers: { 'cache-control': 'no-store' } }); } catch (e) { return d1Unavailable(e); } }  // public: the hash anyone can write down to anchor the trail
    if (url.pathname === '/api/audit/verify' || url.pathname === '/api/audit/trace') {  // owner-only (bearer ANALYTICS_TOKEN or INTERNAL_DEPLOY_KEY)
      if (!bearerOk(request, env)) return Response.json({ error: 'unauthorized' }, { status: 401 });
      try {
        const q = url.searchParams, t = await getToken(env.DB, env, env.TENANT || config.org_slug || 'default', 'github-app').catch(() => null), sinks = auditSinks(env, (t && t.ok && t.token) || env.GITHUB_TOKEN || '', config.github_repos || []);
        const r = url.pathname.endsWith('verify') ? await verify(env.DB, sinks, { deep: q.get('deep') === '1', fromSeq: Number(q.get('from_seq')) || 0 })
          : await trace(env.DB, sinks, { ref: q.get('ref') || undefined, kind: q.get('kind') || undefined, from: Number(q.get('from')) || 0, to: Number(q.get('to')) || undefined, limit: q.get('limit') });
        return Response.json(r, { headers: { 'cache-control': 'no-store' } });
      } catch (e) { return d1Unavailable(e); }
    }
    if (url.pathname === '/api/budget') { try { return Response.json(await budgetView(env.DB, { config, env }), { headers: { 'cache-control': 'no-store' } }); } catch (e) { return d1Unavailable(e); } }  // SPEND-GOVERNOR-1: the knob, what it buys, what was used, the mode
    const ag = await agentic(request, env);
    if (ag) return ag;
    const an = await handleAnalytics(request, env, { hosts: hosts(env) });
    if (an) return an;
    if (url.pathname === '/api/analytics') {
      if (!env.ANALYTICS_TOKEN || request.headers.get('authorization') !== 'Bearer ' + env.ANALYTICS_TOKEN) return Response.json({ error: 'unauthorized' }, { status: 401 });
      return Response.json(await report(env, undefined, { cacheMinutes: REPORT_CACHE_MINUTES }));
    }
    if (url.pathname === '/agents/probe') { const r = await probeAgents({ ...env, AI: (await aiFor(env)).ai || undefined });  /* SPEND-GOVERNOR-1: a public route; never the raw binding */ return Response.json(r, { status: r.ok ? 200 : 503 }); }
    if (url.pathname === '/pulse/watch' && request.method === 'POST' && (await readState(env.DB, env).catch(() => ({ slot: env.SLOT || 'primary' }))).slot !== 'primary') return Response.json({ ok: true, skipped: 'not the primary account (ACCOUNT-SPLIT-2)' }, { headers: { 'cache-control': 'no-store' } });
    if (url.pathname === '/pulse/watch' && request.method === 'POST') {  // LOOPPROOF-1: the second producer of the heartbeat. Safe to call by anyone: it runs a tick only when the newest one is older than two intervals
      const r = await watch(env.DB, async () => { const g = await aiFor(env); return runTick(env.DB, { config, env: presence(env), ai: g.ai, budget: g.state }); }, { config }).catch(e => ({ ok: false, error: String(e && e.message).slice(0, 200) }));
      return Response.json(r, { status: r.ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/health') {
      if (halted(config, env)) return Response.json({ ok: true, halted: true, org: config.org_slug, why: 'HALT-1: the owner stopped every loop; pages keep serving' });
      let last; try { last = await lastTickForHealth(env.DB); } catch (e) { return d1Unavailable(e); }
      const ok = Boolean(last && last.steps_completed === last.steps_total);
      const released = await claimsReleasedUnworked24h(env.DB, Date.now()).catch(() => null);  // workers#173 closing probe, target 0
      const cutover = await healthView(env.DB, env).catch(() => null);  // ACCOUNT-SPLIT-2: read by the peer account's tick every beat
      return Response.json({ ok, org: config.org_slug, last_tick: last || null, claims_released_unworked_24h: released, cutover }, { status: ok || (cutover && cutover.slot !== 'primary') ? 200 : 503 });
    }
    if (url.pathname === '/live' || url.pathname === '/metrics/criticality.json') {  // CRITICALITY-1: k_eff of the last tick
      const c = await readCriticality(env.DB);
      return Response.json(url.pathname === '/live' ? { ok: true, org: config.org_slug, k_eff: c ? c.k_eff : null, open_ignition_gaps: c && c.open_ignition_gaps !== undefined ? c.open_ignition_gaps : null, self_sustaining: c ? Boolean(c.self_sustaining) : false, criticality: c, criticality_loop: await loopHealth(env.DB, config.criticality, Date.now()).catch(() => null), ignition: await readIgnition(env.DB).catch(() => null), pulse: await readPulse(env.DB).catch(() => null), sweeper: await lastSweep(env.DB).catch(() => null), repo_access: await readRepoAccess(env.DB).catch(() => null) } : { ...(c || {}), loop: await loopHealth(env.DB, config.criticality, Date.now()).catch(() => null) }, { headers: { 'cache-control': 'no-store' } });
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
  // Service bindings are not secrets: the measure step's `service` metric source fetches through them (M-tenants-selftest read 0 while
  // presence() reduced env to string flags and dropped TENANTS).
  for (const [k, v] of Object.entries(env)) if (v && typeof v === 'object' && typeof v.fetch === 'function' && !(k in out) && /^[A-Z][A-Z0-9_]*$/.test(k)) out[k] = v;
  return out;
}

const lastTick = db => db.prepare(
  `SELECT id, started_at, finished_at, steps_completed, steps_total, report, errors FROM tick_runs ORDER BY id DESC LIMIT 1`).first();
