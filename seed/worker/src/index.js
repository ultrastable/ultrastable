// Ultrastable seed Worker: the server-side heartbeat for one org.
// Cron fires runTick; GET /health shows the last tick's four-line report.
// Standard issue: first-party web analytics (analytics/analytics.js): /a.js beacon, /a/e collector, GET /api/analytics (bearer ANALYTICS_TOKEN).
import { paced } from './pace.js';
import { withKnobs, readGoals, registerTenant, reportReadings, knobValues } from './goals.js';  // GOALS-1
import { tune } from './roi.js';  // BOUNDARIES-1
import { runTick, lastTickForHealth, METRICS, ensureItem } from './tick.js';
import { claimsReleasedUnworked24h } from './doer.js';
import { runExecutor, noteExecutor } from './executor.js';
import { runLane, githubBudget } from './lane.js';
import { verifyOidc, commitToMain } from './maincommit.js';  // MAIN-WRITER-1
import { opsBackup } from './opsbackup.js';  // BACKUP-SINK-1
import { createMeter, guarded, readDeferred, writeDeferred } from './subreq.js';  // SUBREQUEST-METER-1
import { ingestDeploys } from './selfaudit.js';
import { sampleCosts } from './costsample.js';
import { readRoi } from './roi.js';  // ROI-1
import { sampleFreeTier, freeTierLevel, alertFreeTier } from './freetier.js';  // FREE-TIER-1
import { runGate, gateCard } from './worker-gate.js';
import { runHandoffs, makeDeployer, makeRollback, makeVersionReader } from './handoff.js';
import { syncIssues } from './issuesync.js';
import { sweepOpenLoops, recordSweep, lastSweep } from './sweeper.js';
import { refreshLiveChanges, readLiveChanges, refreshFleetChanges } from './livechanges.js'; // LIVE-FRESH-1
import { progressStep, readProgress } from './progress.js'; // PROGRESS-1
import { watchFreshness } from './freshness.js'; // LIVE-FRESH-2
import { recordGovernor, readDecisions, safely as decisionSafely } from './decisions.js'; // DECISIONS-1
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
import { getToken, refreshDue, pathGuard, ownerActs } from './auth/index.js';
import { checkRepoAccess, readRepoAccess } from './auth/access.js';
import { readCriticality, addSample } from './criticality.js';
import { watchGithub } from './watchdog.js';
import { material as credMaterial } from './auth/store.js';  // HOSTS-1: the App's own webhook secret verifies its deliveries
import { createHosts, cloudflareHost, githubActionsHost, gcpHost, reporting, onPush, onWorkflowRun, onHostEvent, watchHosts, recordHostEvent, hookSecret, reconcileHooks, githubHookSecrets, verifyAny } from './hosts.js';  // HOSTS-1
import { beat, watch, readPulse, failed, HEAVY_CADENCE_MIN } from './pulse.js';
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

const LOOP_PHASE = { executor: 0, gate: 1, lane: 1, handoffs: 2, issuesync: 2, 'repo-access': 2, sweeper: 3, 'deploy-evidence': 3, social: 3, 'watchdog-gh': 3, hosts: 0, 'host-hooks': 0 };  // SUBREQUEST-ROTATION-2: four phases; HOSTS-1 probes (2-3 calls) ride with the executor, they hit the 50-subrequest cap when run every tick after the heavy groups

// AUDIT-CHAIN-1: archive sinks, every one that is available. R2 when the AUDIT bucket is bound; the repository as the independent second copy.
const auditSinks = (env, token, repos) => [...(env.AUDIT ? [r2Sink(env.AUDIT)] : []), ...(token && (env.AUDIT_REPO || repos[0]) ? [githubSink({ token, repo: env.AUDIT_REPO || (repos.find(r => r.endsWith('/ops')) || repos[0]), prefix: 'ledger/' })] : [])];

