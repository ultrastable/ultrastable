// Ultrastable seed Worker: the server-side heartbeat for one org.
// Cron fires runTick; GET /health shows the last tick's four-line report.
// Standard issue: first-party web analytics (analytics/analytics.js): /a.js beacon, /a/e collector, GET /api/analytics (bearer ANALYTICS_TOKEN).
import { paced } from './pace.js';
import { readSwitches, offReason, drill, lastDrill } from './switches.js';  // KILL-SWITCH-1
import { footerHtml, discoverRoute, seedStatements, seedJsonLd, heartbeat as directoryHeartbeat } from './discover.js';  // DISCOVER-1
import { readPlans } from './planner.js';  // PLAN-1
import { withKnobs, readGoals, registerTenant, reportReadings, knobValues } from './goals.js';  // GOALS-1
import { tune } from './roi.js';  // BOUNDARIES-1
import { runTick, lastTickForHealth, METRICS, ensureItem, wakeAllowed } from './tick.js';
import { claimsReleasedUnworked24h } from './doer.js';
import { runExecutor, noteExecutor } from './executor.js';
import { runLane, githubBudget } from './lane.js';
import { verifyOidc, commitToMain } from './maincommit.js';  // MAIN-WRITER-1
import { repairSites } from './uptimerepair.js';  // UPTIME-1
import { opsBackup } from './opsbackup.js';  // BACKUP-SINK-1
import { snapshotD1 } from './d1snapshot.js';  // D1-SNAPSHOT-1
import { onCloudflareAlert, settleCloudflareAlerts } from './cfalerts.js';  // CF-ALERTS-1
import { createMeter, guarded, readDeferred, writeDeferred, capsFor, LOOP_MIN_COST } from './subreq.js';  // SUBREQUEST-METER-1
import { ingestDeploys } from './selfaudit.js';
import { auditApps } from './appaudit.js';  // APP-INVENTORY-1
import { sampleCosts } from './costsample.js';
import { readRoi } from './roi.js';  // ROI-1
// ROI-SELF-1: when the system's own ROI verdict is pay and the account is on the free plan, one owner gate per month (buying is money, identity-bound);
// the default in effect is the free plan with soft throttling, so nothing waits on it. The gate closes by itself once CF_PLAN=paid is set.
export async function roiGate(db, env, config = {}) {
  const r = await readRoi(db, { env, config });
  const d = r.system_decision || {};
  if (d.verdict !== 'pay' || r.plan === 'paid') return { filed: false, verdict: d.verdict };
  const id = `ROI-PAY-${new Date().toISOString().slice(0, 7)}`;
  const filed = await ensureItem(db, { id, title: `Gate (owner billing): Workers Paid pays for itself. ${d.reason}. Default in effect: ${d.default_in_effect}.`.slice(0, 300), kind: 'gate', owner_role: 'owner', done_check: 'the tick runs with CF_PLAN=paid', closing_probe: 'GET /api/roi plan == paid', priority: 2 });
  return { filed, id, verdict: d.verdict };
}
import { sampleFreeTier, freeTierLevel, alertFreeTier } from './freetier.js';  // FREE-TIER-1
import { runGate, gateCard } from './worker-gate.js';
import { runHandoffs, makeDeployer, makeRollback, makeVersionReader } from './handoff.js';
import { syncIssues } from './issuesync.js';
import { mergeForLane } from './lanemerge.js';  // LANE-WORKER-MERGE-1
import { sweepOpenLoops, recordSweep, lastSweep, alarmStalls } from './sweeper.js';
import { revertRedMain } from './redmain.js';  // REDMAIN-LANE-1
import { mergeNow, prsForEvent } from './mergenow.js';
import { refreshLiveChanges, readLiveChanges, refreshFleetChanges, classifyPending } from './livechanges.js'; // LIVE-FRESH-1, SUBSTANCE-1
import { progressStep, readProgress } from './progress.js'; // PROGRESS-1
import { stickinessStep, readStickiness, readQueue } from './stickiness.js'; // STICKY-1
import { graphAiStep, readGraphAi } from './graphai.js'; // KGRAPH-AI-1
import { datagraphStep, readGraph, readInsights, readNode, searchGraph } from './datagraph.js'; // DATAGRAPH-1
import { watchFreshness } from './freshness.js'; // LIVE-FRESH-2
import { watchTenantDeploys } from './tenantdeploy.js'; // TENANT-DEPLOY-1
import { recordGovernor, readDecisions, safely as decisionSafely } from './decisions.js'; // DECISIONS-1
import { runSocial, blueskyAccess } from './social.js';
import { importCredentials, reconcileBuffer, intakeInbox, seedLinkRows } from './humans.js';  // SOCIAL-MODULE-1  // REACH-1
import { probe as probeAgents } from './codeagent.js';
import { hiddenByHealthOnly, publicPage } from './visibility.js';
import config from './config.js';
import { tickRecency, stamp, probeStamps } from './recency.js';  // RECENCY-1
import { backendRecord } from './errors.js';  // USER-BACKEND-1
import { governedAI, budgetView, SHARES, halted, planOf } from './budget.js';
import { recordSpend, readSpend, spendView } from './spend.js';  // SPEND-SOFT-1
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
import { handleAppHost } from './apprepos.js';
import { reconcileVisibility, pulseTenants, watchGhOnly } from './declared.js';  // DECLARED-LIVE-1
import { readIgnition } from './ignition.js';
import { loopHealth } from './critloop.js';
import { routeEvent, verifySignature, EVENT_TABLE } from './events.js';
import { loadAnswers, saveAnswer, nextQuestion, QUESTIONS } from './interview.js';
import { nowScreen, nextScreen, needsScreen, questionScreen, doneScreen, graphScreen } from './ui.js';
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
const aiFor = (env) => halted(config, env) ? Promise.resolve({ ai: null, state: { mode: 'halted', why: 'HALT-1' } }) : readSpend(env.DB).then(spend => governedAI(env.DB, env.AI || null, { config, env, share: SHARES.tick, spend })).catch(e => { console.error('budget governor', e && e.message); return { ai: null, state: null }; });
const hosts = env => (env.ANALYTICS_HOSTS ? String(env.ANALYTICS_HOSTS).split(',') : [env.PUBLIC_HOST || config.org_slug + '.example']).map(h => h.trim());

