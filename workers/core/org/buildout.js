// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The spec build-out modules' tick steps, called from the composition root (issue #201). Every step is on by default and
// is turned off only by `config.<key>.enabled === false`. A step that needs a port the host did not give (a policy, a
// metadata reader, a model) records why it did nothing in the tick notes; it never fails silently and never blocks the others.
// runTick guards each step, so a throw here is recorded in tick_runs and filed as a backlog item.
import { staffStep } from '../staff/index.js';
import { plusStep } from '../plus/index.js';
import { lifecycleStep } from '../lifecycle-gates/index.js';
import * as fleet from '../fleet/index.js';
import * as signals from '../signals/index.js';
import * as remediation from '../remediation/index.js';
import * as claimsGate from '../claims/gate.js';
import * as wiring from '../graph/wiring.js';
import * as predict from '../predict/index.js';
import * as trust from '../trust/index.js';
import * as governance from '../governance/index.js';
import * as ladder from '../ladder/index.js';
import { createSla } from '../sla/index.js';
import { ghcostSteps } from '../ghcost/index.js';
import { tenancySteps } from '../tenancy/index.js';
import { accessSteps } from '../access/index.js';
import { elicitDutiesStep } from '../elicit/duties-step.js';
import { elicitAuditStep } from '../elicit/audit-step.js';

/** The step names this module adds, in order. core/org tests assert each appears in org.extraSteps(). */
export const BUILDOUT_STEPS = ['staff', 'plus', 'lifecycle_gates', 'fleet', 'signals', 'remediation', 'claims_gate', 'graph_wiring',
  'predict', 'trust', 'governance', 'ladder', 'sla', 'ghcost_watchdog', 'tenancy', 'access', 'elicit_duties', 'elicit_audit'];

const off = (config, key) => config?.[key]?.enabled === false;
const nowMs = (ctx, clock) => (typeof ctx.now === 'number' ? ctx.now : clock());

/**
 * buildoutSteps({ db, config, now, fetch, ports }) -> step[]
 * ports (all optional; an absent port leaves its step doing what it did without it, and the step says so in the tick notes). core/org supplies
 * defaults for the ones a deployment can build from itself (research, reader, propose, readiness, ai, elicit, l3); a host injects the others.
 *   staff        research, readFile                   plus         reader, propose, adopt (a source of products), sources (evidence)
 *   lifecycle    readiness(project), readback(project), packs (the pack host)
 *   fleet        ai, deployed, bindings, executor     signals      scorers, synthesize, auditor
 *   remediation  probeDb, rosters, ledgers, candidates, alarms      claims_gate  stores      graph_wiring  metadata
 *   predict      metrics, read                        trust        mergedLadder (a merged ladder pull request -> the rung it applied)
 *   governance   generate, redteam, evaluate, scanSources, signals (the goal cycle's), recognizePorts
 *   ladder       ladder: { canary, answer, label, decisions }                    sla          l3, measured, attestor
 *   ghcost       github, publish                      tenancy      access, push                 access       env
 *   elicit       elicit (the instance the walkthrough asks through), derive(project), catalog, mode, gates
 */
