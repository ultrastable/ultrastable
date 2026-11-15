// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// CRITICALITY-LOOP-1: the loop around k_eff acts, predicts, grades itself and beats, on a frozen clock and an empty database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick } from '../src/tick.js';
import { readControl, pickForRole, regimeOf, raisesK, loopHealth, RAISE, OPEN } from '../src/critloop.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const crit = JSON.parse(readFileSync(new URL('../../autonomy/criticality.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy, criticality: crit };
const T0 = Date.parse('2026-11-10T00:00:00Z');
const step = i => T0 + i * 600e3;
const hist = db => db.raw.prepare('SELECT * FROM criticality_history ORDER BY id').all();
const acts = db => db.raw.prepare('SELECT * FROM criticality_actions ORDER BY id').all();

test('every tick writes one beat; the loop is beating and reports it', async () => {
  const db = makeDb();
  for (let i = 0; i < 3; i++) await runTick(db, { config, now: step(i) });
  assert.equal(hist(db).length, 3);
  const h = await loopHealth(db, crit, step(2) + 1000);
  assert.equal(h.beating, true);
  assert.equal((await loopHealth(db, crit, step(2) + 3 * crit.control.beat_interval_s * 1000)).beating, false, 'a silent loop reads as not beating');
});

test('after subcritical_ticks beats under k_min the lever moves to raise-only with a logged prediction', async () => {
  const db = makeDb();
  for (let i = 0; i < crit.control.subcritical_ticks; i++) await runTick(db, { config, now: step(i) });
  assert.equal((await readControl(db)).mode, RAISE);
  const a = acts(db);
  assert.equal(a.length, 1);
  assert.match(a[0].prediction, /^k_eff > [\d.]+ within 24 h$/);
  assert.equal(a[0].result, null);
});

test('the lever is not moved before the threshold beat', async () => {
  const db = makeDb();
  for (let i = 0; i < crit.control.subcritical_ticks - 1; i++) await runTick(db, { config, now: step(i) });
  assert.equal((await readControl(db)).mode, OPEN);
});

test('a missed prediction reverts the lever, files CRIT-LEVER at the head and blocks a retry for the cooldown', async () => {
  const db = makeDb();
  for (let i = 0; i < crit.control.subcritical_ticks; i++) await runTick(db, { config, now: step(i) });
  const due = Date.parse(acts(db)[0].due_at.replace(' ', 'T') + 'Z');
  await runTick(db, { config, now: due + 1000 });
  assert.equal(acts(db)[0].result, 'miss');
  assert.equal((await readControl(db)).mode, OPEN);
  const it = db.raw.prepare("SELECT priority FROM items WHERE id LIKE 'CRIT-LEVER-%'").get();
  assert.ok(it && it.priority === crit.origination.head_priority);
  await runTick(db, { config, now: due + 600e3 });
  await runTick(db, { config, now: due + 1200e3 });
  assert.equal((await readControl(db)).mode, OPEN, 'cooldown holds the lever open');
  assert.equal(acts(db).length, 2, 'only the move and the revert exist');
});

test('a hit is graded when k_eff has risen and the due time passes; the lever stays', async () => {
  const db = makeDb();
  for (let i = 0; i < crit.control.subcritical_ticks; i++) await runTick(db, { config, now: step(i) });
  const a = acts(db)[0], due = Date.parse(a.due_at.replace(' ', 'T') + 'Z');
  db.raw.prepare(`INSERT INTO criticality_samples (at, source, deploys_ok) VALUES (?, 'test', 50)`).run('2026-11-10 00:20:00');
  await runTick(db, { config, now: due + 1000 });
  const g = acts(db)[0];
  assert.equal(g.result, 'hit');
});

test('k_eff back at k_min releases the lever and grades the open prediction a hit', async () => {
  const db = makeDb();
  for (let i = 0; i < crit.control.subcritical_ticks; i++) await runTick(db, { config, now: step(i) });
  db.raw.prepare(`INSERT INTO criticality_samples (at, source, deploys_ok) VALUES (?, 'test', 500)`).run('2026-11-10 00:31:00');
  await runTick(db, { config, now: step(4) });
  assert.equal((await readControl(db)).mode, OPEN);
  assert.equal(acts(db)[0].result, 'hit');
  assert.equal(acts(db).at(-1).to_value, OPEN);
});

test('raise-only dispatch takes a raising item first and falls back to the head so the queue cannot starve', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('operations-1','operations',1,'m');
    INSERT INTO items (id,title,kind,owner_role,done_check,priority,status) VALUES
     ('W-1','feature','work','operations','d',1,'ready'),('Q-COST-9','cut','work','operations','d',5,'ready');`);
  const role = db.raw.prepare("SELECT * FROM roles").get();
  assert.equal((await pickForRole(db, role, crit)).id, 'W-1', 'open lever: ordinary head');
  db.raw.prepare("INSERT INTO org (key,value) VALUES ('criticality_control', ?)").run(JSON.stringify({ mode: RAISE }));
  assert.equal((await pickForRole(db, role, crit)).id, 'Q-COST-9', 'raise-only: the raising item first');
  db.raw.exec("DELETE FROM items WHERE id='Q-COST-9'");
  assert.equal((await pickForRole(db, role, crit)).id, 'W-1', 'none raises: the head, never starved');
});

test('a stalled subcritical run files CRIT-STALL at the head of the queue', async () => {
  const db = makeDb();
  const c = { ...crit, control: { ...crit.control, stall_ticks: 3 } };
  for (let i = 0; i < 4; i++) await runTick(db, { config: { ...config, criticality: c }, now: step(i) });
  assert.ok(db.raw.prepare("SELECT 1 FROM items WHERE id LIKE 'CRIT-STALL-%'").get());
  assert.ok(hist(db).some(h => h.stalled === 1));
});

test('pure helpers: regime bands and the raises predicate; no control block leaves the lever open', async () => {
  assert.equal(regimeOf(0.5, crit), 'subcritical'); assert.equal(regimeOf(2, crit), 'critical'); assert.equal(regimeOf(5, crit), 'supercritical');
  assert.equal(raisesK({ id: 'Q-DEPLOY-1', kind: 'work' }, crit.control), true);
  assert.equal(raisesK({ id: 'W-1', kind: 'work' }, crit.control), false);
  const db = makeDb(); const { control, ...bare } = crit;
  for (let i = 0; i < 5; i++) await runTick(db, { config: { ...config, criticality: bare }, now: step(i) });
  assert.equal((await readControl(db)).mode, OPEN); assert.equal(hist(db).length, 0);
});
