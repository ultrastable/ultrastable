// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Self-amending governance (US-SPEC-07 section 3): signature register, recognition engine, pre-emission filter,
// self-amendment loop, objective space. Ports only: db, now, and the model ports each function names.
import { seedRegister } from './register.js';
import { scanState, rates } from './engine.js';
import { amendStep } from './amend.js';
import { drainGoalLedger, retireGoals } from './objectives.js';
import { checkRates } from './triggers.js';
import { scanSources, goalCycle } from './scan.js';

export const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);
export * from './register.js';
export * from './engine.js';
export * from './amend.js';
export * from './objectives.js';
export * from './triggers.js';
export * from './scan.js';

/**
 * One guarded pass for a tick: install the register if absent, record state signatures, run the amendment loop up to (not
 * including) adoption, drain adopted goals into work items and retire finished or lapsed ones. Model ports are optional:
 * without `generate` or `redteam` proposals wait at their stage and the weekly audit item lists them.
 */
export async function step({ db, now = Date.now(), generate, redteam, evaluate, config = {}, sources, signals, synthesize, recognizePorts } = {}) {
  await seedRegister(db, { now });
  const scanned = sources && sources.length ? await scanSources(db, { sources, now, limit: config.scan_limit, ports: recognizePorts }) : null; // US-07-R31
  const cycle = (signals && signals.length) || synthesize ? await goalCycle(db, { now, signals, synthesize }) : null; // US-07-R24
  const drops = await scanState(db, { now });
  const amend = await amendStep(db, { now, generate, redteam, evaluate });
  const goals = await drainGoalLedger(db, { now });
  const retired = await retireGoals(db, { now });
  const triggers = await checkRates(db, { now, config: config.triggers }); // US-07-R30: a breach of a rate files one item per number and day
  return { silent_drops: drops.length, proposals_raised: amend.raised, audit: amend.audit, goals_queued: goals.length, goals_retired: retired.length, rates: await rates(db, { now }),
    rate_items: triggers.filed, rates_measured: triggers.measured, self_adoption: triggers.self_adoption,
    ...(scanned ? { scan: scanned } : {}), ...(cycle ? { goal_cycle: { signals: cycle.signals, adopted: cycle.adopted.length, rejected: cycle.rejected.length, errors: cycle.errors } } : {}) };
}
export { createModelPorts } from './model-ports.js';