function hostRegistry(env, token, repo) {  // HOSTS-1: every host that can run this system, one interface, failover in this order
  const site = env.SITE && env.INTERNAL_DEPLOY_KEY ? env.SITE : null;
  const versionOf = site ? makeVersionReader({ site, key: env.INTERNAL_DEPLOY_KEY }) : null;
  const deployer = site ? reporting(makeDeployer({ token, site, key: env.INTERNAL_DEPLOY_KEY }), { token }) : null;
  const list = [cloudflareHost({ site, key: env.INTERNAL_DEPLOY_KEY, deployer, versionOf }), githubActionsHost({ token, repo })];
  if (env.GCP_ADAPTER_URL) list.push(gcpHost({ url: env.GCP_ADAPTER_URL, token: env.GCP_TICK_TOKEN }));
  return createHosts(list, { db: env.DB });
}

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
    const meter = createMeter(), restoreFetch = meter.install();  // SUBREQUEST-METER-1: every fetch of this invocation is counted; one cap for the tick steps and the loops
    const tickDone = runTick(env.DB, { config, env: presence(env), ai: gov.ai, budget: gov.state }).catch(e => console.error('tick', e && e.message));  // DOER-1: the AI binding reaches the in-tick doer
    ctx.waitUntil(tickDone);
    // LOOPPROOF-1: every loop below runs inside beat(): a row before it starts, its result or error after. One loop failing never stops the next,
    // and the tick's pulse step counts the slots each one ran in. The names are pulse.js LANE_LOOPS.
    const loopsDone = (async () => {
      // SUBREQUEST-ROTATION-1: three groups share the 50 subrequests of a Free-plan invocation, one group per tick (pulse.js HEAVY_LOOPS, every 30 min each).
      const phase = Math.floor((Number(_event && _event.scheduledTime) || Date.now()) / 600e3) % 4;
      const cycle = Math.floor((Number(_event && _event.scheduledTime) || Date.now()) / (HEAVY_CADENCE_MIN * 60e3));
      // PACE-2: a heavy loop whose recent runs returned nothing skips cycles (pace.js); the skipped slot is still a beat, so the clock sees a decision.
      const knobConfig = await withKnobs(env.DB, config);  // GOALS-1: knob values the control loop set (pace.idle_runs, pace.max_stride) are what paced() reads
      const carried = new Set(await readDeferred(env.DB)), deferred = new Set(), guard = guarded(meter, deferred, failed);  // SUBREQUEST-METER-1: a loop that was deferred runs first next time, in any phase
      const tuningNow = await freeTierLevel(env.DB).then(l => (l && l.resources) ? tune(Object.fromEntries(Object.entries(l.resources).map(([k, r]) => [k, r.frac]))) : null).catch(e => { console.error('tuning unread:', e && e.message); return null; });  // BOUNDARIES-1: applied to every paceable loop below
      const b = (loop, fn) => (loop in LOOP_PHASE && LOOP_PHASE[loop] !== phase && !carried.has(loop)) ? Promise.resolve(undefined) : beat(env.DB, loop, async () => (loop in LOOP_PHASE && await paced(env.DB, loop, cycle, knobConfig, tuningNow)) || guard(loop, fn), { everyMin: loop in LOOP_PHASE ? HEAVY_CADENCE_MIN : 10 }).then(r => { console.log(loop, JSON.stringify(r === undefined ? null : r)); return r; });
      const steps = [], step = (loop, fn) => { steps.push([loop, fn]); };
      const tenant = env.TENANT || config.org_slug || 'default';
      const repos = config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []);
      const main = repos.find(r => r.endsWith('/ultrastable')) || repos[0];
      // FREE-TIER-1: the usage sample is read first. It ran last and was starved by the 50-subrequest limit ("Too many subrequests" at 00:10 UTC 2026-11-18), which left the governor without a reading.
      const freeTier = await sampleFreeTier(env.DB, { token: env.CF_ANALYTICS_TOKEN, account_id: (config.cost_budgets && config.cost_budgets[0] && config.cost_budgets[0].account_id) || env.CF_ACCOUNT_ID }).catch(e => ({ error: String(e && e.message).slice(0, 120) }));
      { const al = await alertFreeTier(env.DB, freeTier); if (al.error) console.error('free-tier alert unfiled:', al.error); }  // READ-BUDGET-8: an item is filed once a day per resource when a free limit is projected to pass 70%
      await decisionSafely(() => recordGovernor(env.DB, freeTier));  // DECISIONS-1: the level just set is a decision, scored at a later sample
      await b('credentials', () => refreshDue(env.DB, env));  // AUTH-1: refresh runs first so nothing lapses
      const t = await getToken(env.DB, env, tenant, 'github-app').catch(e => ({ ok: false, error: e && e.message }));  // one token for the lane and the executor, minted from the GitHub App (a bound GITHUB_TOKEN is only a fallback)
      const token = (t && t.ok && t.token) || env.GITHUB_TOKEN || '';
      await b('live-changes', () => refreshLiveChanges({ db: env.DB, token, repo: main }));  // LIVE-FRESH-2: own early step; inside the sweeper it ran after 32 of 46 subrequests were spent and never wrote, so /live froze
      await b('fleet-changes', () => refreshFleetChanges({ db: env.DB, token, repos: ((config.progress || {}).systems || []).map(x => x.repo).filter(r => r && r !== main) }));  // PROGRESS-1: the other repositories, at most hourly each
      await b('progress', () => progressStep({ db: env.DB, config, token, ensureItem }));  // PROGRESS-1: release cadence monitor; a slow system has its producers dispatched, a stalled one files STALL-<system>
      await b('freshness', () => watchFreshness({ token, repo: main, siteUrl: env.PUBLIC_ORIGIN || 'https://ultrastable.io' }));  // LIVE-FRESH-2: a stale published snapshot re-dispatches its own publisher
      step('executor', async () => { const r = await runExecutor({ ...env, TENANT: env.TENANT || config.org_slug, AI: gov.ai || undefined, GITHUB_DISPATCH_TOKEN: token || env.GITHUB_DISPATCH_TOKEN, GITHUB_REPO: env.GITHUB_REPO || repos[0] }); await noteExecutor(env.DB, r); return r; });
      step('gate', async () => { const g = await runGate({ token, repos }); await gateCard(env.DB, g, { origin: env.PUBLIC_ORIGIN || '' }); return g; });  // ZERO-MINUTES-1, Q-GATE-403
      const ghBudget = githubBudget(env.GITHUB_CALLS_PER_TICK || config.github_calls_per_tick);  // GITHUB-BUDGET-1: one GitHub call budget for the lane and the handoffs of this tick (default 40)
      step('lane', () => runLane({ token, repos, issueWorkflow: null, zeroActions: env.ZERO_ACTIONS === '1', evidenceRepo: env.EVIDENCE_REPO || repos[0] || null, budget: ghBudget }));
      const site = env.SITE && env.INTERNAL_DEPLOY_KEY ? env.SITE : null;  // HANDOFF-1: the server owns every handed-off PR after it opens: merge noticed, deploy, live probe, close or roll back
      step('handoffs', () => runHandoffs({ db: env.DB, token, repos, deployer: site ? reporting(makeDeployer({ token, site, key: env.INTERNAL_DEPLOY_KEY }), { token }) : null, rollback: site ? makeRollback({ site, key: env.INTERNAL_DEPLOY_KEY }) : null, versionOf: site ? makeVersionReader({ site, key: env.INTERNAL_DEPLOY_KEY }) : null, budget: ghBudget, tenant: env.TENANT || config.org_slug }));  // DEPLOY-VERSION-1
      step('issuesync', () => syncIssues({ db: env.DB, token, repo: main }));  // ISSUESYNC-1: filed roadmap items reach the queue on the server, no Actions needed
      step('repo-access', () => checkRepoAccess(env.DB, env, tenant, repos, { token, origin: env.PUBLIC_ORIGIN || '' }));  // REPO-ACCESS-1
      step('social', () => runSocial({ db: env.DB, env, tenant }));  // REACH-1: posts the due calendar item to the channels linked at /connect
      step('sweeper', async () => { const sw = await sweepOpenLoops({ token, repos }); await recordSweep(env.DB, sw); return sw; });  // SERVER-OWNS-LOOPS-1
      step('deploy-evidence', () => ingestDeploys(env.DB, { token, repo: repos.find(r => r.endsWith('/ultrastable')) }));  // SELFAUDIT-1: independent deploy evidence feeds k_eff
      step('host-hooks', async () => reconcileHooks({ db: env.DB, token, repos, origin: env.PUBLIC_ORIGIN || 'https://ultrastable.io', secret: await hookSecret(env, 'github') }));  // HOSTS-1: the server creates, repairs and re-checks its own repo webhook; nothing is set up by hand
      step('hosts', () => watchHosts({ db: env.DB, registry: hostRegistry(env, token, main), token, repo: main }));  // HOSTS-1: health probe of every host, stall detection, failover redispatch
      step('watchdog-gh', () => watchGithub({ token, repo: main }));  // RESILIENCE-1: the Worker restarts the GitHub watchdog when it stalls; the GitHub watchdog restarts this tick
      for (const [loop, fn] of [...steps].sort((a, z) => carried.has(z[0]) - carried.has(a[0]))) await b(loop, fn);  // SUBREQUEST-METER-1: deferred loops first, then the phase's own
      await b('cost-samples', async () => ({ free_tier: freeTier, samples: await sampleCosts(env.DB, { token: env.CF_ANALYTICS_TOKEN, budgets: config.cost_budgets }), retention: await pruneAll(env.DB, { rules: config.retention, archive: (table, rows) => archiveRows(env.DB, table)(rows) }), audit: await seal(env.DB, auditSinks(env, token, repos)) }));  // AUDIT-CHAIN-1: aged rows are chained, then sealed to the archive  // RETENTION-1: the daily prune rides the hourly cost beat (once a day by its own gate)  // COSTGUARD-1: hourly D1 rows-read sample feeds the D1 budget failure modes
      const wd = await writeDeferred(env.DB, deferred); if (wd && wd.error) console.error(wd.error);
    })().catch(e => console.error('lane', e && e.message));
    ctx.waitUntil(loopsDone);
    const selfDone = beat(env.DB, 'analytics-selfcheck', () => selfcheck(env, hosts(env)[0])).catch(e => console.error('selfcheck', e && e.message));
    ctx.waitUntil(selfDone);
    ctx.waitUntil(Promise.allSettled([tickDone, loopsDone, selfDone]).then(restoreFetch));  // the counting fetch lives for this invocation only
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pg = pathGuard(request); if (pg) return pg;  // Q-LESSON-CRED-SCOPE: //x, /x/ and /x%2Fy never reach a route as themselves
    if (hiddenByHealthOnly(env, request.method, url.pathname)) return new Response('Not found', { status: 404 });
    const au = await handleAuth(request, env, { tenant: env.TENANT || config.org_slug || 'default', name: config.org_slug, repos: config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []) });
    if (au) return au;
    if (halted(config, env) && (url.pathname === '/hook/github' || url.pathname === '/hook/host' || url.pathname === '/pulse/watch')) return Response.json({ halted: true }, { status: 202 });  // HALT-1
    if (url.pathname === '/hook/github' && request.method === 'POST') {  // event-driven trigger: signed GitHub webhook wakes a role now
      const body = await request.text();
      if (!(await verifyAny(verifySignature, await githubHookSecrets(env, () => credMaterial(env.DB, env, env.TENANT || config.org_slug || 'default', 'github-app')), body, request.headers.get('x-hub-signature-256')))) return Response.json({ error: 'bad signature' }, { status: 401 });
      const ev = request.headers.get('x-github-event'), payload = JSON.parse(body || '{}');
      if (ev === 'push' || ev === 'workflow_run') {  // HOSTS-1: repo -> host without polling; host status flows back onto the commit
        const t = await getToken(env.DB, env, env.TENANT || config.org_slug || 'default', 'github-app').catch(() => null), tok = (t && t.ok && t.token) || env.GITHUB_TOKEN || '';
        const job = ev === 'push'
          ? recordHostEvent(env.DB, Date.now, { host: 'github', kind: 'inbound', repo: payload.repository && payload.repository.full_name, sha: payload.after, detail: 'push ' + payload.ref }).then(() => onPush({ db: env.DB, registry: hostRegistry(env, tok, payload.repository && payload.repository.full_name), token: tok, payload }))
          : onWorkflowRun({ token: tok, payload });
        if (ctx && ctx.waitUntil) ctx.waitUntil(job.catch(e => console.error('hosts hook', e && e.message))); else await job;
      }
      const hit = routeEvent(ev, payload, EVENT_TABLE);
      if (!hit) return Response.json({ routed: false }, { status: 202 });
      const ft = await freeTierLevel(env.DB).catch(() => null);  // FREE-TIER-1: an event never wakes an extra tick (model calls, D1 reads) once the day's free allowance is at risk; the 10-minute tick still takes the item
      if (ft && ft.level !== 'ok') return Response.json({ routed: false, throttled: ft.level, ...hit }, { status: 202 });
      const work = aiFor(env).then(g => runTick(env.DB, { config, env: presence(env), wake: hit.role, ai: g.ai, budget: g.state }));
      if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
      return Response.json({ routed: true, ...hit }, { status: 202 });
    }
    if (url.pathname === '/hook/host' && request.method === 'POST') {  // HOSTS-1: host -> repo. Any hosting system reports a deploy/runtime event, signed with HOST_WEBHOOK_SECRET
      const body = await request.text();
      if (!(await verifySignature(await hookSecret(env, 'host'), body, request.headers.get('x-hub-signature-256')))) return Response.json({ error: 'bad signature' }, { status: 401 });
      const t = await getToken(env.DB, env, env.TENANT || config.org_slug || 'default', 'github-app').catch(() => null);
      let event; try { event = JSON.parse(body || '{}'); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
      return Response.json(await onHostEvent({ db: env.DB, token: (t && t.ok && t.token) || env.GITHUB_TOKEN || '', event }), { status: 202 });
    }
    if (url.pathname === '/api/ops/backup' && request.method === 'POST') {  // BACKUP-SINK-1: the backup drill's dumps go to the private ops repository, written with the org's own GitHub App
      if (halted(config, env)) return Response.json({ halted: true }, { status: 202 });  // HALT-1
      const bearer = /^Bearer (.+)$/.exec(request.headers.get('authorization') || '');
      const who = bearer ? await verifyOidc(bearer[1], { repo: env.MAIN_REPO || env.OIDC_REPO || 'ultrastable/ultrastable' }).catch(e => ({ ok: false, why: String(e && e.message) })) : { ok: false, why: 'no bearer' };
      if (!who.ok) return new Response('Not found', { status: 404 });
      const t = await getToken(env.DB, env, env.TENANT || config.org_slug || 'default', 'github-app').catch(() => null);
      return opsBackup(request, { token: (t && t.ok && t.token) || '', repo: env.OPS_REPO || 'ultrastable/ops' });
    }
    if (url.pathname === '/api/main/commit' && request.method === 'POST') {  // MAIN-WRITER-1: workflow data commits to main, written with the org's own GitHub App (exempt from the main ruleset)
      if (halted(config, env)) return Response.json({ halted: true }, { status: 202 });  // HALT-1
      const repo = env.MAIN_REPO || env.OIDC_REPO || 'ultrastable/ultrastable';
      const bearer = /^Bearer (.+)$/.exec(request.headers.get('authorization') || '');
      const who = bearer ? await verifyOidc(bearer[1], { repo }).catch(e => ({ ok: false, why: String(e && e.message) })) : { ok: false, why: 'no bearer' };
      if (!who.ok) return new Response('Not found', { status: 404 });
      let body; try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'bad json' }, { status: 400 }); }
      const t = await getToken(env.DB, env, env.TENANT || config.org_slug || 'default', 'github-app').catch(() => null);
      const tenant = env.TENANT || config.org_slug || 'default';
      const r = await commitToMain({ token: (t && t.ok && t.token) || env.GITHUB_TOKEN || '', repo, body });
      // The ruleset applier waits for this row: the rule on main is applied only once a workflow commit has really landed through this route.
      await env.DB.prepare('INSERT INTO credential_events (tenant, provider, event, detail) VALUES (?,?,?,?)').bind(tenant, 'github-app', r.ok ? 'main-writer' : 'main-writer-failed', String(r.ok ? r.sha : r.error).slice(0, 300)).run().catch(e => console.error('main-writer event', e && e.message));
      return Response.json({ ...r, run: who.run }, { status: r.status });
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
    if (url.pathname === '/api/progress') { try { return Response.json(await readProgress(env.DB, config), { headers: { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' } }); } catch (e) { return d1Unavailable(e); } }  // PROGRESS-1
    if (url.pathname === '/api/live/changes') { try { const rs = config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []); return Response.json(await readLiveChanges(env.DB, rs.find(r => r.endsWith('/ultrastable')) || rs[0] || null), { headers: { 'cache-control': 'public, max-age=60' } }); } catch (e) { return d1Unavailable(e); } }  // LIVE-FRESH-1
    if (url.pathname === '/api/roi') { try { return Response.json(await readRoi(env.DB, { env }), { headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } }); } catch (e) { return d1Unavailable(e); } }  // ROI-1
    if (url.pathname === '/api/decisions') { try { return Response.json(await readDecisions(env.DB), { headers: { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' } }); } catch (e) { return d1Unavailable(e); } }  // DECISIONS-1
    if (url.pathname === '/api/goals' && request.method === 'GET') {  // GOALS-READS-1: readGoals scans 14 days of samples and the loop beats (tens of thousands of D1 rows read), so the answer is cached at the edge for 10 minutes and a failed refresh serves the last good copy
      const cache = typeof caches !== 'undefined' ? caches.default : null, key = new Request(url.origin + '/api/goals', { method: 'GET' });
      try { const hit = cache && await cache.match(key); if (hit) return hit; } catch (e) { /* allow-silent: a cache read miss falls through to the D1 read below */ console.error('goals cache read failed', String(e)); }
      try { const res = Response.json(await readGoals(env.DB, { builtins: METRICS }), { headers: { 'cache-control': 'public, max-age=600', 'access-control-allow-origin': '*' } });
        if (cache) { try { const w = cache.put(key, res.clone()); if (ctx && ctx.waitUntil) ctx.waitUntil(w); else await w; } catch (e) { /* allow-silent: a cache write miss only costs the next request one D1 read */ console.error('goals cache write failed', String(e)); } }
        return res; } catch (e) { return d1Unavailable(e); } }  // GOALS-1: public, read-only
    if (url.pathname === '/api/goals/knobs' && request.method === 'GET') { try { return Response.json(await knobValues(env.DB, url.searchParams.get('tenant') || 'core'), { headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } }); } catch (e) { return d1Unavailable(e); } }  // GOALS-1: a tenant reads the knob values core set and applies them in its own code
    if ((url.pathname === '/api/goals/register' || url.pathname === '/api/goals/report') && request.method === 'POST') {  // GOALS-1: the tenant interface (bearer ANALYTICS_TOKEN or INTERNAL_DEPLOY_KEY)
      if (!bearerOk(request, env)) return Response.json({ error: 'unauthorized' }, { status: 401 });
      let body; try { body = await request.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
      try {
        if (url.pathname.endsWith('register')) { const r = await registerTenant(env.DB, String(body.tenant || ''), body); return Response.json(r, { status: r.ok ? 200 : 422 }); }
        return Response.json({ ok: true, readings: await reportReadings(env.DB, String(body.tenant || ''), body.readings) });
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
      return Response.json(url.pathname === '/live' ? { ok: true, org: config.org_slug, k_eff: c ? c.k_eff : null, k_self: c && c.k_self !== undefined ? c.k_self : null, self_regime: c && c.self_regime ? c.self_regime : null, open_ignition_gaps: c && c.open_ignition_gaps !== undefined ? c.open_ignition_gaps : null, self_sustaining: c ? Boolean(c.self_sustaining) : false, criticality: c, criticality_loop: await loopHealth(env.DB, config.criticality, Date.now()).catch(() => null), ignition: await readIgnition(env.DB).catch(() => null), pulse: await readPulse(env.DB).catch(() => null), sweeper: await lastSweep(env.DB).catch(() => null), repo_access: await readRepoAccess(env.DB).catch(() => null) } : { ...(c || {}), loop: await loopHealth(env.DB, config.criticality, Date.now()).catch(() => null) }, { headers: { 'cache-control': 'no-store' } });
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
    if (url.pathname === '/api/v1/owner-acts') {  // OWNER-ACTS-1: live, from credential rows and open gate cards; consumer foundation/unattended.py --live
      const { results } = await db.prepare(`SELECT id, what, default_in_effect, closing_probe FROM gate_cards WHERE status='open' ORDER BY id LIMIT 50`).all();
      return Response.json({ at: new Date().toISOString(), signins: await ownerActs(db), cards: results || [] }, { headers: { 'cache-control': 'no-store' } });
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
