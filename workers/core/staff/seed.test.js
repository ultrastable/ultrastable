// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from '../_shared/testdb.js';
import { runTick } from '../src/tick.js';
import { L2_EXTRA_STEPS, MIGRATIONS_DIR as KERNEL_DIR, registerProgram } from '../kernel/index.js';
import { MIGRATIONS_DIR, registerPersona, seedPersonas, registerPersonaIfAbsent, staffProbe, staffStep, runManagers, setProgramPlane } from './index.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy, kernel: { slots: 4 } };
const NOW = Date.parse('2026-11-10T12:00:00Z'), HOUR = 3600e3;
const setup = () => makeDb([KERNEL_DIR, MIGRATIONS_DIR]);
const rows = (db, sql, ...a) => db.raw.prepare(sql).all(...a);
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);

test('US-02-R17: a tick over registered programs seeds a portfolio persona and one program persona each, and every due persona writes one brief', async () => {
  const db = setup();
  await registerProgram(db, { id: 'OPS', name: 'ops', objective: 'keep the site running' }); await registerProgram(db, { id: 'REACH', name: 'reach' });
  const r = await runTick(db, { config, now: NOW, extraSteps: [...L2_EXTRA_STEPS, staffStep()] });
  assert.deepEqual(r.errors, []); assert.match(r.report, /seeded pfm pgm-OPS pgm-REACH/);
  const ps = rows(db, `SELECT id, role, program_id, tick_every, filled_by, instruction_source, charter FROM staff_personas ORDER BY id`);
  assert.deepEqual(ps.map(p => [p.id, p.role, p.program_id, p.tick_every]), [['pfm', 'portfolio-manager', null, 6], ['pgm-OPS', 'program-manager', 'OPS', 4], ['pgm-REACH', 'program-manager', 'REACH', 4]]);
  assert.equal(ps[1].instruction_source, 'agents/roles/program-manager.md'); assert.equal(ps[1].charter, 'keep the site running');
  assert.deepEqual(JSON.parse(one(db, `SELECT authority FROM staff_personas WHERE id = 'pfm'`).authority), ['allocate', 'demote', 'score']);
  // tick 12 is due for tick_every 6 and 4: all three write a brief
  const m = await runManagers(db, { tickId: 12, now: NOW });
  assert.deepEqual([m.personas, m.briefs, m.errors], [3, 3, []]);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM staff_briefs WHERE tick_id = 12`).n, 3);
});

test('US-02-R17: seeding is idempotent and never overwrites an existing, edited or person-filled persona, nor adds a second for a program that has one', async () => {
  const db = setup();
  await registerProgram(db, { id: 'OPS', name: 'ops' }); await registerProgram(db, { id: 'REACH', name: 'reach' }); await registerProgram(db, { id: 'DOCS', name: 'docs' });
  await registerPersona(db, { id: 'pgm-OPS', role: 'program-manager', program_id: 'OPS', scope: 'edited scope', instruction_source: 'mine.md', authority: ['score'], filled_by: 'person', holder: 'a-person', now: NOW });
  await registerPersona(db, { id: 'reach-lead', role: 'program-manager', program_id: 'REACH', scope: 's', instruction_source: 'mine.md', authority: ['score'], now: NOW });
  assert.deepEqual((await seedPersonas(db, { now: NOW })).seeded, ['pfm', 'pgm-DOCS']);
  assert.deepEqual((await seedPersonas(db, { now: NOW + HOUR })).seeded, []);
  const kept = one(db, `SELECT scope, filled_by, holder, authority FROM staff_personas WHERE id = 'pgm-OPS'`);
  assert.deepEqual([kept.scope, kept.filled_by, kept.holder, kept.authority], ['edited scope', 'person', 'a-person', '["score"]']);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM staff_personas WHERE program_id = 'REACH'`).n, 1);
  assert.equal(await registerPersonaIfAbsent(db, { id: 'pgm-OPS', role: 'program-manager', program_id: 'OPS', scope: 'x', instruction_source: 'y.md', authority: ['score'] }), false);
  // the person-filled persona is never acted for by the tick
  await runManagers(db, { tickId: 12, now: NOW });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM staff_actions WHERE persona_id = 'pgm-OPS'`).n, 0);
});

test('US-02-R17: config.staff.seed_personas false seeds none; a program registered later gets its persona on the next tick; a private plane is kept', async () => {
  const db = setup();
  await registerProgram(db, { id: 'OPS', name: 'ops' });
  const cfg = { ...config, staff: { seed_personas: false } };
  const off = await runTick(db, { config: cfg, now: NOW, extraSteps: [...L2_EXTRA_STEPS, staffStep()] });
  assert.doesNotMatch(off.report, /seeded/); assert.equal(one(db, `SELECT COUNT(*) AS n FROM staff_personas`).n, 0);
  assert.deepEqual(await seedPersonas(db, { now: NOW, config: cfg }), { seeded: [], skipped: 'config.staff.seed_personas is false' });
  await runTick(db, { config, now: NOW + HOUR, extraSteps: [...L2_EXTRA_STEPS, staffStep()] });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM staff_personas`).n, 2);
  await registerProgram(db, { id: 'SECRET', name: 'secret' }); await setProgramPlane(db, 'SECRET', 'private');
  await runTick(db, { config, now: NOW + 2 * HOUR, extraSteps: [...L2_EXTRA_STEPS, staffStep()] });
  assert.deepEqual({ ...one(db, `SELECT plane, program_id FROM staff_personas WHERE id = 'pgm-SECRET'`) }, { plane: 'private', program_id: 'SECRET' });
});