export function buildoutSteps({ db, config = {}, now = () => Date.now(), fetch, claims, ports = {} } = {}) {
  const clock = typeof now === 'function' ? now : () => now;
  // A module step that takes a ctx of its own: db, a clock function, its config section and the host's ports.
  const guarded = (name, key, run) => ({ name, run: async (_db, tick) => {
    if (off(tick.config || config, key)) { tick.notes?.push(`${name}: off`); return; }
    const out = await run({ tick, cfg: (tick.config || config)[key] || {}, t: nowMs(tick, clock) });
    if (out && out.skipped) tick.notes?.push(`${name}: skipped, ${out.skipped}`);
    else if (out !== undefined) tick.notes?.push(`${name}: ${JSON.stringify(out).slice(0, 200)}`);
  } });
  const ctxOf = ({ cfg, t }, extra = {}) => ({ db, now: () => t, config: cfg, fetch, claims, ...extra });
  const sla = ports.sla || createSla({ db, now: clock, config: config.sla || {} });
  return [
    staffStep({ readFile: ports.readFile, research: ports.research }),
    plusStep({ reader: ports.reader, propose: ports.propose, adopt: ports.adopt, sources: ports.sources }),
    lifecycleStep({ readiness: ports.readiness, readback: ports.readback, packs: ports.packs }),
    guarded('fleet', 'fleet', c => fleet.step(ctxOf(c, { ai: ports.ai, deployed: ports.deployed, bindings: ports.bindings, executor: ports.executor }))),
    guarded('signals', 'signals', c => signals.step(ctxOf(c, { scorers: ports.scorers || [], synthesize: ports.synthesize, auditor: ports.auditor }))),
    guarded('remediation', 'remediation', c => remediation.step(ctxOf(c, { probeDb: ports.probeDb, rosters: ports.rosters, ledgers: ports.ledgers, candidates: ports.candidates, alarms: ports.alarms }))),
    guarded('claims_gate', 'claims_gate', c => claimsGate.step(ctxOf(c, { stores: ports.stores }))),
    guarded('graph_wiring', 'graph', c => (ports.metadata ? wiring.step(ctxOf(c, { metadata: ports.metadata })) : { skipped: 'no metadata port' })),
    guarded('predict', 'predict', c => predict.step({ db, now: c.t, metrics: ports.metrics || {}, read: ports.read, config: c.cfg })),
    guarded('trust', 'trust', c => {
      if (!config.policy) return { skipped: 'no config.policy' };
      // A policy that fails the module's own validator is reported with its reasons in the tick notes; the module is not run on it.
      try { trust.assertPolicy(config.policy); } catch (e) { return { skipped: `config.policy is invalid: ${String(e.message).slice(0, 160)}` }; }
      return trust.step({ db, policy: config.policy, config: c.cfg, now: c.t, merged: ports.mergedLadder });
    }),
    guarded('governance', 'governance', c => governance.step({ db, now: c.t, config: c.cfg, generate: ports.generate, redteam: ports.redteam, evaluate: ports.evaluate,
      sources: ports.scanSources, signals: ports.signals, recognizePorts: ports.recognizePorts })),
    guarded('ladder', 'ladder', c => ladder.step({ db, now: c.t, config: c.cfg, ports: ports.ladder || {} })),
    guarded('sla', 'sla', async c => { const o = await sla.step({ notes: c.tick.notes }, { l3: ports.l3 || null, measured: ports.measured || {}, attestor: ports.attestor || null }); return { rows: o.sla?.rows }; }),
    // Opt-in by their own switches because they need an account (an org and a budget) or a role to do anything.
    ...ghcostSteps({ fetch, github: ports.github, publish: ports.publish }),
    ...tenancySteps({ access: ports.access, push: ports.push }),
    // The access preflight (core/access): probes config.access.needs each tick; its database trigger already refuses unpermitted owner asks.
    ...accessSteps({ db, now: clock, fetch, env: ports.env, config }),
    // US-16-R10, R19, R29, R30: an overdue Ask falls to its default and every card is checked against the card rules on the tick, so none of it waits for the walkthrough to be opened.
    guarded('elicit_duties', 'elicit_duties', c => (ports.elicit
      ? elicitDutiesStep({ db, elicit: ports.elicit, fetch, now: clock, derive: ports.derive }).run(db, c.tick)
      : { skipped: 'no elicit instance' })),
    // US-16-R24: the ignorance audit and its triggers (readiness at G1, a gate entered, a new failed prediction); the red team is another model family when one is reachable.
    guarded('elicit_audit', 'elicit_audit', c => (ports.elicit
      ? elicitAuditStep({ db, now: clock, config, env: ports.env, fetch, elicit: ports.elicit, catalog: ports.catalog, mode: ports.mode, gates: ports.gates }).run(db, c.tick)
      : { skipped: 'no elicit instance' })),
  ];
}
