// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The composition root: one object that starts every loop on one tick and serves every route of one organization.
// createOrg({ db, env, config, fetch, now, readFile }) -> { extraSteps(), tick(), scheduledTick(), handle(request), packs, surfaces, buildoutPorts(env) }.
// Ports only (db, env, fetch, now, readFile). Optional injections: vcs, router, store, channels, importer, specStatus,
// voiceRules, scope, compose, outputs, metrics (domain metrics for scoring predictions: { name: async (db, nowMs, row) => number }),
// ports (the ports of the build-out modules that a deployment cannot build from itself; core/org/buildout.js lists them). The tick learns only that a secret exists; values are read by the router and the
// VCS adapter at call time and are never stored or logged here.
import { runTick } from '../src/tick.js';
import { handleConsole } from '../src/console.js';
import { createVault } from '../vault/index.js';
import { sweepFirstRun } from '../doors/index.js';
import { createConsoleL3 } from '../console-l3/index.js';
import { L2_EXTRA_STEPS } from '../kernel/index.js';
import * as claims from '../claims/index.js';
import { createRouter } from '../router/router.js';
import { createRunner, runnerExtraSteps } from '../runner/index.js';
import { createGithubVcs } from '../runner/vcs-github.js';
import { createSignin } from '../githubapp/signin.js';
import { createGithubApp, createInstallationTokenProvider, hasAppCredentials } from '../githubapp/index.js';
import { describeExtraSteps, handle as describeHandle, DESCRIBE_ROUTES } from '../describe/index.js';
import { plusSlotsConfig, composeReaders, firstPartyReader, cloudflareAnalyticsReader, createPlusProposer } from '../plus/index.js';
import { createResearchAgent } from '../staff/index.js';
import { killSwitchPort } from '../router/caps/index.js';
import { candidates as ladderCandidates } from '../ladder/index.js';
import { createPacks } from '../packs/index.js';
import { handle as fleetHandle } from '../fleet/index.js';
import { sweep as yieldSweep } from '../yield/index.js';
import { sweep as docgateSweep } from '../docgate/index.js';
import { steward as stewardRun, rollup as stewardRollup } from '../steward/index.js';
import { wasteRun } from '../waste/index.js';
import { watchOwnerSteps } from '../runner/ownerwatch.js';
import { createAgents } from '../agents/index.js';
import { createContainers } from '../containers/index.js';
import { createInfra, heartbeat } from '../infra/index.js';
import { createElicit } from '../elicit/index.js';
import { createAudit } from '../audit/index.js';
import { ignoranceStep } from '../ignorance/org.js';
import { step as specloopStep } from '../specloop/index.js';
import { steps as criticalitySteps } from '../criticality/index.js';
import { evalProbe } from '../src/tick.js';
import { guardSteps, seedBacklog } from '../runner/selfdoer.js';
import { createDownstreamGithub } from '../githubapp/downstream.js';
import { sweep as codeloopSweep } from '../codeloop/index.js';
import { handlePublicMetrics } from './public-metrics.js';
import { buildoutSteps } from './buildout.js';
import { createSurfaces } from './surfaces.js';
import { createSla } from '../sla/index.js';
import { askOwner } from '../access/index.js';
import { createOwnerlink } from '../ownerlink/index.js';

export { MODULES, moduleList } from './modules.js';

/** Which env names are set, as { NAME: true }. Values never leave the env object. */
export function presence(env = {}) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && v) out[k] = true;
  return out;
}

/** Names the runner still needs, from config and env presence only. Empty means it can run. */
export function runnerNeeds(config = {}, env = {}, { vcsInjected = false, appCredentials = false } = {}) {
  const need = [];
  const tokenEnv = config.vcs?.token_env || 'VCS_TOKEN';
  if (!env[tokenEnv] && !appCredentials) need.push(tokenEnv);
  if (!vcsInjected && !config.vcs?.repo) need.push('config.vcs.repo');
  const providers = Object.values(config.router?.providers || {});
  if (!providers.length) need.push('config.router.providers');
  else if (!providers.some(p => (p.kind === 'workers_ai' ? !!env.AI : p.key_env && env[p.key_env]))) {
    for (const p of providers) { if (p.kind === 'workers_ai') need.push('AI'); else if (p.key_env) need.push(p.key_env); }
  }
  return [...new Set(need)];
}

const ROUTES = new Set(DESCRIBE_ROUTES);
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const INFLIGHT_MS = 5 * 60e3; // a tick still unfinished after this is not in flight any more (the seed's rule)

