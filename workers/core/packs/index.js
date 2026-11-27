// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The pack host (US-SPEC-21): registry, enable gate, guarded tick steps, kill switches. Core never imports a pack (US-21-R03);
// this host loads pack code by directory at run time through an injected importer.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { all, first, run, iso, ensureItem, assertReadOnly } from '../kernel/util.js';
import { registerProgram } from '../kernel/programs.js';
import { registerMetric } from '../kernel/metrics.js';
import { recordDecision } from '../kernel/decisions.js';
import { validateManifest, parseEntry } from './manifest.js';
import { sandboxDb, sandboxCtx, freezeGuard, scanPackSource } from './sandbox.js';
import { createRedactor, secretValuesFor, redactingSink } from './redact.js';
import { createBounceIntake } from './bounce.js';
import { applyPackMigrations, scanPackDirs } from './loader.js';
import { createGuard, sha256, setSwitch, engagedSwitches, rungCeilings, DEFAULT_RUNGS } from './guard.js';
import { createPackTrust } from './trust.js';
import { runChannelProbes, openTrial, lastProbes } from './probe.js';
import { createPackRoutes } from './routes.js';
import { guardTransport } from './transport.js';
import { createEgressFetch } from './egress.js';

export * from './manifest.js';
export * from './guard.js';
export { assertCoreImportsNoPacks } from './static-check.js';
export * from './sandbox.js';
export * from './loader.js';
export * from './bounce.js';
export * from './redact.js';
export * from './egress.js';
export * from './trust.js';
export * from './probe.js';
export * from './routes.js';
export * from './transport.js';
export const MIGRATIONS_DIR = (() => { try { return fileURLToPath(new URL('./migrations/', import.meta.url)); } catch { return null; } })(); // import.meta.url is not a URL inside a deployed Worker (live trial 2026-11-12, error 10021); only Node tooling and tests use this path

export function loadManifest(dir) { return JSON.parse(readFileSync(path.join(dir, 'pack.json'), 'utf8')); }

const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
const hasTable = async (db, name) => !!(await first(db, `SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?`, name));
const withTimeout = (p, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(Object.assign(new Error(`pack step exceeded ${ms} ms`), { timeout: true })), ms);
  Promise.resolve(p).then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
});

