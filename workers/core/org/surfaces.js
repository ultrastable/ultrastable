// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The routes and ports of the spec build-out modules that core/org did not wire (issue #201, second half).
//  Routes, owner-only (mounted inside the signed-in console, so a viewer or an anonymous caller never reaches them):
//    core/walkthrough      /api/console/walkthrough*, /api/console/readback, /console/readback, /api/console/profile
//    core/console-l3       /console/dashboard (page), /console/dashboard/api/{state,integration,loop,refresh}, /console/dashboard/health
//    core/doors/proxy.js   /api/console/proxy (identity-aware proxy guide status; its cards are filed by the proxy_guide tick step)
//    core/staff/screen.js  /api/staff, /api/staff/<persona>/{act,reverse} (the person's screen for a role they fill; the signed-in login is the principal)
//  Ports the host would otherwise have to supply:
//    core/modelport       models (alias -> endpoint) and the role runtime; endpoints come from the environment (Workers AI binding,
//                          a GitHub token) or are injected. Step `modelport` runs the deploy check; a failing check is thrown so the
//                          tick files it as a backlog item. Step `role_runtime` works queued dispatches when handlers are injected.
//    adapters/github/stage2 the tracker (REST issues) and the `stage2` step: adopt, mirror and prove "items match open issues".
//    core/steward/stage     the `stage` step: the self-hosting stage computed from the organization's own records (US-20-R10 to R13), when config.stage or `ports.stageProbes` is given.
//    adapters/shared/slot   scheduledTick() in the composition root: at most one tick per slot for a scheduler that fires twice.
// Everything is on by default; each is turned off only by `config.<name>.enabled === false`, and a missing port is a note in the
// tick, never a silent idle. Ports only: db, env, fetch, now. No secret value is read here beyond handing the token env to the tracker.
import walkthroughCatalog from '../walkthrough/catalog.json' with { type: 'json' };
import proxyGuideData from '../doors/proxy-guide.json' with { type: 'json' };
import { createWalkthrough } from '../walkthrough/index.js';
import { createElicit } from '../elicit/index.js';
import * as predict from '../predict/index.js';
import { recordReadback } from '../kernel/lifecycle.js';
import { createToolLayer, handleStaffRequest } from '../staff/index.js';
import { stageStep, parsePublishedStage, checkPublished } from '../steward/stage.js';
import { createDashboard } from '../console-l3/dashboard.js';
import { createProxyGuide, proxyKind } from '../doors/proxy.js';
import { createModelPort, createRoleRuntime } from '../modelport/index.js';
import { vertexEndpoint } from '../modelport/endpoints.js';
import { githubModelsEndpoint, workersAiEndpoint } from '../ignorance/models.js';
import { githubTracker, mirrorClaims, mirrorDecisions, stage2Probe } from '../../adapters/github/stage2.js';
import { runOncePerSlot, SLOT_MS } from '../../adapters/shared/slot.js';

/** Route prefixes and exact paths each mounted surface answers, so tests and the owner page can list them. */
export const SURFACE_ROUTES = {
  walkthrough: ['/api/console/walkthrough', '/api/console/walkthrough/idea', '/api/console/walkthrough/answer', '/api/console/readback', '/console/readback', '/api/console/profile'],
  dashboard: ['/console/dashboard'],
  proxy: ['/api/console/proxy'],
  staff: ['/api/staff'],
};
/** The step names this module adds when their inputs exist. core/org tests assert each appears. */
export const SURFACE_STEPS = ['modelport', 'role_runtime', 'stage2', 'stage', 'proxy_guide'];

const off = (config, key) => config?.[key]?.enabled === false;
const sameOrigin = request => { const o = request.headers.get('origin'); return Boolean(o) && o === new URL(request.url).origin; };
const noStore = r => { if (r && !r.headers.get('cache-control')) r.headers.set('cache-control', 'no-store'); return r; };

/**
 * createSurfaces({ db, config, env, fetch, now, l3, sla, elicit, endpoints, roleHandlers, tracker, ports })
 *   -> { mounts, steps(env), walkthrough, elicit, catalog, dashboard, models, roleRuntime, tracker(env), proxyGuide(env), scheduledTick(tick) }
 * `endpoints` (injected) are added to the environment-derived model endpoints; `tracker` (injected) replaces the GitHub one.
 * `ports` (all optional): probe (the dashboard's reachability probe), analytics (its 24-hour requests and errors), stageProbes ({ contract, account }), publishedStage().
 */
