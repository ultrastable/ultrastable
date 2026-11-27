// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-26 (requirements the code does not yet meet): R75, R78 and R79. Each test states the closing probe of its PLANNED row in section 14 of
// specs/US-SPEC-26-ignition-criticality-ultrastability.md. They are `todo` tests: node:test reports their result without failing the run, so the
// suite stays green today and the first change that makes one pass turns it into a plain pass (remove `todo` then). Frozen clocks, in-memory databases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { ensureItem } from '../src/tick.js';
import { ignitionStep } from '../src/ignition.js';
import { criticalityStep } from '../src/criticality.js';
import { goalsStep } from '../src/goals.js';

const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const NOW = Date.parse('2026-11-10T01:05:30Z'), W = 600e3, CUR = Math.floor(NOW / W), H = 3600e3;
const crit = JSON.parse(readFileSync(new URL('../../autonomy/criticality.json', import.meta.url), 'utf8'));
const PULSE = { every_min: 10, not_ticking: [], warming: 0, coverage_24h: 0.99, missed_24h: 0, ticking: 5, loops: 5, watchdog: true };

test('US-26-R75: a stage closed through the ladder alone leaves `closing` unmet', { todo: 'PLANNED: gather() in seed/worker/src/ignition.js counts the verified outcome the step itself writes' }, async () => {
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

test('US-26-R79: the criticality snapshot carries the branching ratio (successors emitted per item closed in the window)', { todo: 'PLANNED: nothing in seed/worker/src/ computes it' }, async () => {
  const db = makeDb();
  const snap = await criticalityStep(db, { now: NOW, nowIso: iso(NOW), tickId: 1, dispatched: 0, errors: [], notes: [], config: { org_slug: 'mine' } }, crit, ensureItem);
  assert.ok('branching_ratio' in snap, 'the snapshot has a branching_ratio field');
});

test('US-26-R78: a page-severity burn alert on a core goal files a work item', { todo: 'PLANNED: errorBudget is computed in readGoals and only published' }, async () => {
  const db = makeDb();
  const cfg = { goals: [{ id: 'core.t', level: 'target', statement: 't', source: 'builtin', spec: 'x', op: '>=', target: 0.5 }],
    knobs: [{ id: 'core.k', goal_id: 'core.t', what: 'k', value: 4, min: 1, max: 6, step: 1, effect: -1, cooldown_h: 24, review_h: 24 }] };
  const builtins = { x: async () => 0.1 };
  const step = (now) => goalsStep(db, { now, nowIso: new Date(now).toISOString(), config: {} }, cfg, { builtins, ensureItem });
  // Every reading of the last half hour misses: the fast page rule (14.4 over 1 hour and 5 minutes, scaled to the 14-day period) fires.
  for (let m = 30; m >= 0; m -= 5) await step(NOW - m * 60e3);
  const filed = db.raw.prepare("SELECT COUNT(*) n FROM items WHERE id LIKE 'GOAL-BURN-%'").get().n;
  assert.ok(filed >= 1, 'a work item exists for the burning goal');
});
