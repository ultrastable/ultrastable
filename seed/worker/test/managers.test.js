// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// MANAGERS-1: the register hires every switched-on manager; an off manager is kept and not dispatched; a core manager cannot be switched off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick } from '../src/tick.js';
import { roster, isOff, hireStep } from '../src/managers.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const register = JSON.parse(readFileSync(new URL('../../autonomy/managers.json', import.meta.url), 'utf8'));
const seedCfg = JSON.parse(readFileSync(new URL('../../ultrastable.json', import.meta.url), 'utf8'));
const base = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const T0 = Date.parse('2026-11-10T00:00:00Z');
const roles = db => db.raw.prepare('SELECT role FROM roles ORDER BY role').all().map(r => r.role);

test('the register and the seed roster name the same managers with the same cadence', () => {
  assert.deepEqual(register.managers.map(m => [m.id, m.tick_every, m.count]), seedCfg.roles.map(r => [r.id, r.tick_every, r.count]));
  assert.deepEqual(register.switch, {}, 'the seed ships with every manager on: a deployment switches one off in its own copy');
});

test('a system that booted with part of the team is brought to the full register by one tick, and stays there', async () => {
  const db = makeDb();
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'doer-tier'), ('portfolio-manager-1','portfolio-manager',6,'mgr-tier')");
  const r = await runTick(db, { config: { ...base, managers: register }, now: T0 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(roles(db), register.managers.map(m => m.id).sort());
  assert.equal(db.raw.prepare("SELECT model FROM roles WHERE role='program-manager'").get().model, 'mgr-tier');
  assert.equal(db.raw.prepare("SELECT model FROM roles WHERE role='reviewer'").get().model, 'doer-tier');
  assert.match(r.report, /hired 16 manager\(s\) from the register/);
  const n = db.raw.prepare('SELECT COUNT(*) AS n FROM roles').get().n;
  await runTick(db, { config: { ...base, managers: register }, now: T0 + 600e3 });
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM roles').get().n, n, 'hiring is idempotent');
});

test('a hired manager is dispatched its own ready item on the tick it is hired', async () => {
  const db = makeDb();
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m')");
  db.raw.exec("INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('P','sequence the projects','program-manager','x',10,'open')");
  const one = { ...register, managers: register.managers.map(m => ({ ...m, tick_every: 1 })) };
  await runTick(db, { config: { ...base, managers: one }, now: T0 });
  assert.equal(db.raw.prepare("SELECT role_id FROM dispatches WHERE item_id='P'").get().role_id, 'program-manager-1');
});

test('a deployment switches a manager off by data: it is not hired, an existing row is kept and not dispatched', async () => {
  const reg = { ...register, managers: register.managers.map(m => ({ ...m, tick_every: 1 })), switch: { 'funding-manager': { state: 'off', reason: 'the owner pays the running cost and seeks no funding' } } };
  assert.equal(isOff(reg, 'funding-manager'), true);
  const db = makeDb();
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m'), ('marketing-manager-1','marketing-manager',1,'m')");
  db.raw.exec("INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('M','m','marketing-manager','x',10,'open')");
  const off2 = { ...reg, switch: { ...reg.switch, 'marketing-manager': { state: 'off', reason: 'no public front end' } } };
  await runTick(db, { config: { ...base, managers: off2 }, now: T0 });
  assert.ok(!roles(db).includes('funding-manager'));
  assert.ok(roles(db).includes('marketing-manager'), 'nothing is deleted');
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM dispatches WHERE item_id='M'").get().n, 0);
});

test('safe defaults: a core manager cannot be switched off and an off switch needs a reason', async () => {
  const reg = { ...register, switch: { operations: { state: 'off', reason: 'saving cost' }, 'design-manager': { state: 'off', reason: ' ' } } };
  const r = roster(reg);
  assert.equal(r.find(m => m.id === 'operations').on, true);
  assert.equal(r.find(m => m.id === 'design-manager').on, true);
  const db = makeDb(), ctx = { config: { managers: reg }, notes: [] };
  const out = await hireStep(db, ctx);
  assert.equal(out.refused.length, 2);
  assert.ok(roles(db).includes('operations') && roles(db).includes('design-manager'));
  assert.match(ctx.notes.join(' '), /manager switch refused/);
});

test('a build with no register changes nothing', async () => {
  const db = makeDb();
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m')");
  await runTick(db, { config: base, now: T0 });
  assert.deepEqual(roles(db), ['staff']);
});
