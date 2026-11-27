// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-02 (virtual staff): US-02-R13, R14, US-02-T05, T06 (and US-15-R17, T15-9), the role register in data and its hire step, proved
// against the seed runtime that implements it (worker/src/managers.js, autonomy/managers.json). Clocks are frozen, the database is in memory, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick, stepPlan, COST_ESSENTIAL_STEPS } from '../src/tick.js';
import { roster, isOff, hireStep } from '../src/managers.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const register = JSON.parse(readFileSync(new URL('../../autonomy/managers.json', import.meta.url), 'utf8'));
const base = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const T0 = Date.parse('2026-11-10T00:00:00Z');
const roles = (db) => db.raw.prepare('SELECT role FROM roles ORDER BY role').all().map((r) => r.role);
const fast = { ...register, managers: register.managers.map((m) => ({ ...m, tick_every: 1 })) };

test('US-02-R13, US-02-R14, US-02-T05, US-15-R17, T15-9: every manager of the register is on by default, and one tick hires each that has no row, idempotently', async () => {
  assert.deepEqual(register.switch, {}, 'the shipped register has no switch: every manager is on');
  assert.ok(roster(register).every((m) => m.on), 'every manager is on by default');
  const db = makeDb();
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'doer-tier')");
  const r = await runTick(db, { config: { ...base, managers: register }, now: T0 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(roles(db), register.managers.map((m) => m.id).sort());
  const n = db.raw.prepare('SELECT COUNT(*) AS n FROM roles').get().n;
  await runTick(db, { config: { ...base, managers: register }, now: T0 + 600e3 });
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM roles').get().n, n, 'hiring is idempotent');
});

test('US-02-R13, US-02-R14, US-02-T06: a manager switched off by data with a reason is not hired and not dispatched, and nothing is deleted', async () => {
  const off = { ...fast, switch: { 'marketing-manager': { state: 'off', reason: 'no public front end' } } };
  assert.equal(isOff(off, 'marketing-manager'), true);
  const db = makeDb();
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m'), ('marketing-manager-1','marketing-manager',1,'m')");
  db.raw.exec("INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('M','m','marketing-manager','x',10,'open')");
  await runTick(db, { config: { ...base, managers: off }, now: T0 });
  assert.ok(roles(db).includes('marketing-manager'), 'an existing row is kept');
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM dispatches WHERE item_id='M'").get().n, 0, 'dispatch skips a manager that is off');
});

test('US-02-R13, US-02-T06, T15-9: a core manager cannot be switched off, and a switch with no reason is refused', async () => {
  const reg = { ...register, switch: { operations: { state: 'off', reason: 'saving cost' }, 'design-manager': { state: 'off', reason: ' ' } } };
  const r = roster(reg);
  assert.equal(r.find((m) => m.id === 'operations').on, true);
  assert.equal(r.find((m) => m.id === 'design-manager').on, true);
  const db = makeDb(), ctx = { config: { managers: reg }, notes: [] };
  const out = await hireStep(db, ctx);
  assert.equal(out.refused.length, 2);
  assert.ok(roles(db).includes('operations') && roles(db).includes('design-manager'));
});

test('US-02-R13: the register has at least one core manager and every manager names a cadence', () => {
  assert.ok(roster(register).some((m) => m.core), 'a core manager exists');
  assert.ok(register.managers.every((m) => Number.isInteger(m.tick_every) && m.tick_every >= 1));
});

test('US-02-R14: a tick held lean by a cost breach still hires every manager that is on, because reconcile runs on every plan', async () => {
  const quiet = Date.parse('2026-11-10T01:30:00Z');
  assert.ok(COST_ESSENTIAL_STEPS.includes('reconcile'));
  for (const plan of [{ lean: true }, { degrade: true }, { spend: { level: 'throttle', knobs: {} } }, { spend: { level: 'crawl', knobs: {} } }]) {
    assert.equal(stepPlan('reconcile', { ...plan, now: quiet }), 'run', JSON.stringify(plan));
  }
  const db = makeDb();
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'doer-tier')");
  db.raw.prepare('INSERT INTO cost_samples (at, target, rows_read_1h) VALUES (?, ?, ?)').run('2026-11-10 01:25:00', 'org-db', 1e9);
  const r = await runTick(db, { config: { ...base, managers: register, cost_budgets: [{ id: 'org-db', max_rows_read_per_hour: 1000 }] }, now: quiet });
  assert.match(r.report, /cost breach/, 'the tick ran lean');
  assert.deepEqual(roles(db), register.managers.map((m) => m.id).sort(), 'every manager that is on was hired on the lean tick');
});
