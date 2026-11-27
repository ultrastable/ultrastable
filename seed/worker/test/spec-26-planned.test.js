// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-26 R75, R78 and R79: each test was the closing probe of a PLANNED row in section 14 of the specification, written as a `todo` test. The code
// now meets all three (seed/worker/src/ignition.js, goals.js and criticality.js), so they are ordinary tests. Frozen clocks, in-memory databases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { ensureItem } from '../src/tick.js';
import { ignitionStep } from '../src/ignition.js';
import { criticalityStep } from '../src/criticality.js';
import { goalsStep, registerTenant, reportReadings } from '../src/goals.js';

const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const NOW = Date.parse('2026-11-10T01:05:30Z'), W = 600e3, CUR = Math.floor(NOW / W), H = 3600e3;
const crit = JSON.parse(readFileSync(new URL('../../autonomy/criticality.json', import.meta.url), 'utf8'));
const PULSE = { every_min: 10, not_ticking: [], warming: 0, coverage_24h: 0.99, missed_24h: 0, ticking: 5, loops: 5, watchdog: true };

test('US-26-R75: a stage closed through the ladder alone leaves `closing` unmet', async () => {
  // One role, eight complete ticks, a healthy pulse, no metrics: the stages seeded, ticking and looping hold; `closing` has no work behind it.
  const db = makeDb();
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m')");
  for (let k = 8; k >= 1; k--) { const at = iso((CUR - k) * W + 30e3); db.raw.prepare('INSERT INTO tick_runs (started_at, finished_at, steps_completed, steps_total) VALUES (?,?,19,19)').run(at, at); }
  const ctx = (now, tickId) => ({ db, now, nowIso: iso(now), tickId, config: {}, notes: [], errors: [], pulse: PULSE, criticality: null });
  const a = await ignitionStep(db, ctx(NOW, 9999), ensureItem);
  assert.equal(a.stage, 'looping');
  assert.equal(a.blocking.stage, 'closing');
  // The step closes IGNITE-ticking and IGNITE-looping when they hold; give it an open IGNITE item that closes now, and read again.
  db.raw.prepare("INSERT INTO items (id, title, kind, owner_role, done_check, status, priority) VALUES ('IGNITE-looping','t','fix','operations','d','ready',-1)").run();
  const b = await ignitionStep(db, ctx(NOW + 60e3, 10000), ensureItem);
  const own = db.raw.prepare("SELECT COUNT(*) n FROM outcomes WHERE surface='ignition' AND result='verified'").get().n;
  assert.ok(own >= 1, 'the step wrote its own verified outcome on a done item');
  assert.equal(b.stage, 'looping', 'the reading that closes the item is judged before its outcome is written');
  // The next reading sees that outcome. It is the ladder's own bookkeeping, so it must not satisfy `closing`.
  const c = await ignitionStep(db, ctx(NOW + 120e3, 10001), ensureItem);
  assert.equal(c.stage, 'looping', 'the ladder\'s own bookkeeping did not satisfy closing');
  assert.equal(c.blocking.stage, 'closing');
});