// config: { step_timeout_ms, tenant_names, rungs, act_rung, ceilings, manager_model, packs: { <id>: settings } }
export function createPacks({ db, now = Date.now, config = {}, channels = {}, deployRoute = null, env = {}, fetch: hostFetch = null, importer = d => import(pathToFileURL(d).href) } = {}) {
  // Secret values seen by any step (declared names resolved in env, secret-looking settings) are redacted from every pack log line.
  const known = new Set();
  const learn = (m, tickEnv) => { for (const v of secretValuesFor(m, { env: { ...env, ...(tickEnv || {}) }, settings: config.packs?.[m.id] || {} })) known.add(v); };
  const redactor = createRedactor({ values: () => [...known] });
  const trust = createPackTrust({ db, now, policy: config.policy || null, config });
  const guard = createGuard({ db, now, config, channels, deployRoute, redact: redactor.redact, policyCeiling: id => trust.policyCeiling(id) });
  const bounces = createBounceIntake({ db, guard, now, config: config.bounces || {}, onEvent: (ev, outcome) => onBounceEvent(ev, outcome) });
  const rungs = config.rungs || DEFAULT_RUNGS;
  const ceilings = rungCeilings(config);
  const timeoutMs = config.step_timeout_ms ?? 5000;
  const refusals = [];
  const managerRole = id => `pack-manager-${id}`;
  const programId = id => `pack-${id}`;

  async function row(id) { return first(db, `SELECT * FROM packs_registry WHERE id = ?`, id); }

  // US-21-R20: presence-only access to the secrets a manifest declares. has() never returns a value; get() returns the value of a
  // DECLARED name from the tick env at call time (never stored, and learned by the redactor so it cannot reach a log). An undeclared
  // name returns false or undefined and is written to packs_runs as `secret_not_declared`.
  function packSecrets(m, tickEnv, misses = []) {
    const declared = new Set(m.requires?.secrets || []);
    const e = { ...env, ...(tickEnv || {}) };
    const val = n => (declared.has(n) && typeof e[n] === 'string' && e[n] !== '' ? e[n] : undefined);
    return Object.freeze({
      has: n => { if (!declared.has(n)) { misses.push(String(n)); return false; } return val(n) !== undefined; },
      get: n => { if (!declared.has(n)) { misses.push(String(n)); return undefined; } const v = val(n); if (v !== undefined) known.add(v); return v; },
    });
  }

  // US-21-R21: a delivery event the core intake just applied is handed to every enabled pack that sends on that channel, so the pack's own
  // records (a subscriber row) stop matching what the guard already suppressed. Trust outcomes are recorded here too (a complaint is a
  // hidden failure, a hard bounce a failure). One pack's failure never stops the intake or another pack.
  async function onBounceEvent(ev, outcome) {
    for (const r of await all(db, `SELECT * FROM packs_registry WHERE enabled = 1 ORDER BY id`)) {
      const m = JSON.parse(r.manifest_json);
      if (!m.outbound || !m.outbound.channels.includes(ev.channel) || (ev.pack && ev.pack !== m.id)) continue;
      const started = now();
      try {
        if (ev.kind === 'complaint') await trust.outcome({ pack: m.id, kind: 'send', event: 'complaint', ref: ev.eventId });
        else if (ev.kind === 'hard') await trust.outcome({ pack: m.id, kind: 'send', event: 'failed', ref: ev.eventId });
        if (!m.hooks || !m.hooks.bounce) continue;
        learn(m);
        const en = parseEntry(m.hooks.bounce);
        const mod = await importer(path.resolve(r.source_dir, en.module));
        if (typeof mod[en.export] !== 'function') throw new Error(`hook ${m.hooks.bounce} is not a function`);
        await withTimeout(mod[en.export]({ db: sandboxDb(db, m.id), now, pack: m, settings: config.packs?.[m.id] || {}, guard: boundGuard(m.id), secrets: packSecrets(m, null),
          event: { channel: ev.channel, recipient: ev.recipient, kind: ev.kind, eventId: ev.eventId ?? null }, outcome }), timeoutMs);
        await record(m.id, 'hook:bounce', null, 'ok', null, now() - started);
      } catch (e) {
        const msg = redactor.redact(e && e.message);
        await record(m.id, 'hook:bounce', null, e.timeout ? 'timeout' : 'error', msg, now() - started);
        await ensureItem(db, { id: `PACKFAIL-${m.id}-hook-bounce-${iso(now()).slice(0, 13).replace(' ', 'T')}`, title: `Pack ${m.id} bounce hook failed: ${msg}`, owner_role: managerRole(m.id),
          done_check: `the next bounce event for ${m.id} is applied to its records`, priority: 0, project: programId(m.id) });
      }
    }
  }

  // US-21-R02: validate at load. A pack that fails is not stored at all.
  async function register(manifest, { dir = null } = {}) {
    const errors = validateManifest(manifest, { tenantNames: config.tenant_names || [], readProbeCheck: assertReadOnly });
    if (dir) errors.push(...scanPackSource(dir));
    if (errors.length) return { ok: false, errors };
    const hash = await sha256(stable(manifest));
    const cur = await row(manifest.id);
    if (cur && cur.enabled && cur.manifest_hash !== hash) return { ok: false, errors: ['pack is enabled with a different manifest; disable it first so the person sees the new card'] };
    await run(db, `INSERT INTO packs_registry (id, class, manifest_hash, manifest_json, source_dir, rung_ceiling, registered_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET class=excluded.class, manifest_hash=excluded.manifest_hash, manifest_json=excluded.manifest_json, source_dir=excluded.source_dir, rung_ceiling=excluded.rung_ceiling`,
      manifest.id, manifest.class, hash, JSON.stringify(manifest), dir, ceilings[manifest.class], iso(now()));
    return { ok: true, hash };
  }

  // Find packs by scanning a directory (one subdirectory per pack, each with pack.json). Registers every valid pack; never enables.
  async function loadFromDir(root) {
    const { found, failed } = scanPackDirs(root);
    const registered = [];
    for (const f of found) {
      const r = await register(f.manifest, { dir: f.dir });
      if (r.ok) registered.push(f.manifest.id); else failed.push({ dir: f.dir, id: f.manifest && f.manifest.id, errors: r.errors });
    }
    return { registered, failed };
  }

  // US-21-R01, R04: a recorded decision, then the manager role, charter, guard metrics and a plus item in the kernel records.
  async function enablePack(id, { by, cardText } = {}) {
    const r = await row(id);
    if (!r) return { ok: false, reason: 'unknown_pack' };
    const m = JSON.parse(r.manifest_json);
    if (!by || !String(by).trim()) return { ok: false, reason: 'enabled_by_required' };
    if (!cardText || String(cardText).trim() !== m.enable_gate.trim()) return { ok: false, reason: 'card_text_mismatch' };
    // The pack's own tables exist before its loops can run; a refused or failed migration leaves the pack disabled.
    const mig = await applyPackMigrations(db, m, r.source_dir, now);
    if (!mig.ok) return { ok: false, reason: mig.reason, errors: mig.errors };
    const t = now();
    const decisionId = `pack-enable-${id}-${t}`;
    const kernel = await hasTable(db, 'kernel_programs');
    if (kernel) {
      const pid = programId(id);
      const c = m.charter;
      await registerProgram(db, { id: pid, name: m.name, objective: c.objective, primary_metric_id: c.primary_metric.id, owner_role: managerRole(id), status: 'active' });
      await registerMetric(db, { ...c.primary_metric, kind: 'target', program_id: pid });
      for (const g of c.guard_metrics) await registerMetric(db, { ...g, kind: 'guard', program_id: pid });
      if (m.outbound) {
        await registerMetric(db, { id: `${id}_sends_24h`, program_id: pid, kind: 'guard', op: '<=',
          target: Math.max(...m.outbound.channels.map(ch => m.outbound.caps[ch].per_day)),
          read_probe: `SELECT COUNT(*) AS value FROM guard_ledger WHERE pack = '${id}' AND decision = 'sent' AND at >= datetime('now', '-1 day')`,
          description: 'sends in the last day never exceed the largest per-day cap' });
      }
      await recordDecision(db, { id: decisionId, program_id: pid, decision: `Enable pack ${id} (${m.name}) after the person saw its enable card`,
        authority: `person:${by}`, prediction: `${c.primary_metric.id} ${c.primary_metric.op} ${c.primary_metric.target} within 168 h`,
        revert_path: `disablePack('${id}')`, now: t });
      await ensureItem(db, { id: `PACKPLUS-${id}-1`, title: `Improve pack ${id}: find the largest gap against ${c.primary_metric.id} and file the change`, kind: 'plus',
        project: pid, owner_role: managerRole(id), done_check: `an improvement for ${id} merged and its primary metric re-read`, priority: 30 });
    }
    if (kernel) await openTrial(db, m, managerRole);   // US-21-R25: the live-trial gate card, default in effect: every send waits for a person
    // The manager role: its items are dispatched by the seed tick like any other role's.
    await run(db, `INSERT OR REPLACE INTO roles (id, role, project, tick_every, model) VALUES (?,?,?,?,?)`,
      managerRole(id), managerRole(id), null, 1, config.manager_model || 'default');
    await run(db, `UPDATE packs_registry SET enabled = 1, enabled_by = ?, enabled_at = ?, card_text_shown = ?, decision_id = ?, disabled_at = NULL WHERE id = ?`,
      String(by), iso(t), String(cardText), decisionId, id);
    return { ok: true, decisionId, kernelRecords: kernel, migrations: mig.applied };
  }

  // One action, fully reversible; the pack's loops stop on the next tick and the guard refuses its sends at once.
  async function disablePack(id) {
    const r = await row(id);
    if (!r) return { ok: false, reason: 'unknown_pack' };
    await run(db, `UPDATE packs_registry SET enabled = 0, disabled_at = ? WHERE id = ?`, iso(now()), id);
    await run(db, `DELETE FROM roles WHERE id = ?`, managerRole(id));
    if (await hasTable(db, 'kernel_programs')) await run(db, `UPDATE kernel_programs SET status = 'paused' WHERE id = ?`, programId(id));
    return { ok: true };
  }

  const isEnabled = async id => !!(await first(db, `SELECT 1 AS x FROM packs_registry WHERE id = ? AND enabled = 1`, id));
  const record = (id, loop, tickId, outcome, error, ms) => run(db, `INSERT INTO packs_runs (pack_id, loop_id, tick_id, outcome, error, ms, at) VALUES (?,?,?,?,?,?,?)`,
    id, loop, tickId ?? null, outcome, error ? String(error).slice(0, 300) : null, ms, iso(now()));

  // US-21-R05, R07: guarded tick steps for ENABLED packs only. Pass as runTick's extraSteps.
  async function packSteps() {
    const steps = [];
    for (const r of await all(db, `SELECT * FROM packs_registry WHERE enabled = 1 ORDER BY id`)) {
      const m = JSON.parse(r.manifest_json);
      for (const loop of m.loops) {
        steps.push({
          name: `pack:${m.id}:${loop.id}`,
          async run(_db, ctx) {
            if (ctx.tickId % loop.every_ticks !== 0) return;
            if (!(await isEnabled(m.id))) return;                       // disabled since the step list was built
            const sw = await engagedSwitches(db);
            if (sw.has('global') || sw.has(`pack:${m.id}`)) { await record(m.id, loop.id, ctx.tickId, 'skipped_killed', null, 0); return; }
            const started = now();
            learn(m, ctx.env);
            const misses = [];
            try {
              const en = parseEntry(loop.entry);
              const mod = await importer(path.resolve(r.source_dir, en.module));
              const fn = mod[en.export];
              if (typeof fn !== 'function') throw new Error(`entry ${loop.entry} is not a function`);
              await withTimeout(fn({ db: sandboxDb(db, m.id), ctx: sandboxCtx(ctx, t => redactingSink(t, redactor.redact)), now, pack: m, settings: config.packs?.[m.id] || {}, guard: boundGuard(m.id), secrets: packSecrets(m, ctx.env, misses) }), timeoutMs);
              await record(m.id, loop.id, ctx.tickId, 'ok', null, now() - started);
              for (const n of new Set(misses)) await record(m.id, loop.id, ctx.tickId, 'secret_not_declared', redactor.redact(n), 0);
            } catch (e) {
              for (const n of new Set(misses)) await record(m.id, loop.id, ctx.tickId, 'secret_not_declared', redactor.redact(n), 0);
              const msg = redactor.redact(e && e.message);
              await record(m.id, loop.id, ctx.tickId, e.timeout ? 'timeout' : 'error', msg, now() - started);
              ctx.errors.push(`pack:${m.id}:${loop.id}: ${msg}`);
              await ensureItem(db, { id: `PACKFAIL-${m.id}-${loop.id}-${iso(now()).slice(0, 13).replace(' ', 'T')}`,
                title: `Pack ${m.id} loop ${loop.id} failed: ${msg}`, owner_role: managerRole(m.id),
                done_check: `the next run of ${m.id}:${loop.id} completes`, priority: 0, project: programId(m.id) });
            }
          },
        });
      }
    }
    return steps;
  }

  // A pack only ever gets a guard bound to its own id: it cannot send as another pack (US-21-R08).
  function boundGuard(packId) {
    return freezeGuard({
      send: req => guard.send({ ...req, pack: packId }),
      consent: {
        request: a => guard.consent.request({ ...a, pack: packId }), grant: a => guard.consent.grant({ ...a, pack: packId }),
        confirm: t => guard.consent.confirm(t), revoke: a => guard.consent.revoke(a),
      },
      unsubscribe: a => guard.unsubscribe(a), suppress: a => guard.suppress(a),
      stats: () => guard.stats(packId),
      // US-21-R29: a verified, failed or removed result of this pack's own action, recorded as trust on pack:<id> (never as another pack).
      outcome: a => trust.outcome({ ...a, pack: packId }),
    });
  }

  // Read side of the person-facing surface (routes.js): the card, scope and last probes of each pack, the switches, the pending queue.
  async function list() {
    const out = [];
    for (const r of await all(db, `SELECT * FROM packs_registry ORDER BY id`)) {
      const m = JSON.parse(r.manifest_json);
      out.push({ id: r.id, name: m.name, version: m.version, class: r.class, enabled: !!r.enabled, enabled_by: r.enabled_by, enabled_at: r.enabled_at, rung_ceiling: r.rung_ceiling,
        scope: m.scope, enable_gate: m.enable_gate, channels: m.outbound ? m.outbound.channels : [], probes: await lastProbes(db, r.id) });
    }
    return out;
  }

  const api = {
    guard, bounces, trust, register, loadFromDir, enablePack, disablePack, packSteps, boundGuard, list,
    setSwitch: (scope, on, reason) => setSwitch(db, scope, on, reason, now()),
    switches: () => all(db, `SELECT scope, is_on, reason, set_at FROM packs_switches ORDER BY scope`),
    queue: () => all(db, `SELECT q.id, q.at, q.pack, q.channel, q.kind, q.card_id, g.what AS card FROM guard_queue q LEFT JOIN gate_cards g ON g.id = q.card_id WHERE q.status = 'pending' OR (q.status = 'deciding' AND q.decided_at <= ?) ORDER BY q.id`, guard.staleClaimBefore()),
    status: async () => all(db, `SELECT id, class, enabled, enabled_by, enabled_at, decision_id, rung_ceiling FROM packs_registry ORDER BY id`),
    // US-21-R28: the one fetch a channel adapter for this pack may be built with: the host's real fetch, limited to the pack's declared outbound.hosts over
    // https. A pack that declares no hosts has no network (egress_hosts_not_declared), so a deployment declares them in the manifest it registers. A refused
    // call is recorded as a packs_runs row (loop `egress`, outcome `egress_refused`) and kept in egressRefusals(); a failure to record it is kept there too.
    // `fetch` defaults to the one the host gave createPacks (core/org passes its own), so a hosted pack's channel fetch is limited without the host wiring it.
    egressFetch: async (id, { fetch = hostFetch } = {}) => {
      const r = await row(id);
      if (!r) throw new Error(`unknown_pack:${id}`);
      const hosts = (JSON.parse(r.manifest_json).outbound || {}).hosts;
      if (!Array.isArray(hosts) || !hosts.length) throw new Error(`egress_hosts_not_declared:${id}`);
      return createEgressFetch({ fetch, hosts, onRefuse: (host, url) => {
        refusals.push({ pack: id, host, at: iso(now()) });
        record(id, 'egress', null, 'egress_refused', `${host}`, 0).catch(e => refusals.push({ pack: id, error: `could not record the refusal: ${e && e.message}` }));
      } });
    },
    egressRefusals: () => refusals.slice(),
    // US-21-R25: read-only probe of every declared channel of every enabled outbound pack. ports defaults to the channels given to createPacks.
    probeChannels: (ports = channels) => runChannelProbes({ db, now, ports, redact: redactor.redact, managerRole }),
    // US-21-R30: mount with any host; authorize(request) returns the actor's name or null.
    routes: ({ authorize, bounceSecret = null } = {}) => createPackRoutes({ packs: api, db, authorize, bounceSecret, now }),
    // US-21-R23: a transport for core/outreach and core/promote that sends through the guard as the named pack.
    transport: ({ pack, channel, kind, keyOf } = {}) => guardTransport({ guard: boundGuard(pack), channel, kind, keyOf }),
  };
  return api;
}