const LOOP_PHASE = { executor: 0, gate: 1, lane: 1, handoffs: 2, issuesync: 2, 'repo-access': 2, sweeper: 3, 'deploy-evidence': 3, social: 3, humans: 3, 'watchdog-gh': 3, hosts: 0, 'host-hooks': 0 };  // SUBREQUEST-ROTATION-2: four phases; HOSTS-1 probes (2-3 calls) ride with the executor, they hit the 50-subrequest cap when run every tick after the heavy groups

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

const app = {
  async scheduled(_event, env, ctx) {
    if (halted(config, env)) { ctx.waitUntil(beat(env.DB, 'halted', async () => ({ halted: true })).catch(e => console.error('halted beat', e && e.message))); return; }  // HALT-1: no loops, lane, executor, deploys or model calls
    // ACCOUNT-SPLIT-2: decide first whether this account's tick runs the loops (one primary across both Cloudflare accounts).
    const tenantId = env.TENANT || config.org_slug || 'default';
    const githubOk = async () => { const t = await getToken(env.DB, env, tenantId, 'github-app').catch(() => null); return Boolean((t && t.ok && t.token) || env.GITHUB_TOKEN); };
    const cut = await decide(env.DB, env, { githubOk }).catch(e => ({ run: (env.SLOT || 'primary') !== 'standby', notes: ['cutover check failed: ' + String(e && e.message).slice(0, 160)] }));
    await beat(env.DB, 'cutover', async () => ({ run: cut.run, slot: cut.slot, epoch: cut.epoch, promoted: Boolean(cut.promoted), notes: cut.notes })).catch(e => console.error('cutover beat', e && e.message));
    if (!cut.run) { if (env.SLOT === 'standby' || cut.slot !== 'primary') ctx.waitUntil(refreshDue(env.DB, env).catch(() => null)); return; }
    ctx.waitUntil(directoryHeartbeat(env, config).then(r => { if (r.sent) console.log('directory heartbeat', r.status, r.why || ''); if (r.stateError) console.error('directory registration state', r.stateError); }).catch(e => console.error('directory heartbeat', e && e.message)));  // DISCOVER-1: daily and from birth (BOOT-4), opt-out-able
    const gov = await aiFor(env);
    if (gov.state) console.log('budget', JSON.stringify({ mode: gov.state.mode, why: gov.state.why, neurons_today: Math.round(gov.state.usage.ai_neurons_today), cap: gov.state.allowance.ai_neurons_day }));
    const caps = capsFor(planOf(config, env));  // PLAN-1: paid plan, 1,000 planned subrequests and no rotation
    const meter = createMeter({ cap: caps.cap }), restoreFetch = meter.install();  // SUBREQUEST-METER-1: every fetch of this invocation is counted; one cap for the tick steps and the loops
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
      const carried = new Set(await readDeferred(env.DB)), deferred = new Set(), guard = guarded(meter, deferred, failed, LOOP_MIN_COST, caps.shares);  // SUBREQUEST-METER-1: a loop that was deferred runs first next time, in any phase
      const tuningFree = await freeTierLevel(env.DB, Date.now(), planOf(config, env)).then(l => (l && l.resources) ? tune(Object.fromEntries(Object.entries(l.resources).map(([k, r]) => [k, r.frac]))) : null).catch(e => { console.error('tuning unread:', e && e.message); return null; });  // BOUNDARIES-1: applied to every paceable loop below
      const spendNow = await readSpend(env.DB);  // SPEND-SOFT-1: the spend throttle's pace knob stretches idle loops too; the larger stretch wins
      const tuningNow = spendNow.knobs && spendNow.knobs.pace > 1 && (!tuningFree || tuningFree.action !== 'slow' || tuningFree.pace_factor < spendNow.knobs.pace) ? { action: 'slow', pace_factor: spendNow.knobs.pace, text: `spend ${spendNow.level}` } : tuningFree;
      const switches = await readSwitches(env.DB, { env }).catch(e => { console.error('switches unread:', e && e.message); return {}; });  // KILL-SWITCH-1: an unreadable table stops nothing
      const b = (loop, fn) => (caps.rotate && loop in LOOP_PHASE && LOOP_PHASE[loop] !== phase && !carried.has(loop)) ? Promise.resolve(undefined) : beat(env.DB, loop, async () => (offReason(switches, loop) && { switched_off: offReason(switches, loop) }) || (loop in LOOP_PHASE && await paced(env.DB, loop, cycle, knobConfig, tuningNow)) || guard(loop, fn), { everyMin: loop in LOOP_PHASE && caps.rotate ? HEAVY_CADENCE_MIN : 10 }).then(r => { console.log(loop, JSON.stringify(r === undefined ? null : r)); return r; });
      const steps = [], step = (loop, fn) => { steps.push([loop, fn]); };
      const tenant = env.TENANT || config.org_slug || 'default';
      const repos = config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []);
      const main = repos.find(r => r.endsWith('/ultrastable')) || repos[0];
      // FREE-TIER-1: the usage sample is read first. It ran last and was starved by the 50-subrequest limit ("Too many subrequests" at 00:10 UTC 2026-11-18), which left the governor without a reading.
      const freeTier = await sampleFreeTier(env.DB, { plan: planOf(config, env), token: env.CF_ANALYTICS_TOKEN, account_id: (config.cost_budgets && config.cost_budgets[0] && config.cost_budgets[0].account_id) || env.CF_ACCOUNT_ID }).catch(e => ({ error: String(e && e.message).slice(0, 120) }));
      { const al = await alertFreeTier(env.DB, freeTier); if (al.error) console.error('free-tier alert unfiled:', al.error); }
      await recordSpend(env.DB, { meters: freeTier.meters, error: freeTier.error || null, config, env, now: new Date() });  // SPEND-SOFT-1: today's estimated bill and the throttle level every later step reads
      if (new Date().getUTCMinutes() < 10) { const g = await roiGate(env.DB, env, config).catch(e => ({ error: String(e && e.message).slice(0, 120) })); if (g && g.error) console.error('roi gate:', g.error); }  // ROI-SELF-1: hourly, the system's own verdict on paying  // READ-BUDGET-8: an item is filed once a day per resource when a free limit is projected to pass 70%
      await decisionSafely(() => recordGovernor(env.DB, freeTier));  // DECISIONS-1: the level just set is a decision, scored at a later sample
      if ((await lastDrill(env.DB).catch(() => ({ due: false }))).due) await b('kill-drill', () => drill(env.DB, { env }));  // KILL-SWITCH-1: once a day the global switch is turned on, checked, turned off in every case and the test recorded
      await b('credentials', () => refreshDue(env.DB, env));  // AUTH-1: refresh runs first so nothing lapses
      const t = await getToken(env.DB, env, tenant, 'github-app').catch(e => ({ ok: false, error: e && e.message }));  // one token for the lane and the executor, minted from the GitHub App (a bound GITHUB_TOKEN is only a fallback)
      const token = (t && t.ok && t.token) || env.GITHUB_TOKEN || '';
      await b('live-changes', () => refreshLiveChanges({ db: env.DB, token, repo: main }));  // LIVE-FRESH-2: own early step; inside the sweeper it ran after 32 of 46 subrequests were spent and never wrote, so /live froze
      await b('fleet-changes', () => refreshFleetChanges({ db: env.DB, token, repos: ((config.progress || {}).systems || []).map(x => x.repo).filter(r => r && r !== main) }));  // PROGRESS-1: the other repositories, at most hourly each
      await b('substance', () => classifyPending({ db: env.DB, token, max: 2 }));  // SUBSTANCE-1: two merged PRs per pass are classified from their diff, so trivial merges never count as progress
      await b('stickiness', () => stickinessStep({ db: env.DB, config, ensureItem }));  // STICKY-1: freshness, breadth, depth and diversity of every system's content; a stale or thin one files STICKY-<system>, and its unpromoted entries become the social queue
      await b('knowledge-graph', () => datagraphStep({ db: env.DB, config, ensureItem }));  // DATAGRAPH-1: every table of this system's own D1 becomes a graph (rows are nodes, references and mentioned ids are edges), kept bi-temporally; hubs, communities, bridges and orphans are read each pass, Adamic-Adar link leads are settled against later data, and a mostly unconnected kind files KG-ORPHANS-<kind>
      await b('graph-ai', () => graphAiStep({ db: env.DB, ai: gov.ai || null, config, spend: spendNow, ensureItem }));  // KGRAPH-AI-1: embeddings, extracted relations and community summaries on new graph nodes, scaled by the spend throttle
      await b('progress', () => progressStep({ db: env.DB, config, token, ensureItem }));  // PROGRESS-1: release cadence monitor; a slow system has its producers dispatched, a stalled one files STALL-<system>
      await b('freshness', () => watchFreshness({ token, repo: main, siteUrl: env.PUBLIC_ORIGIN || 'https://ultrastable.io' }));
      await b('recency', () => probeStamps({ siteUrl: env.PUBLIC_ORIGIN || 'https://ultrastable.io' }));  // RECENCY-PROBE-1: every live page keeps its stamp  // LIVE-FRESH-2: a stale published snapshot re-dispatches its own publisher
      if (new Date().getUTCMinutes() < 10) await b('gh-only', () => watchGhOnly({ token, loops: config.gh_only || [] }));  // GH-ONLY-WATCH-1: GitHub-only loops get a second clock and go live the hour Pages turns on
      if (new Date().getUTCMinutes() % 30 < 10) await b('tenant-deploy', () => watchTenantDeploys({ token, repo: main }));  // TENANT-DEPLOY-1: a tenant repository's merge ships within the hour (twice an hour, ~4 subrequests)
      if (new Date().getUTCMinutes() < 10) {  // DECLARED-LIVE-1: hourly, from this one cron
        await b('tenant-pulse', async () => { const r = await pulseTenants({ targets: config.tenant_pulse || [] }); await declaredItems(env.DB, 'PULSE', r.failed, (config.tenant_pulse || []).map(x => x.id)); return r; });  // every tenant back end has a second route to run besides its own cron
        await b('repo-visibility', async () => { const a = await getToken(env.DB, env, tenant, 'github-admin').catch(() => null); const r = await reconcileVisibility({ token: a && a.ok ? a.token : '', repos: config.repo_visibility || [] }); await declaredItems(env.DB, 'VIS', r.status === 'drift' ? r.drift.filter(d => !r.fixed.some(f => d.startsWith(f + ':'))) : [], (config.repo_visibility || []).map(x => x.repo)); return r; });  // declared visibility wins over drift
      }
      step('executor', async () => { const r = await runExecutor({ ...env, TENANT: env.TENANT || config.org_slug, AI: gov.ai || undefined, GITHUB_DISPATCH_TOKEN: token || env.GITHUB_DISPATCH_TOKEN, GITHUB_REPO: env.GITHUB_REPO || repos[0] }); await noteExecutor(env.DB, r); return r; });
      step('gate', async () => { const g = await runGate({ token, repos }); await gateCard(env.DB, g, { origin: env.PUBLIC_ORIGIN || '' }); return g; });  // ZERO-MINUTES-1, Q-GATE-403
      const ghBudget = githubBudget(env.GITHUB_CALLS_PER_TICK || config.github_calls_per_tick);  // GITHUB-BUDGET-1: one GitHub call budget for the lane and the handoffs of this tick (default 40)
      step('lane', () => runLane({ token, repos, issueWorkflow: null, zeroActions: env.ZERO_ACTIONS === '1', evidenceRepo: env.EVIDENCE_REPO || repos[0] || null, budget: ghBudget }));
      const site = env.SITE && env.INTERNAL_DEPLOY_KEY ? env.SITE : null;  // HANDOFF-1: the server owns every handed-off PR after it opens: merge noticed, deploy, live probe, close or roll back
      step('handoffs', () => runHandoffs({ db: env.DB, token, repos, deployer: site ? reporting(makeDeployer({ token, site, key: env.INTERNAL_DEPLOY_KEY }), { token }) : null, rollback: site ? makeRollback({ site, key: env.INTERNAL_DEPLOY_KEY }) : null, versionOf: site ? makeVersionReader({ site, key: env.INTERNAL_DEPLOY_KEY }) : null, budget: ghBudget, tenant: env.TENANT || config.org_slug }));  // DEPLOY-VERSION-1
      step('issuesync', () => syncIssues({ db: env.DB, token, repo: main }));  // ISSUESYNC-1: filed roadmap items reach the queue on the server, no Actions needed
      step('repo-access', () => checkRepoAccess(env.DB, env, tenant, repos, { token, origin: env.PUBLIC_ORIGIN || '' }));  // REPO-ACCESS-1
      step('social', () => runSocial({ db: env.DB, env, tenant }));  // REACH-1: posts the due calendar item to the channels linked at /connect
      step('humans', async () => ({ seeded: await seedLinkRows(env.DB, env, tenant), buffer: await reconcileBuffer({ db: env.DB, env, tenant }), inbox: new Date().getUTCMinutes() < 10 ? await intakeInbox({ db: env.DB, env, tenant, blueskyAccess }) : 'hourly' }));  // SOCIAL-MODULE-1: read-back of Buffer posts; replies and mentions become inbox rows, hourly
      step('sweeper', async () => { const sw = await sweepOpenLoops({ token, repos }); await recordSweep(env.DB, sw); sw.stall_items = await alarmStalls(env.DB, sw, ensureItem); return sw; });  // PR-LATENCY-1  // SERVER-OWNS-LOOPS-1
      step('redmain', () => revertRedMain({ token, repo: repos.find(r => r.endsWith('/ultrastable')) || main }));  // REDMAIN-LANE-1: a main red past 15 minutes gets a revert PR the lane merges
      step('app-audit', () => auditApps(env.DB, env, tenant));  // APP-INVENTORY-1: live app inventory, extra installations of our own apps removed, daily
      step('deploy-evidence', () => ingestDeploys(env.DB, { token, repo: repos.find(r => r.endsWith('/ultrastable')) }));  // SELFAUDIT-1: independent deploy evidence feeds k_eff
      step('host-hooks', async () => reconcileHooks({ db: env.DB, token, repos, origin: env.PUBLIC_ORIGIN || 'https://ultrastable.io', secret: await hookSecret(env, 'github') }));  // HOSTS-1: the server creates, repairs and re-checks its own repo webhook; nothing is set up by hand
      step('hosts', () => watchHosts({ db: env.DB, registry: hostRegistry(env, token, main), token, repo: main }));  // HOSTS-1: health probe of every host, stall detection, failover redispatch
      step('watchdog-gh', () => watchGithub({ token, repo: main }));  // RESILIENCE-1: the Worker restarts the GitHub watchdog when it stalls; the GitHub watchdog restarts this tick
      for (const [loop, fn] of [...steps].sort((a, z) => carried.has(z[0]) - carried.has(a[0]))) await b(loop, fn);  // SUBREQUEST-METER-1: deferred loops first, then the phase's own
      await b('cost-samples', async () => ({ free_tier: freeTier, samples: await sampleCosts(env.DB, { token: env.CF_ANALYTICS_TOKEN, budgets: config.cost_budgets }), retention: await pruneAll(env.DB, { rules: config.retention, archive: (table, rows) => archiveRows(env.DB, table)(rows) }), audit: await seal(env.DB, auditSinks(env, token, repos)), snapshot: await snapshotD1(env.DB, env.AUDIT).catch(e => ({ error: String(e && e.message).slice(0, 160) })), cf_alerts: await settleCloudflareAlerts(env.DB).catch(e => ({ error: String(e && e.message).slice(0, 160) })) }));  // D1-SNAPSHOT-1: the daily copy of D1 into the AUDIT bucket, read back before it counts  // AUDIT-CHAIN-1: aged rows are chained, then sealed to the archive  // RETENTION-1: the daily prune rides the hourly cost beat (once a day by its own gate)  // COSTGUARD-1: hourly D1 rows-read sample feeds the D1 budget failure modes
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
    { const ah = await handleAppHost(request, env, { tenant: env.TENANT || config.org_slug || 'default' }); if (ah) return ah; }  // APP-REPO-1: repositories and one-repository tokens for apps this system hosts
    if (halted(config, env) && (url.pathname === '/hook/github' || url.pathname === '/hook/host' || url.pathname === '/hook/cloudflare' || url.pathname === '/pulse/watch')) return Response.json({ halted: true }, { status: 202 });  // HALT-1
    { const d = discoverRoute(url, env, config); if (d) return d; }  // DISCOVER-1: public manifest, nothing private
    if (url.pathname === '/hook/cloudflare' && request.method === 'POST') return onCloudflareAlert(request, { db: env.DB, secret: env.CF_ALERT_SECRET, fileItem: (it) => ensureItem(env.DB, it) });  // CF-ALERTS-1: Cloudflare's own alerts become queue items
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
      const mn = prsForEvent(ev, payload);  // MERGE-NOW-1: a PR event, a finished check suite or a move of main is acted on in this request, not on the next tick
      if (mn) {
        const job = getToken(env.DB, env, env.TENANT || config.org_slug || 'default', 'github-app').catch(() => null)
          .then(t => mergeNow({ token: (t && t.ok && t.token) || env.GITHUB_TOKEN || '', repo: mn.repo, numbers: mn.numbers }))
          .then(r => { console.log('merge-now', JSON.stringify(r)); return r; });
        if (ctx && ctx.waitUntil) ctx.waitUntil(job.catch(e => console.error('merge-now', e && e.message))); else await job;
      }
      const hit = routeEvent(ev, payload, EVENT_TABLE);
      if (!hit) return Response.json({ routed: false, merge_now: Boolean(mn) }, { status: 202 });
      const ft = await freeTierLevel(env.DB, Date.now(), planOf(config, env)).catch(() => null);  // FREE-TIER-1: an event never wakes an extra tick (model calls, D1 reads) once the day's free allowance is at risk; the 10-minute tick still takes the item
      if (ft && ft.level !== 'ok') return Response.json({ routed: false, throttled: ft.level, ...hit }, { status: 202 });
      const wk = await wakeAllowed(env.DB, { config, now: Date.now() });  // WAKE-BUDGET-1: at most one woken tick between two cron ticks, none while the rows-read budget is breached
      if (!wk.ok) return Response.json({ routed: false, throttled: wk.why, ...hit }, { status: 202 });
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
    if (url.pathname === '/api/uptime/repair' && request.method === 'POST') {  // UPTIME-1: the uptime worker's repair hand (service binding): redeploys the site with the org's own GitHub App; one fixed workflow, throttled, no input used
      if (halted(config, env)) return Response.json({ halted: true }, { status: 202 });  // HALT-1
      const t = await getToken(env.DB, env, env.TENANT || config.org_slug || 'default', 'github-app').catch(() => null);
      const r = await repairSites({ token: (t && t.ok && t.token) || '', repo: env.MAIN_REPO || env.OIDC_REPO || 'ultrastable/ultrastable' });
      return Response.json(r, { status: r.ok ? 200 : 202 });
    }
    if (url.pathname === '/api/lane/merge' && request.method === 'POST') {  // LANE-WORKER-MERGE-1: the lane's merge for a PR that changes workflows, done with the org's own GitHub App
      if (halted(config, env)) return Response.json({ halted: true }, { status: 202 });  // HALT-1
      const repo = env.MAIN_REPO || env.OIDC_REPO || 'ultrastable/ultrastable';
      const bearer = /^Bearer (.+)$/.exec(request.headers.get('authorization') || '');
      const who = bearer ? await verifyOidc(bearer[1], { repo }).catch(e => ({ ok: false, why: String(e && e.message) })) : { ok: false, why: 'no bearer' };
      if (!who.ok) return new Response('Not found', { status: 404 });
      let body; try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'bad json' }, { status: 400 }); }
      const t = await getToken(env.DB, env, env.TENANT || config.org_slug || 'default', 'github-app').catch(() => null);
      const r = await mergeForLane({ token: (t && t.ok && t.token) || '', repo, pr: body.pr, sha: body.sha });
      return Response.json(r, { status: r.status });
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
    if (url.pathname === '/internal/social/import' && request.method === 'POST') { try { return await importCredentials(env.DB, env, env.TENANT || config.org_slug || 'default', request); } catch (e) { return d1Unavailable(e); } }  // SOCIAL-MODULE-1: token-gated; seals a channel token, answers names only
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
    if (url.pathname === '/api/graph/ai') { try { return Response.json(await readGraphAi(env.DB), { headers: { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' } }); } catch (e) { return d1Unavailable(e); } }  // KGRAPH-AI-1: the AI layer's cost probe and summaries
    if (url.pathname === '/api/graph' || url.pathname === '/api/graph/insights' || url.pathname === '/api/graph/node' || url.pathname === '/api/graph/search' || url.pathname === '/graph') {  // DATAGRAPH-1: the knowledge graph's read side (summary, insights and leads, a node with its neighbourhood for retrieval, label search, the page)
      try {
        const v = { open: bearerOk(request, env), publicKinds: (config.knowledge_graph && config.knowledge_graph.public_kinds) || [] };  // the owner's bearer sees every record; anyone else sees counts and declared public kinds only
        const h = { headers: { 'cache-control': v.open ? 'no-store' : 'public, max-age=60', 'access-control-allow-origin': '*' } };
        if (url.pathname === '/api/graph') return Response.json(await readGraph(env.DB, v), h);
        if (url.pathname === '/api/graph/insights') return Response.json(await readInsights(env.DB, v), h);
        if (url.pathname === '/api/graph/search') return Response.json(await searchGraph(env.DB, url.searchParams.get('q'), v), h);
        if (url.pathname === '/api/graph/node') { const n = await readNode(env.DB, String(url.searchParams.get('id') || ''), { ...v, depth: url.searchParams.get('depth') === '2' ? 2 : 1 }); return n ? Response.json(n, h) : Response.json({ error: 'not_found', message: 'No record with that id is in the public graph.' }, { status: 404 }); }
        return graphScreen({ graph: await readGraph(env.DB, { publicKinds: v.publicKinds }), insights: await readInsights(env.DB, { publicKinds: v.publicKinds }) });
      } catch (e) { return d1Unavailable(e); }
    }
    if (url.pathname === '/api/stickiness') { try { return Response.json(await readStickiness(env.DB), { headers: { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' } }); } catch (e) { return d1Unavailable(e); } }  // STICKY-1
    { const qm = /^\/api\/stickiness\/queue\/([a-z0-9-]{1,60})\.json$/.exec(url.pathname); if (qm) { try { return Response.json(await readQueue(env.DB, qm[1]), { headers: { 'cache-control': 'public, max-age=300' } }); } catch (e) { return d1Unavailable(e); } } }  // STICKY-1: the queue the core social module drains for this system
    if (url.pathname === '/api/progress') { try { return Response.json(await readProgress(env.DB, config), { headers: { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' } }); } catch (e) { return d1Unavailable(e); } }  // PROGRESS-1
    if (url.pathname === '/api/live/changes') { try { const rs = config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []); return Response.json(await readLiveChanges(env.DB, rs.find(r => r.endsWith('/ultrastable')) || rs[0] || null), { headers: { 'cache-control': 'public, max-age=60' } }); } catch (e) { return d1Unavailable(e); } }  // LIVE-FRESH-1
    if (url.pathname === '/api/roi') { try { return Response.json(await readRoi(env.DB, { env, config }), { headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } }); } catch (e) { return d1Unavailable(e); } }  // ROI-1
    if (url.pathname === '/api/decisions') { try { return Response.json(await readDecisions(env.DB), { headers: { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' } }); } catch (e) { return d1Unavailable(e); } }  // DECISIONS-1
    if (url.pathname === '/api/plans' && request.method === 'GET') {  // PLAN-1: every plan, its task tree and its gate verdict
      return new Response(JSON.stringify(await readPlans(env.DB)), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' } });
    }
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
    if (url.pathname === '/api/spend') { try { return Response.json(spendView(await readSpend(env.DB), url.searchParams.get('tenant')), { headers: { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' } }); } catch (e) { return d1Unavailable(e); } }  // SPEND-SOFT-1: today's estimate, level, knobs and per-tenant shares
    if (url.pathname === '/api/budget') { try { return Response.json(await budgetView(env.DB, { config, env, spend: await readSpend(env.DB) }), { headers: { 'cache-control': 'no-store' } }); } catch (e) { return d1Unavailable(e); } }  // SPEND-GOVERNOR-1: the knob, what it buys, what was used, the mode
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
    if (url.pathname === '/' && request.method === 'GET' && env.PUBLIC_HEALTH_ONLY === '1') {  // FULLSTACK-1: a health-only system still has a public front end
      let last; try { last = await lastTickForHealth(env.DB); } catch (e) { return d1Unavailable(e); }
      return publicPage({ name: config.org_slug, last, ignition: await readIgnition(env.DB).catch(() => null), footer: footerHtml(env, config), statements: seedStatements(env, config, url), head: seedJsonLd(env, config, url) });
    }
    if (url.pathname === '/health') {
      if (halted(config, env)) return Response.json({ ok: true, halted: true, org: config.org_slug, why: 'HALT-1: the owner stopped every loop; pages keep serving' });
      let last; try { last = await lastTickForHealth(env.DB); } catch (e) { return d1Unavailable(e); }
      const ok = Boolean(last && last.steps_completed === last.steps_total);
      const released = await claimsReleasedUnworked24h(env.DB, Date.now()).catch(() => null);  // workers#173 closing probe, target 0
      const cutover = await healthView(env.DB, env).catch(() => null);  // ACCOUNT-SPLIT-2: read by the peer account's tick every beat
      const ign = await readIgnition(env.DB).catch(() => null);  // SEED-AUTONOMY-1: the stage this system read for itself, so the launcher can tell ticking from autonomous without another route
      return Response.json({ ok, org: config.org_slug, last_tick: last || null, claims_released_unworked_24h: released, cutover, ignition: ign ? { stage: ign.stage, since: ign.since, at: ign.at, blocking: ign.blocking ? { stage: ign.blocking.stage, why: String(ign.blocking.why || '').slice(0, 400) } : null } : null }, { status: ok || (cutover && cutover.slot !== 'primary') ? 200 : 503 });
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

// DECLARED-LIVE-1: one item per failing target, closed by the next reading that finds it in order. Lines start with "<id>:".
async function declaredItems(db, prefix, failing, all) {
  const bad = new Map(failing.map(l => [String(l).split(':')[0], String(l)]));
  for (const id of all) {
    const item = `${prefix}-${String(id).replace(/[^A-Za-z0-9-]+/g, '-')}`;
    if (bad.has(id)) await ensureItem(db, { id: item, kind: 'fix', owner_role: 'operations', priority: 1, title: `${prefix === 'PULSE' ? 'Tenant back end did not answer its hourly pulse' : 'Repository visibility drifted from its declaration'}: ${bad.get(id)}`.slice(0, 400),
      done_check: `the next ${prefix === 'PULSE' ? 'tenant-pulse' : 'repo-visibility'} pass reads ${id} in order`, closing_probe: `declared:${prefix}:${id}` }).catch(e => console.error('declared item', e && e.message));
    else await db.prepare(`UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=? AND status NOT IN ('done','superseded','cancelled')`).bind(`probe green: declared:${prefix}:${id}`, new Date().toISOString(), item).run().catch(() => null);
  }
}

// RECENCY-1: every tenant response says when the system last updated (its newest finished tick) and how often it updates, unless a route stamped its own time.
export default {
  ...app,
  async fetch(request, env, ctx) {
    const res = await app.fetch(request, env, ctx);
    if (!env || !env.DB || res.headers.has('x-updated-at')) return res;
    const row = await lastTick(env.DB).catch(() => null);
    return stamp(res, tickRecency(row));
  },
};