test('US-26-R79: the criticality snapshot carries the branching ratio (successors emitted per item closed in the window)', async () => {
  let db = makeDb();
  const ctx = (now, tickId) => ({ now, nowIso: iso(now), tickId, dispatched: 1, errors: [], notes: [], config: { org_slug: 'mine' } });
  let snap = await criticalityStep(db, ctx(NOW, 1), crit, ensureItem);
  assert.ok('branching_ratio' in snap, 'the snapshot has a branching_ratio field');
  assert.equal(snap.branching_ratio, null, 'no closed item in the window: unmeasured, never 0');
  // Four items closed in the window (one of another tenant, one old, one an IDLE repair, one a successor: none of those count), two successors filed in it.
  db = makeDb();
  const add = (id, status, at, tenant = null) => db.raw.prepare("INSERT INTO items (id, title, kind, owner_role, done_check, status, priority, created_at, updated_at, tenant_id) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, 't', 'work', 'operations', 'd', status, 50, at, at, tenant);
  for (const id of ['A', 'B', 'C', 'D']) add(id, 'done', iso(NOW - 2 * H));
  add('E', 'done', iso(NOW - 2 * H), 'other'); add('OLD', 'done', iso(NOW - 40 * 86400e3)); add('IDLE-x', 'done', iso(NOW - H)); add('NEXT-Z', 'done', iso(NOW - H));
  add('NEXT-A', 'open', iso(NOW - H)); add('NEXT-B', 'ready', iso(NOW - H)); add('NEXT-OLD', 'open', iso(NOW - 40 * 86400e3)); add('NEXT-E', 'open', iso(NOW - H), 'other');
  snap = await criticalityStep(db, { ...ctx(NOW, 2), dispatched: 1 }, { ...crit, k_max: -1 }, ensureItem);  // k_max below k_eff: no successor is emitted this tick
  assert.deepEqual(snap.branching, { successors: 3, closed: 4 }, 'NEXT-Z, NEXT-A and NEXT-B are successors of the window; A to D are its closed items');
  assert.equal(snap.branching_ratio, 0.75);
  const stored = JSON.parse(db.raw.prepare("SELECT value FROM org WHERE key='criticality'").get().value);
  assert.equal(stored.branching_ratio, 0.75, 'published with k_eff in the stored snapshot');
  add('F', 'done', iso(NOW - H));
  assert.equal((await criticalityStep(db, ctx(NOW + 60e3, 3), { ...crit, k_max: -1 }, ensureItem)).branching_ratio, 0.75, 'inside the half hour the kept reading is used');
  assert.equal((await criticalityStep(db, ctx(NOW + 1800e3, 4), { ...crit, k_max: -1 }, ensureItem)).branching_ratio, 0.6, 'a new half hour reads again: 3 successors over 5 closed');
});

test('US-26-R78: a page-severity burn alert on a core goal files a work item', async () => {
  const db = makeDb();
  const cfg = { goals: [{ id: 'core.t', level: 'target', statement: 't', source: 'builtin', spec: 'x', op: '>=', target: 0.5 }],
    knobs: [{ id: 'core.k', goal_id: 'core.t', what: 'k', value: 4, min: 1, max: 6, step: 1, effect: -1, cooldown_h: 24, review_h: 24 }] };
  let reading = 0.1;
  const builtins = { x: async () => reading };
  const step = (now) => goalsStep(db, { now, nowIso: new Date(now).toISOString(), config: {} }, cfg, { builtins, ensureItem });
  const item = () => db.raw.prepare("SELECT status, priority, closing_probe FROM items WHERE id='GOAL-BURN-core.t'").get();
  const T0 = NOW - 6 * H, at = min => T0 + min * 60e3;
  reading = 0.9; for (let m = 0; m <= 180; m += 10) await step(at(m));  // three hours met, one reading every ten minutes
  reading = 0.1; await step(at(190));
  assert.equal(item(), undefined, 'one missed reading after three met hours is not a page: the long window does not burn');
  const db0 = makeDb();  // five misses and nothing before them: every window reads 100 percent missed, but five readings are not yet a run (six are needed)
  for (let m = 0; m < 50; m += 10) await goalsStep(db0, { now: at(m), nowIso: new Date(at(m)).toISOString(), config: {} }, cfg, { builtins, ensureItem });
  assert.equal(db0.raw.prepare("SELECT COUNT(*) n FROM items WHERE id LIKE 'GOAL-BURN-%'").get().n, 0, 'a goal\'s first misses are left to its own GOAL- item');
  // Two and a half hours of misses: the page rule of 6x the allowed miss rate over 6 hours with a 30 minute confirm window (scaled to the 14-day period:
  // 2.8 hours and 14 minutes) fires. With an objective of 0.9 the burn rate cannot pass 10, so the 14.4x rule never fires.
  for (let m = 200; m <= 350; m += 10) await step(at(m));
  const filed = db.raw.prepare("SELECT COUNT(*) n FROM items WHERE id LIKE 'GOAL-BURN-%'").get().n;
  assert.ok(filed >= 1, 'a work item exists for the burning goal');
  assert.equal(item().priority, 2); assert.equal(item().closing_probe, "SELECT COUNT(*) FROM goals WHERE id='core.t' AND met=1");
  reading = 0.9; await step(at(360));
  assert.equal(item().status, 'done', 'the item closes when the goal is met again');
  // A tenant's goal burning the same way files nothing here: the consumer is for core goals, and a tenant's goals and items stay in the tenant.
  const db2 = makeDb();
  const reg = await registerTenant(db2, 'acme', { goals: [{ id: 'acme.t', level: 'target', statement: 't', source: 'tenant', op: '>=', target: 0.5 }] }, { now: T0 });
  assert.ok(reg.ok, JSON.stringify(reg.errors));
  for (let m = 0; m <= 350; m += 10) { await reportReadings(db2, 'acme', { 'acme.t': 0.1 }, { now: at(m) }); await goalsStep(db2, { now: at(m), nowIso: new Date(at(m)).toISOString(), config: {} }, null, { builtins, ensureItem }); }
  assert.ok(db2.raw.prepare("SELECT COUNT(*) n FROM goal_samples WHERE goal_id='acme.t'").get().n > 0, 'the tenant goal was read');
  assert.equal(db2.raw.prepare("SELECT COUNT(*) n FROM items WHERE id LIKE 'GOAL-BURN-%'").get().n, 0);
});