test('US-02-R17: the instruction source comes from the port, and falls back to the product manager file when the program manager file is not there', async () => {
  const db = setup(); await registerProgram(db, { id: 'OPS', name: 'ops' });
  await seedPersonas(db, { now: NOW, ports: { instructionExists: async (p) => p !== 'agents/roles/program-manager.md' } });
  assert.equal(one(db, `SELECT instruction_source FROM staff_personas WHERE id = 'pgm-OPS'`).instruction_source, 'agents/roles/product-manager.md');
  const db2 = setup(); await registerProgram(db2, { id: 'OPS', name: 'ops' });
  await seedPersonas(db2, { now: NOW, ports: { instructionFor: async (role) => `roles/${role}.md` } });
  assert.equal(one(db2, `SELECT instruction_source FROM staff_personas WHERE id = 'pgm-OPS'`).instruction_source, 'roles/program-manager.md');
});

test('US-02-R05: staffProbe reports personas and the latest tick\'s briefs from the store, writes nothing, and answers on an empty store', async () => {
  const db = setup();
  const empty = await staffProbe(db, { now: NOW });
  assert.deepEqual([empty.personas, empty.active, empty.latest_tick, empty.briefs_on_latest_tick, empty.actions_24h], [0, 0, null, null, 0]);
  await registerProgram(db, { id: 'OPS', name: 'ops' });
  const r = await runTick(db, { config, now: NOW, extraSteps: [...L2_EXTRA_STEPS, staffStep()] });
  const count = () => ['staff_personas', 'staff_actions', 'staff_denials', 'staff_briefs', 'items'].map(t => one(db, `SELECT COUNT(*) AS n FROM ${t}`).n);
  const before = count();
  const p = await staffProbe(db, { now: NOW });
  assert.deepEqual(count(), before);                                                       // read-only
  assert.deepEqual([p.personas, p.active, p.filled_by_person, p.latest_tick], [2, 2, 0, r.tickId]);
  assert.equal(p.briefs_on_latest_tick, one(db, `SELECT COUNT(*) AS n FROM staff_briefs WHERE tick_id = ?`, r.tickId).n);
});
