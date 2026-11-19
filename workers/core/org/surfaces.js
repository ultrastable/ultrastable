// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The routes and ports of the spec build-out modules that core/org did not wire (issue #201, second half).
//  Routes, owner-only (mounted inside the signed-in console, so a viewer or an anonymous caller never reaches them):
//    core/walkthrough      /api/console/walkthrough*, /api/console/readback, /console/readback, /api/console/profile
//    core/console-l3       /console/dashboard (page), /console/dashboard/api/{state,integration,loop,refresh}, /console/dashboard/health
//    core/doors/proxy.js   /api/console/proxy (identity-aware proxy guide status; its cards are filed by the proxy_guide tick step)
//  Ports the host would otherwise have to supply:
//    core/modelport       models (alias -> endpoint) and the role runtime; endpoints come from the environment (Workers AI binding,
//                          a GitHub token) or are injected. Step `modelport` runs the deploy check; a failing check is thrown so the
//                          tick files it as a backlog item. Step `role_runtime` works queued dispatches when handlers are injected.
//    adapters/github/stage2 the tracker (REST issues) and the `stage2` step: adopt, mirror and prove "items match open issues".
//    adapters/shared/slot   scheduledTick() in the composition root: at most one tick per slot for a scheduler that fires twice.
// Everything is on by default; each is turned off only by `config.<name>.enabled === false`, and a missing port is a note in the
// tick, never a silent idle. Ports only: db, env, fetch, now. No secret value is read here beyond handing the token env to the tracker.
import walkthroughCatalog from '../walkthrough/catalog.json' with { type: 'json' };
import proxyGuideData from '../doors/proxy-guide.json' with { type: 'json' };
import { createWalkthrough } from '../walkthrough/index.js';
import { createElicit } from '../elicit/index.js';
import { createDashboard } from '../console-l3/dashboard.js';
import { createProxyGuide, proxyKind } from '../doors/proxy.js';
import { createModelPort, createRoleRuntime } from '../modelport/index.js';
import { githubModelsEndpoint, workersAiEndpoint } from '../ignorance/models.js';
import { githubTracker, mirrorClaims, mirrorDecisions, stage2Probe } from '../../adapters/github/stage2.js';
import { runOncePerSlot, SLOT_MS } from '../../adapters/shared/slot.js';

/** Route prefixes and exact paths each mounted surface answers, so tests and the owner page can list them. */
export const SURFACE_ROUTES = {
  walkthrough: ['/api/console/walkthrough', '/api/console/walkthrough/idea', '/api/console/walkthrough/answer', '/api/console/readback', '/console/readback', '/api/console/profile'],
  dashboard: ['/console/dashboard'],
  proxy: ['/api/console/proxy'],
};
/** The step names this module adds when their inputs exist. core/org tests assert each appears. */
export const SURFACE_STEPS = ['modelport', 'role_runtime', 'stage2', 'proxy_guide'];

const off = (config, key) => config?.[key]?.enabled === false;
const sameOrigin = request => { const o = request.headers.get('origin'); return Boolean(o) && o === new URL(request.url).origin; };
const noStore = r => { if (r && !r.headers.get('cache-control')) r.headers.set('cache-control', 'no-store'); return r; };

/**
 * createSurfaces({ db, config, env, fetch, now, l3, sla, elicit, endpoints, roleHandlers, tracker })
 *   -> { mounts, steps(env), walkthrough, dashboard, models, roleRuntime, tracker(env), proxyGuide(env), scheduledTick(tick) }
 * `endpoints` (injected) are added to the environment-derived model endpoints; `tracker` (injected) replaces the GitHub one.
 */
export function createSurfaces({ db, config = {}, env = {}, fetch, now = () => Date.now(), l3, sla = null, elicit = null, endpoints = {}, roleHandlers = {}, tracker = null } = {}) {
  const clock = typeof now === 'function' ? now : () => now;
  const presence = e => Object.fromEntries(Object.entries(e || {}).map(([k, v]) => [k, typeof v === 'string' ? v !== '' : v != null && v !== false]));

  // ---- routes ----
  const walkthrough = off(config, 'walkthrough') ? null
    : createWalkthrough({ db, elicit: elicit || createElicit({ db, now: clock, config: config.elicit }), now: clock, config: { catalog: walkthroughCatalog, ...(config.walkthrough || {}) } });
  const dashboard = off(config, 'dashboard') ? null : createDashboard({ db, l3, sla, now: clock, config: config.dashboard || {} });
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
    return runOncePerSlot(db, tick, { now: clock(), slotMs });
  }

  /** Added to GET /api/console for a signed-in owner: the three screens with their profile applied and Ask cards folded in.
   *  Additive (`screens`), so the console's own data and page are unchanged. */
  const decorate = walkthrough ? async (body, { actor }) => ({ screens: await walkthrough.screens(actor || 'owner', body) }) : null;

  return { mounts, decorate, steps, walkthrough, dashboard, models, roleRuntime, tracker: trackerFor, proxyGuide, scheduledTick };
}