export function createSurfaces({ db, config = {}, env = {}, fetch, now = () => Date.now(), l3, sla = null, elicit = null, endpoints = {}, roleHandlers = {}, tracker = null, ports = {} } = {}) {
  const clock = typeof now === 'function' ? now : () => now;
  const presence = e => Object.fromEntries(Object.entries(e || {}).map(([k, v]) => [k, typeof v === 'string' ? v !== '' : v != null && v !== false]));

  // ---- routes ----
  // The walkthrough asks through one elicit instance. It is given the predict port, so the value of an Ask is logged as a prediction and scored (US-16-R23), and its
  // read-back is recorded on the kernel project when the person is shown it, which is what the lifecycle gate G2 reads (US-15, US-16-R12). A project the kernel does not
  // have is a no-op (the update matches no row).
  const walkthroughElicit = off(config, 'walkthrough') ? null : (elicit || createElicit({ db, now: clock, config: config.elicit, predict }));
  const walkthrough = !walkthroughElicit ? null
    : createWalkthrough({ db, elicit: walkthroughElicit, now: clock, config: { catalog: walkthroughCatalog, ...(config.walkthrough || {}) }, onReadbackShown: (project, at) => recordReadback(db, project, at) });
  const dashboard = off(config, 'dashboard') ? null : createDashboard({ db, l3, sla, probe: ports.probe, analytics: ports.analytics, now: clock, config: config.dashboard || {} });
  const staff = off(config, 'staff') ? null : createToolLayer({ db, now: clock, config: config.staff || {} });
  const proxyGuide = e => createProxyGuide({ db, guide: proxyGuideData, config, env: presence(e), fetch, now: clock });

  const mounts = [];
  if (walkthrough) mounts.push(async (request, { actor }) => walkthrough.handle(request, { person: actor || 'owner' }));
  if (dashboard) mounts.push(async request => {
    const url = new URL(request.url);
    if (request.method === 'POST' && (url.pathname === '/console/dashboard' || url.pathname.startsWith('/console/dashboard/')) && !sameOrigin(request)) {
      return Response.json({ error: 'cross-origin request refused' }, { status: 403 });
    }
    return noStore(await dashboard.handle(request, { prefix: '/console/dashboard' }));
  });
  // The person's screen for a role (US-02-R18). Inside the signed-in console, so the principal is the login that signed in; with no named login (the console token,
  // an Access or IAP identity) the handler answers 401, because a role is held by a named person.
  if (staff) mounts.push(async (request, { actor }) => {
    const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '');
    if (!(path === '/api/staff' || path.startsWith('/api/staff/'))) return null;
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const r = await handleStaffRequest(staff, { method: request.method, path, principal: actor && actor !== 'access' ? actor : null, body });
    return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } });
  });
  if (!off(config, 'proxy_guide')) mounts.push(async request => {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname.replace(/\/+$/, '') !== '/api/console/proxy') return null;
    return Response.json(await proxyGuide(env).status({ origin: url.origin }), { headers: { 'cache-control': 'no-store' } });
  });

  // ---- ports ----
  /** Model endpoints the environment offers, plus injected ones. A name no alias uses is harmless. */
  const modelEndpoints = e => {
    const out = { ...endpoints };
    const tokenName = config.modelport?.token_env || 'GITHUB_TOKEN';
    if (typeof e[tokenName] === 'string' && e[tokenName] && !out.github_models) out.github_models = githubModelsEndpoint({ fetch, token: e[tokenName] });
    if (e.AI && !out.workers_ai) out.workers_ai = workersAiEndpoint({ ai: e.AI });
    // US-14-R10: Gemini on Vertex AI when the configuration names the project, the location and the setting that holds the token (its value is read at call time, never kept).
    const v = config.modelport?.vertex;
    if (v?.project && v?.location && v?.token_env && typeof e[v.token_env] === 'string' && e[v.token_env] && !out.vertex) out.vertex = vertexEndpoint({ fetch, project: v.project, location: v.location, tokenProvider: () => e[v.token_env] });
    return out;
  };
  const modelsFor = e => createModelPort({ config: config.modelport || {}, endpoints: modelEndpoints(e), env: presence(e) });
  const models = modelsFor(env);
  const roleRuntime = createRoleRuntime({ db, models, handlers: roleHandlers, now: clock, config: config.modelport?.runtime || {} });
  const trackerFor = e => {
    if (tracker) return tracker;
    const tokenEnv = config.vcs?.token_env || 'VCS_TOKEN';
    if (!config.vcs?.repo || !e[tokenEnv]) return null;
    return githubTracker({ fetch, repo: config.vcs.repo, env: e, tokenEnv });
  };

  function steps(e = env) {
    const out = [];
    if (!off(config, 'modelport') && config.modelport?.aliases) {
      out.push({ name: 'modelport', run: async (_db, ctx) => {
        const check = modelsFor(e).deployCheck();
        for (const w of check.warnings) ctx.notes.push(`modelport warning: ${w}`);
        if (!check.ok) throw new Error(`modelport deploy check failed: ${check.errors.join('; ')}`); // runTick records the failure and files it
        ctx.notes.push(`modelport: ok, doer ${check.doer?.family || 'none'}, reviewer ${check.reviewer?.family || 'none'}`);
      } });
      if (Object.keys(roleHandlers).length) out.push({ name: 'role_runtime', run: async (_db, ctx) => {
        const rt = createRoleRuntime({ db, models: modelsFor(e), handlers: roleHandlers, now: clock, config: config.modelport?.runtime || {} });
        ctx.notes.push(`role_runtime: ${JSON.stringify(await rt.runDispatches({ limit: config.modelport?.runtime?.max_dispatches ?? 20 }))}`);
      } });
    }
    if (!off(config, 'stage2')) out.push({ name: 'stage2', run: async (_db, ctx) => {
      const t = trackerFor(e);
      if (!t) { ctx.notes.push('stage2 skipped: needs config.vcs.repo and its token'); return; }
      const c = { db, now: clock, config, tracker: t };
      const probe = await stage2Probe(c);
      // Mirroring writes to the tracker, so it follows the probe and is switched by config.stage2.mirror (default on).
      const mirrored = config.stage2?.mirror === false ? null : { claims: await mirrorClaims(c), decisions: await mirrorDecisions(c) };
      ctx.notes.push(`stage2: ${probe.result}${mirrored ? `, claims ${mirrored.claims.posted} posted, decisions ${mirrored.decisions.synced} synced` : ''}${probe.reason ? ` (${probe.reason})` : ''}`);
    } });
    // US-20-R10 to R13: the self-hosting stage, computed from the records, never declared. It runs only when the deployment names its evidence (config.stage, or probes the host
    // supplies), because a stage with no probe is unknown and would file a STAGE item on every organization. The tracker probe of stage 2 is built here from the tracker.
    if (!off(config, 'stage')) out.push({ name: 'stage', run: async (_db, ctx) => {
      if (!config.stage && !ports.stageProbes) { ctx.notes.push('stage skipped: no config.stage and no stage probes'); return; }
      const t = trackerFor(e);
      const probes = { ...(t ? { stage2: () => stage2Probe({ db, now: clock, config, tracker: t }) } : {}), ...(ports.stageProbes || {}) };
      const computed = await stageStep({ db, now: clock, probes, config: config.stage || {} }).run(db, ctx);
      if (typeof ports.publishedStage === 'function' && computed) {
        const c = checkPublished({ published: parsePublishedStage(await ports.publishedStage()), computed });
        if (!c.ok) {
          const at = new Date(clock()).toISOString().replace('T', ' ').slice(0, 19);
          await db.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, created_at, updated_at) VALUES ('STAGE-PUBLISHED', ?, 'work', 'operations', ?, ?, 20, ?, ?)
            ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at, status=CASE WHEN items.status='done' THEN 'open' ELSE items.status END, disposition=CASE WHEN items.status='done' THEN NULL ELSE items.disposition END`)
            .bind(`The published stage is above the computed one: ${c.problems.join('; ')}`.slice(0, 300), 'the published stage does not exceed the computed stage', 'checkPublished returns ok', at, at).run();
          ctx.notes.push(`stage: ${c.problems.join('; ')}`);
        }
      }
    } });
    if (!off(config, 'proxy_guide')) out.push({ name: 'proxy_guide', run: async (_db, ctx) => {
      if (!proxyKind(config) && !config.doors?.proxy?.intended) { ctx.notes.push('proxy_guide: no identity-aware proxy named'); return; }
      ctx.notes.push(`proxy_guide: ${JSON.stringify(await proxyGuide(e).sweep())}`);
    } });
    return out;
  }

  /** At most one tick per slot (US-14-R03). `tick` is the org's tick(); a duplicate firing in the same slot is reported, not run.
   *  config.slots.slot_minutes (default 10) must not exceed the scheduler's own interval, or ticks are skipped. */
  async function scheduledTick(tick) {
    if (off(config, 'slots')) return { ran: true, slot: null, result: await tick() };
    const slotMs = config.slots?.slot_minutes ? config.slots.slot_minutes * 60e3 : SLOT_MS;
    return runOncePerSlot(db, tick, { now: clock(), slotMs, ...(config.slots?.overlap_minutes ? { noOverlapMs: config.slots.overlap_minutes * 60e3 } : {}) });
  }

  /** Added to GET /api/console for a signed-in owner: the three screens with their profile applied and Ask cards folded in.
   *  Additive (`screens`), so the console's own data and page are unchanged. */
  const decorate = walkthrough ? async (body, { actor }) => ({ screens: await walkthrough.screens(actor || 'owner', body) }) : null;

  return { mounts, decorate, steps, walkthrough, elicit: walkthroughElicit, catalog: walkthroughCatalog, dashboard, models, roleRuntime, tracker: trackerFor, proxyGuide, scheduledTick };
}