export function createOrg({
  db, env = {}, config = {}, fetch, now = () => Date.now(), readFile,
  vcs, downstream, mergeHosts, router, store, vault, channels = {}, importer, specStatus = null, voiceRules, scope, compose, outputs,
  sinks = [], gauges = {}, executors = [], agentDefs = {}, hooks = {}, routes = [], checks = {}, stepRuns, metrics = {},
  endpoints = {}, roleHandlers = {}, tracker, ports: hostPorts = {},
} = {}) {
  const vaultStore = vault || createVault({ db });
  // The env the modules see: real env values win, a vault secret fills a missing name. Never logged or stored.
  const mergedEnv = async () => { try { return await vaultStore.withVault(env); } catch { return env; } };
  const clock = typeof now === 'function' ? now : () => now;
  const doFetch = fetch || ((...a) => globalThis.fetch(...a));
  const packs = createPacks({ db, now: clock, config: config.packs || {}, channels, ...(importer ? { importer } : {}) });
  const dcfg = config.describe || {};
  const secrets = vaultStore;
  let appReady = false; // refreshed at the start of each tick: do the vault's GitHub App credentials exist
  const tokenProvider = secrets ? createInstallationTokenProvider({ vault: secrets, fetch: doFetch, now: clock }) : null;
  const githubApp = secrets ? (request, origin) => createGithubApp({ vault: secrets, fetch: doFetch, now: clock, consoleToken: env.CONSOLE_TOKEN, config: { org: config.vcs?.repo?.split('/')[0], ...(config.githubapp || {}), baseUrl: config.githubapp?.baseUrl || origin } })(request) : null;
  const l3 = createConsoleL3({ db, now: clock, config: { version: config.version } });
  // Issue #201: the routes and ports of the build-out modules (walkthrough, dashboard, proxy guide, model port, stage 2, slots).
  const sla = createSla({ db, now: clock, config: config.sla || {} });
  const surfaces = createSurfaces({ db, config, env, fetch: doFetch, now: clock, l3, sla, elicit: null, endpoints, roleHandlers, tracker, ports: hostPorts });
  const describeScope = scope || dcfg.scope || {};
  const describeVoice = voiceRules || dcfg.voice_rules || {};
  const describeSpec = specStatus || dcfg.spec_status || null;

  async function describePacks() {
    try {
      return (await packs.status()).map(p => ({ id: p.id, enabled: !!p.enabled }));
    } catch { return []; }
  }

  // A missing secret becomes one decision card per name, filed once (the id is stable), default in effect, closed by its probe.
  async function fileRunnerCards(names) {
    // Every ask goes through the access preflight: a name that is available, or that no route could prove missing, files no card.
    const e = await mergedEnv();
    const actx = { db, now: clock, fetch: doFetch, env: e, settings: config, config: { vaultHas: async n => Boolean(e[n]) } };
    for (const name of names) {
      const probe = name.startsWith('config.') ? 'manual' : `env:${name}`;
      await askOwner(actx, { id: `runner-needs-${name.replace(/[^A-Za-z0-9]+/g, '-')}`, capability: name.startsWith('config.') ? 'config.setting' : 'secret.available', subject: name,
        what: `runner needs: ${name}`, why_gated: 'The runner is enabled in the configuration but this setting is missing, so it cannot open pull requests.',
        default_in_effect: 'the runner is skipped; every other loop keeps running', prepared_by_fleet: 'org', closing_probe: probe });
    }
  }

  // US-09-R01, R08: the global kill switch (core/router/caps) and the capability matrix (core/ladder) reach every router this org builds. A store that has not applied the
  // caps migration yet has no switch row to read, which reads as off; any other error is the router's to refuse on.
  const routerPorts = {
    killSwitch: async () => { try { return await killSwitchPort(db)(); } catch (e) { if (/no such table/i.test(String(e?.message))) return false; throw e; } },
    matrix: async q => { try { return await ladderCandidates(db, q); } catch (e) { if (/no such table/i.test(String(e?.message))) return []; throw e; } },
  };
  const runnerOn = () => !(config.runner?.enabled === false || (config.runner?.enabled !== true && !config.vcs?.repo));
  function runnerSteps(env) {
    // On by default wherever a repository is configured: a deployment builds its own backlog without being switched on.
    // config.runner.enabled === false is the only way to turn it off; missing credentials become cards, never a silent idle.
    if (!runnerOn()) return [];
    const need = runnerNeeds(config, env, { vcsInjected: !!vcs, appCredentials: appReady });
    if (need.length) return [{ name: 'runner_needs', run: async (_db, ctx) => { await fileRunnerCards(need); ctx.notes.push(`runner skipped: needs ${need.join(', ')}`); } }];
    // Nothing is missing any more: every runner-needs card is answered, including ones for a route that was never used
    // because another provider covered it (a card whose probe can never pass would otherwise stay open for ever).
    const answered = { name: 'runner_needs_close', run: async (_db, ctx) => { const u = await db.prepare(`UPDATE gate_cards SET status='closed' WHERE id LIKE 'runner-needs-%' AND status='open'`).run(); if (u.meta.changes) ctx.notes.push(`runner_needs_close: ${u.meta.changes} card(s) closed, the runner has what it needs`); } };
    const r = router || createRouter({ db, fetch: doFetch, now: clock, config: config.router, env, ai: env.AI || null, ...routerPorts });
    const v = vcs || createGithubVcs({ fetch: doFetch, repo: config.vcs.repo, base: config.vcs.base || 'main', env, tokenEnv: config.vcs?.token_env || 'VCS_TOKEN', ...(!env[config.vcs?.token_env || 'VCS_TOKEN'] && appReady && tokenProvider ? { tokenProvider } : {}) });
    const steps = runnerExtraSteps(createRunner({ db, now: clock, config: { ...config, runner: { ...(config.runner || {}), enabled: true } }, env, router: r, claims, vcs: v }));
    // Self-hosting (issue #13): an outer spend cap around every runner step, on top of the router's own caps.
    return [answered, ...(on('selfdoer') ? guardSteps(steps, { db, now: clock, caps: config.selfdoer.caps || {} }) : steps)];
  }

  // Opt-in modules: each is off unless config.<name>.enabled === true; its ports come from the injections above.
  const on = name => config[name]?.enabled === true;
  // OWNERLINK-1: the owner action page is always served; its tick step (waiting PRs, closed asks) runs when config.ownerlink is present.
  const ownerlink = () => createOwnerlink({ db, vault: vaultStore, fetch: doFetch, now: clock, config, env: env_cache, doors: config.doors });
  let env_cache = env;
  let built = null; // built on first use, so an agents flag without router config costs nothing until a turn runs
  const lazyRouter = { call: (...a) => (built ||= createRouter({ db, fetch: doFetch, now: clock, config: config.router, env, ai: env.AI || null, ...routerPorts })).call(...a) };
  const agents = on('agents')
    ? createAgents({ db, router: router || lazyRouter, now: clock, config: config.agents, hooks })
    : null;
  if (agents) for (const [name, def] of Object.entries(agentDefs)) agents.define(name, def);
  const elicit = on('elicit') ? createElicit({ db, now: clock, config: config.elicit }) : null;
  // AUDIT-1: hash-chained action log (core/audit). Off unless config.audit.enabled; config.audit.bucket_binding names an optional R2 binding in env.
  const audit = on('audit') ? createAudit({ db, now: clock, config: { tenant: config.org_slug || 'org', ...config.audit }, bucket: env[config.audit.bucket_binding || 'AUDIT_BUCKET'] || null }) : null;
  const containersFor = e => (on('containers') && executors.length
    ? createContainers({ db, now: clock, config: config.containers, executors, secrets: (config.containers.secret_env || []).map(n => e[n]).filter(Boolean) }) : null);
  const infraRoutes = () => {
    const r = [...routes];
    if (agents) r.push({ prefix: '/api/agents', methods: ['POST'], tokenEnv: 'CONSOLE_TOKEN', handler: async request => {
      const m = new URL(request.url).pathname.match(/^\/api\/agents\/([a-z][a-z0-9-]*)\/turn$/);
      if (!m) return Response.json({ error: 'not found' }, { status: 404 });
      let body; try { body = await request.json(); } catch { return Response.json({ error: 'json body required' }, { status: 400 }); }
      if (!body || typeof body.session !== 'string' || typeof body.text !== 'string') return Response.json({ error: 'session and text required' }, { status: 400 });
      return Response.json(await agents.turn(m[1], body.session, body.text));
    } });
    if (elicit) r.push({ prefix: '/api/elicit', methods: ['GET'], tokenEnv: 'CONSOLE_TOKEN', handler: async request => {
      const u = new URL(request.url), project = u.searchParams.get('project');
      if (!project) return Response.json({ error: 'project required' }, { status: 400 });
      if (u.pathname === '/api/elicit/readiness') return Response.json(await elicit.readiness(project));
      if (u.pathname === '/api/elicit/asks') return Response.json(await elicit.nextAsks(project));
      return Response.json({ error: 'not found' }, { status: 404 });
    } });
    return r;
  };

  // The ports of the build-out modules (core/org/buildout.js). A host injects the ones only it can build (`ports`); the others are built here from what this
  // org already has, and only when what they need is configured, so an org with no model or no analytics account runs each step as it did without them.
  const elicitInst = elicit || surfaces.elicit;
  const attempt = f => { try { return f(); } catch { return undefined; } }; // a bad configuration value costs its one port, never the whole tick
  function buildoutPortsFor(env_) {
    const models = surfaces.models;
    const modelsReady = Boolean(config.modelport?.aliases && Object.keys(config.modelport.aliases).length);
    // The managers' model calls (a research proposal, a plus, a task of the fleet) go through the model port by alias: the manager's, else the doer's.
    const complete = req => models.complete(models.roles.manager || models.roles.doer, { messages: req.messages, max_tokens: req.max_tokens });
    const readers = [attempt(() => firstPartyReader({ db, now: clock, ...(config.plus?.reader?.first_party || {}) }))].filter(Boolean);
    const cf = config.plus?.reader?.cloudflare;
    if (cf?.zones && Object.keys(cf.zones).length) { const r = attempt(() => cloudflareAnalyticsReader({ fetch: doFetch, env: env_, token_env: cf.token_env, zones: cf.zones, window_h: cf.window_h, now: clock })); if (r) readers.push(r); }
    return {
      readFile, metrics, env: env_, sla, l3, models, tracker: surfaces.tracker(env_),
      ...(readers.length ? { reader: composeReaders(readers) } : {}),
      ...(Array.isArray(config.plus?.products) && config.plus.products.length ? { adopt: async () => config.plus.products } : {}),
      ...(modelsReady ? {
        research: createResearchAgent({ complete, readFile, config: config.staff }), propose: createPlusProposer({ complete }),
        // a fleet task names an alias of the model port in its allowed_models; the port refuses an unknown one with its reason
        ai: async ({ model, prompt, max_tokens }) => { const r = await models.complete(model, { messages: [{ role: 'user', content: prompt }], max_tokens }); if (!r.ok) throw new Error(r.error); return { text: r.text, cost: 0 }; },
      } : {}),
      ...(elicitInst ? { elicit: elicitInst, catalog: surfaces.catalog, readiness: project => elicitInst.readiness(project), readback: async project => ({ readback: (await elicitInst.readBack(project)).statements }) } : {}),
      ...hostPorts,
    };
  }

  const cctx = () => ({ db, now: clock, config: config.claims || {} });
  const defaultOutputs = async days => (await db.prepare(`SELECT COUNT(*) AS n FROM items WHERE status = 'done' AND updated_at >= ?`).bind(iso(clock() - days * 86400e3)).first()).n;

  // Order: kernel L2, claims, describe, yield, docgate, packs, runner. Each is its own guarded step.
  function extraSteps(env_ = env) {
    const steps = [
      ...L2_EXTRA_STEPS,
      { name: 'claims_reap', run: async (_db, ctx) => { const r = await claims.reapExpired(cctx()); ctx.notes.push(`claims reaped: ${JSON.stringify(r)}`); } },
      { name: 'claims_release_terminal', run: async (_db, ctx) => { const r = await claims.releaseTerminal(cctx()); ctx.notes.push(`claims released on terminal items: ${JSON.stringify(r)}`); } },
      // US-08-R19: a claim linked to a pull request is released when that pull request merges or has stayed closed. The reading of a pull request is a port of the host: either
      // `readPull(repo, number)` itself, or `pullReader({ fetch, env, tokenEnv })` that builds it from the token the organization holds (adapters/github/pulls.js githubPullReader).
      { name: 'claims_pr_reap', run: async (_db, ctx) => {
        const tokenEnv = config.vcs?.token_env || 'VCS_TOKEN';
        const readPull = hostPorts.readPull || (hostPorts.pullReader && typeof env_[tokenEnv] === 'string' && env_[tokenEnv] ? hostPorts.pullReader({ fetch: doFetch, env: env_, tokenEnv }) : null);
        if (!readPull) { ctx.notes.push('claims_pr_reap: skipped, no readPull port'); return; }
        const r = await claims.reapClosedPulls(cctx(), { readPull });
        ctx.notes.push(`claims released on pull requests: ${r.released.length} released, ${r.kept.length} kept, ${r.unmeasured.length} unmeasured`);
      } },
      // US-08-R22: retention, at most once a day (the marker is a `pruned` event).
      { name: 'claims_prune', run: async (_db, ctx) => { const r = await claims.pruneIfDue(cctx()); ctx.notes.push(`claims pruned: ${r ? JSON.stringify(r) : 'not due'}`); } },
      { name: 'describe', run: async (d, ctx) => describeExtraSteps({ fetch: doFetch, readFile, specStatus: describeSpec, packs: await describePacks(), scope: describeScope, compose, voiceRules: describeVoice })[0].run(d, ctx) },
      // waste (opt-in) runs the same yield sweep and then the gauge rules, so it replaces the yield step rather than doubling it.
      on('waste')
        ? { name: 'waste', run: async (_db, ctx) => { const r = await wasteRun({ db, now: clock, config: { ...(config.yield || {}), ...config.waste }, outputs: outputs || defaultOutputs, gauges }); ctx.notes.push(`waste: ${r.filed} filed, ${r.closed} closed, ${r.gauge_findings} gauge findings`); } }
        : { name: 'yield', run: async (_db, ctx) => { const r = await yieldSweep({ db, now: clock, config: config.yield || {}, outputs: outputs || defaultOutputs }); ctx.notes.push(`yield: ${r.filed} filed, ${r.closed} closed`); } },
    ];
    if (store) steps.push({ name: 'docgate', run: async (_db, ctx) => { const r = await docgateSweep({ db, now: clock, config: config.docgate || {}, store }); ctx.notes.push(`docgate: ${JSON.stringify(r)}`); } });
    steps.push({
      name: 'packs',
      run: async (d, ctx) => { for (const s of await packs.packSteps()) await s.run(d, ctx); }, // each pack step guards and records its own failure
    });
    // Downstream loop (issue #183): ready or claimed items of config.downstream.kind (default 'brief') become one GitHub issue each in
    // config.downstream.repo, opened through the GitHub App installation token, never a workflow GITHUB_TOKEN. The outcome row
    // (github / open_issue) is both the record and the idempotency key, and feeds the trust ledger. `downstream` can be injected (tests).
    if (on('downstream')) steps.push({ name: 'downstream_issues', run: async (_db, ctx) => {
      const d = config.downstream;
      const gh = downstream || (appReady && tokenProvider && d.repo ? createDownstreamGithub({ fetch: doFetch, repo: d.repo, tokenProvider, base: d.base || 'main' }) : null);
      if (!gh) { ctx.notes.push('downstream_issues skipped: needs the GitHub App connected and downstream.repo'); return; }
      const rows = (await db.prepare(`SELECT id, title, done_check FROM items WHERE kind=? AND status IN ('ready','claimed')
        AND id NOT IN (SELECT item_id FROM outcomes WHERE surface='github' AND action_class='open_issue' AND result='verified' AND item_id IS NOT NULL) ORDER BY priority, created_at LIMIT ?`)
        .bind(d.kind || 'brief', d.max_per_tick ?? 5).all()).results || [];
      let opened = 0, failed = 0;
      for (const it of rows) {
        try {
          const r = await gh.openIssue({ key: it.id, title: it.title, body: `Done check: ${it.done_check}`, labels: d.labels || [] });
          await db.prepare(`INSERT INTO outcomes (item_id, agent, surface, action_class, result, evidence) VALUES (?, 'downstream', 'github', 'open_issue', 'verified', ?)`).bind(it.id, r.url).run();
          opened++;
        } catch (e) { failed++; ctx.notes.push(`downstream_issues: ${it.id}: ${String(e.message).slice(0, 120)}`); }
      }
      ctx.notes.push(`downstream_issues: ${opened} opened, ${failed} failed`);
    } });
    // Specification-to-code loop, before the runner so the items it files this tick are takeable this tick. On by default:
    // the specifications are read from config.specloop (file paths or repositories), else from the repository the runner
    // writes to. Nobody files, targets or closes these items by hand.
    // Criticality (CRIT-1..7): work nobody can start on is given a specification to write, and the loop measures whether it
    // moves. On wherever the runner is; config.criticality.enabled === false turns it off.
    const crit = runnerOn() ? criticalitySteps({ db, now: clock, config: { spec_dir: config.specloop?.spec_dir, ...(config.criticality || {}) },
      evalProbe: it => evalProbe(db, { env: presence(env_) }, it), needs: async () => runnerNeeds(config, env_, { vcsInjected: !!vcs, appCredentials: appReady }) }) : { before: [], after: [] };
    steps.push(...crit.before);
    {
      const sc = { spec_repo: config.vcs?.repo, code_repo: config.vcs?.repo, ref: config.vcs?.base, ...(config.specloop || {}) };
      const tokenEnv = config.vcs?.token_env || 'VCS_TOKEN';
      const st = specloopStep({ db, now: clock, config: sc, readFile, fetch: doFetch, token: typeof env_[tokenEnv] === 'string' ? env_[tokenEnv] : null });
      if (st) steps.push(st);
    }
    steps.push(...runnerSteps(env_));
    // Merge under the trust ladder (issue #183, opt-in config.codeloop.enabled): a runner pull request that passed checks and
    // review is merged by core/codeloop only when its gate allows it (rung of <trust_surface>/merge in the trust ledger at or
    // above merge_min_rung, no protected path, file limit, kill switch off). The route is the GitHub App installation token
    // (or injected `mergeHosts`); a merge is recorded as an outcome so the same ledger keeps scoring it. After the runner
    // steps, so a PR opened this tick can merge in it.
    // On by default wherever the runner is (CRIT-5): a reviewed, green pull request that nothing merges is a loop left open.
    // merge_min_rung defaults to 'delegated', the rung the policy defines as "merges after a different agent's review passes",
    // which is exactly what the gate checks (reviewer approved, checks passed); the ledger then scores every merge.
    const codeloopOn = config.codeloop?.enabled === true || (config.codeloop?.enabled !== false && runnerOn());
    if (codeloopOn) steps.push({ name: 'codeloop_merge', run: async (_db, ctx) => {
      const c = { merge_min_rung: 'delegated', ...(config.codeloop || {}) }, surface = c.trust_surface || 'repo', repo = c.repo || config.vcs?.repo;
      const tokenEnv = config.vcs?.token_env || 'VCS_TOKEN';
      // Two routes to the merge (no single route): the GitHub App installation token, else the repository token the runner already uses.
      const provider = appReady && tokenProvider ? tokenProvider : (typeof env_[tokenEnv] === 'string' && env_[tokenEnv] ? async () => env_[tokenEnv] : null);
      const hosts = mergeHosts || (provider && repo ? [createDownstreamGithub({ fetch: doFetch, repo, tokenProvider: provider, base: config.vcs?.base || 'main' }).mergeHost()] : null);
      if (!hosts) { ctx.notes.push('codeloop_merge skipped: needs a repository token or the GitHub App, and vcs.repo'); return; }
      const rung = async () => (await db.prepare(`SELECT rung FROM trust_ledger WHERE surface=? AND action_class='merge'`).bind(surface).first())?.rung
        || config.policy?.surfaces?.[surface]?.start_rung || 'observed';
      // The files a run changed come from its stored patch. A run with no readable patch is refused, never merged blind.
      const UNKNOWN = '(files unknown)';
      const filesOf = async id => {
        const raw = (await db.prepare(`SELECT patch_json FROM runner_runs WHERE id=?`).bind(id).first())?.patch_json;
        let files = []; try { files = JSON.parse(raw || '[]'); } catch { files = []; }
        const paths = Array.isArray(files) ? files.map(f => f && f.path).filter(p => typeof p === 'string' && p) : [];
        return paths.length ? paths : [UNKNOWN];
      };
      const out = await codeloopSweep({ db, now: clock, config: { ...c, protected_paths: [...(c.protected_paths || []), UNKNOWN] }, hosts, rung }, { limit: c.max_per_tick ?? 3, filesOf, killed: c.killed === true });
      for (const m of out.filter(x => x.merged)) {
        const r = await db.prepare(`SELECT item_id, pr_url, pr_number FROM runner_runs WHERE id=?`).bind(m.run).first();
        await db.prepare(`INSERT INTO outcomes (item_id, agent, surface, action_class, result, evidence) VALUES (?, 'codeloop', ?, 'merge', 'verified', ?)`)
          .bind(r.item_id, surface, `merged ${r.pr_url || 'PR ' + r.pr_number} via ${m.host}`).run();
      }
      const refused = out.filter(x => !x.merged).map(x => x.reason);
      ctx.notes.push(`codeloop_merge: ${out.length - refused.length} merged, ${refused.length} not merged${refused.length ? ' (' + [...new Set(refused)].join(', ') + ')' : ''}`);
    } });
    // Self-hosting backlog: the specification backlog (tools/spec_backlog.py --json) and a target map, both read through readFile.
    if (on('selfdoer') && readFile && config.selfdoer.backlog_path) steps.push({ name: 'selfdoer_seed', run: async (_db, ctx) => {
      const items = JSON.parse(await readFile(config.selfdoer.backlog_path));
      const targets = config.selfdoer.targets_path ? JSON.parse(await readFile(config.selfdoer.targets_path)) : {};
      const r = await seedBacklog(db, Array.isArray(items) ? items : [], targets);
      ctx.notes.push(`selfdoer_seed: ${r.seeded} seeded (${r.ready} ready, ${r.open} open), ${r.existing} already present`);
    } });
    // Opt-in loops, after the runner so they never delay it. Each is its own guarded step.
    if (on('steward') && sinks.length) steps.push({ name: 'steward', run: async (_db, ctx) => { const r = await stewardRun({ db, now: clock, config: config.steward, sinks }); ctx.notes.push(`steward: ${r.synced} synced, ${r.failed} failed, ${r.unplaced.length} unplaced, ${r.filed} filed`); } });
    if (on('ownerwatch')) steps.push({ name: 'ownerwatch', run: async (_db, ctx) => { const r = await watchOwnerSteps({ db, now: clock, config: config.ownerwatch, env: presence(env_), fetch: doFetch }); ctx.notes.push(`ownerwatch: ${JSON.stringify(r)}`); } });
    const containers = containersFor(env_);
    if (containers) steps.push({ name: 'containers', run: async (_db, ctx) => { const reaped = await containers.reap(); const ran = await containers.runNext(); ctx.notes.push(`containers: reaped ${JSON.stringify(reaped)}, ran ${ran ? ran.status || ran.skipped : 'none'}`); } });
    if (config.ownerlink && config.ownerlink.enabled !== false) steps.push({ name: 'ownerlink', run: async (_db, ctx) => { env_cache = env_; const r = await ownerlink().step(); ctx.notes.push(`ownerlink: ${JSON.stringify(r)}`); } });
    if (on('ignorance')) steps.push(ignoranceStep({ db, now: clock, config, env: env_, fetch: doFetch }));
    if (agents) steps.push({ name: 'agents', run: async (_db, ctx) => { await agents.expire(); ctx.notes.push('agents: expired approvals swept'); } });
    if (audit) steps.push(audit.step());
    if (elicit) steps.push({ name: 'elicit', run: async (_db, ctx) => {
      let n = 0; for (const r of (await db.prepare(`SELECT DISTINCT project FROM elicit_needs WHERE state='asked'`).all()).results || []) n += await elicit.expire(r.project);
      ctx.notes.push(`elicit: ${n} asks defaulted on timeout`);
    } });
    if (on('console_l3') && typeof stepRuns === 'function') steps.push({ name: 'console_l3', run: async (_db, ctx) => { const f = await l3.sweepStepBudgets(await stepRuns()); ctx.notes.push(`console_l3: ${f.length} step-budget findings`); } });
    if (on('infra')) steps.push({ name: 'infra', run: async (_db, ctx) => { await heartbeat({ db, now: clock }, 'tick', config.infra.tick_every_minutes ?? null); ctx.notes.push('infra: tick heartbeat recorded'); } });
    // Spec build-out modules (issue #201): on by default, each off only by config.<name>.enabled === false.
    steps.push(...buildoutSteps({ db, config, now: clock, fetch: doFetch, claims, ports: buildoutPortsFor(env_) }));
    steps.push(...surfaces.steps(env_));
    steps.push(...crit.after);
    return steps;
  }

  async function tick() {
    try { appReady = secrets ? await hasAppCredentials(secrets) : false; } catch { appReady = false; }
    const e = await mergedEnv();
    // Let an unclaimed first-run window expire (and file its card) even if nobody visits; not a tick step, so the step list is unchanged.
    if (config.doors) await sweepFirstRun(db, { now: clock(), config: config.doors, hasKey: Boolean(e.CONSOLE_TOKEN) || Boolean(config.doors?.access?.team_domain) || Boolean(config.doors?.iap?.audience) }).catch(() => {});
    // US-04-R01, R05: the plus loop's reserved share is taken off the kernel's slots before it allocates, so the programs share what is left. A store without the plus tables keeps the kernel's own slots.
    let kernel = config.kernel;
    if (config.plus?.enabled !== false) { try { kernel = await plusSlotsConfig(db, { config, now: clock(), kernel: config.kernel || {} }); } catch { kernel = config.kernel; } }
    return runTick(db, { config: { ...config, ...(kernel ? { kernel } : {}), executor_takes_targeted: runnerOn() }, env: presence(e), now: clock(), extraSteps: extraSteps(e), metrics });
  }

  async function handle(request) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === '/health') {
      // US-03-R20: the newest tick that finished, or one that has been running longer than any tick should (INFLIGHT_MS): a probe that lands while a tick is running reads the one before it.
      const last = await db.prepare(`SELECT id, started_at, finished_at, steps_completed, steps_total, report, errors FROM tick_runs WHERE finished_at IS NOT NULL OR started_at < ? ORDER BY id DESC LIMIT 1`).bind(iso(clock() - INFLIGHT_MS)).first();
      // US-13-R21: a clock that stopped is not healthy because its last tick finished; the dashboard's verdict is stalled when no tick is newer than the bound.
      let verdict = null; try { verdict = await l3.health(); } catch { verdict = null; }
      let bindingsOk = true; try { await db.prepare('SELECT 1 AS ok').first(); } catch { bindingsOk = false; }
      const ok = Boolean(last && last.steps_completed === last.steps_total) && bindingsOk && verdict?.verdict !== 'stalled';
      // Issue #173 probe: claims released with no work in the last 24 h (dispatch that nothing executed).
      const since = new Date(clock() - 864e5).toISOString().slice(0, 19).replace('T', ' ');
      let unworked = null;
      try { unworked = (await db.prepare(`SELECT COUNT(*) AS n FROM outcomes WHERE surface='dispatch' AND action_class='claim_release' AND result='unworked' AND at >= ?`).bind(since).first())?.n ?? 0; } catch { /* store without the table */ }
      // US-11-R01: the fields every member of a fleet reports (status, worker, version, enabled, bindings_ok), beside the ones this route always had.
      return Response.json({ ok, status: ok ? 'ok' : 'degraded', org: config.org_slug, worker: config.org_slug ?? null, version: config.version ?? null, enabled: true, bindings_ok: bindingsOk,
        ...(verdict ? { verdict: verdict.verdict, tick_age_s: verdict.tick_age_s } : {}), last_tick: last || null, claims_released_unworked_24h: unworked }, { status: ok ? 200 : 503 });
    }
    if (p === '/owner' || p.startsWith('/owner/') || p === '/api/owner/actions') { env_cache = await mergedEnv(); const r = await ownerlink().handle(request); if (r) return r; }
    // US-11-R01, R06: the fleet's status, the dispatcher's second route and the execute route, for the console token (the same bearer the audit route takes). core/org keeps its own /health.
    if (p === '/fleet/status' || p === '/fleet/dispatch' || p === '/fleet/execute') {
      const e = await mergedEnv(), tok = e.CONSOLE_TOKEN, authorize = rq => Boolean(tok) && rq.headers.get('authorization') === 'Bearer ' + tok;
      if (!(await authorize(request))) return Response.json({ error: 'unauthorized' }, { status: 401 });
      const fp = buildoutPortsFor(e);
      return fleetHandle(request, { db, now: clock, config: config.fleet || {}, fetch: doFetch, claims, ai: fp.ai, deployed: fp.deployed, bindings: fp.bindings, executor: fp.executor, authorize });
    }
    if (secrets && config.vcs?.repo && p.startsWith('/console/github/signin')) return createSignin({ vault: secrets, fetch: doFetch, now: clock, repo: config.vcs.repo })(request);
    if (githubApp && p.startsWith('/console/github/')) return githubApp(request, url.origin);
    if (p === '/console' || p.startsWith('/console/') || p.startsWith('/api/console') || p === '/api/staff' || p.startsWith('/api/staff/')) {
      const e = await mergedEnv();
      return handleConsole(request, { DB: db, CONSOLE_TOKEN: e.CONSOLE_TOKEN }, { org: config.org_slug, vault: vaultStore, doors: config.doors, config, l3, mounts: surfaces.mounts, decorate: surfaces.decorate, fetch: doFetch, now: clock, envNames: presence(e) });
    }
    if (on('infra') && (p === '/health/deep' || p.startsWith('/api/agents') || p.startsWith('/api/elicit') || routes.some(r => p.startsWith(r.prefix)))) {
      const e = await mergedEnv();
      const r = await createInfra({ routes: infraRoutes(), env: e, db, now: clock, config: config.infra, checks }).dispatch(request);
      if (r) return r;
    }
    if (audit && (p === '/audit' || p.startsWith('/audit/'))) { const e = await mergedEnv(), tok = e.AUDIT_TOKEN || e.CONSOLE_TOKEN; const r = await audit.handle(request, { authorize: rq => Boolean(tok) && rq.headers.get('authorization') === 'Bearer ' + tok }); if (r) return r; }
    if (on('public_metrics')) { const r = await handlePublicMetrics(request, { db, now: clock(), config }); if (r) return r; }
    if (ROUTES.has(p.replace(/\/+$/, '') || '/')) {
      return describeHandle(request, { db, now: clock(), specStatus: describeSpec, packs: await describePacks(), scope: describeScope, compose, voiceRules: describeVoice,
        probe: { fetch: doFetch, readFile, specStatus: describeSpec }, min_probe_interval_seconds: dcfg.min_probe_interval_seconds });
    }
    return null;
  }

  // What a scheduler calls: one tick per slot, so a cron that fires twice runs once (adapters/shared/slot.js). tick() stays unconditional.
  const scheduledTick = () => surfaces.scheduledTick(tick);

  return { extraSteps, tick, scheduledTick, handle, packs, agents, elicit, audit, surfaces, models: surfaces.models, roleRuntime: surfaces.roleRuntime, buildoutPorts: buildoutPortsFor, stewardRollup: () => stewardRollup({ db }) };
}
