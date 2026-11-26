// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from '../_shared/testdb.js';
import { MIGRATIONS_DIR as KERNEL_DIR, registerProgram, registerMetric } from '../kernel/index.js';
import { MIGRATIONS_DIR, registerPersona, createToolLayer, buildStaffScreen, handleStaffRequest } from './index.js';

const NOW = Date.parse('2026-11-10T12:00:00Z'), HOUR = 3600e3;
const ts = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const PM_OPS = ['promote', 'restore', 'close_with_evidence', 'supersede', 'assign_doer', 'score'];
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const item = (db, id, o = {}) => db.raw.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, priority, status, project, created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(id, o.title || id, 'fix', 'staff', 'x', o.priority ?? 50, 'ready', o.project ?? null, ts(NOW - 48 * HOUR));
async function setup() {
  const db = makeDb([KERNEL_DIR, MIGRATIONS_DIR]);
  await registerProgram(db, { id: 'REACH', name: 'reach' }); await registerProgram(db, { id: 'OPS', name: 'ops' });
  await registerPersona(db, { id: 'pgm-reach', role: 'program-manager', program_id: 'REACH', scope: 's', instruction_source: 'f.md', authority: PM_OPS, filled_by: 'person', holder: 'alex', now: NOW });
  await registerPersona(db, { id: 'pgm-ops', role: 'program-manager', program_id: 'OPS', scope: 's', instruction_source: 'f.md', authority: PM_OPS, now: NOW });
  db.raw.prepare(`INSERT INTO tick_runs (id, started_at, steps_total, steps_completed, report) VALUES (7, '2026-11-10 11:00:00', 1, 1, 'x')`).run();
  item(db, 'R1', { project: 'REACH', priority: 50 }); item(db, 'O1', { project: 'OPS', priority: 50 });
  db.raw.prepare(`INSERT INTO kernel_focus (program_id, item_id, rank, tier, has_doer, tick_id) VALUES ('REACH', 'R1', 1, 0, 0, 1)`).run();
  return { db, tools: createToolLayer({ db, now: () => NOW }) };
}

test('US-02-R18, US-02-R11: a person performs a role\'s operation through the screen and the records match an agent\'s', async () => {
  const { db, tools } = await setup();
  const r = await handleStaffRequest(tools, { method: 'POST', path: '/api/staff/pgm-reach/act', principal: 'alex', body: { op: 'promote', args: { item_id: 'R1' }, prediction: 'reach_visits >= 10 within 24 h' } });
  assert.equal(r.status, 200);
  assert.equal(one(db, `SELECT priority FROM items WHERE id = 'R1'`).priority, 10);
  const a = one(db, `SELECT * FROM staff_actions WHERE persona_id = 'pgm-reach'`);
  assert.deepEqual([a.op, a.item_id, a.field, a.from_value, a.to_value, a.tick_id], ['promote', 'R1', 'priority', '50', '10', 7]);
  assert.deepEqual({ ...one(db, `SELECT surface, action_class, result FROM outcomes WHERE agent = 'pgm-reach'`) }, { surface: 'manager-ops', action_class: 'promote', result: 'verified' });
  assert.match(one(db, `SELECT text FROM staff_briefs WHERE persona_id = 'pgm-reach' AND tick_id = 7`).text, /filled by a person[\s\S]*promote R1/);
  assert.match(one(db, `SELECT decision_id FROM staff_actions WHERE persona_id = 'pgm-reach'`).decision_id, /^STAFF-/);
  const rv = await handleStaffRequest(tools, { method: 'POST', path: '/api/staff/pgm-reach/reverse', principal: 'alex', body: { action_id: a.id, evidence: 'changed my mind' } });
  assert.equal(rv.status, 200); assert.equal(one(db, `SELECT priority FROM items WHERE id = 'R1'`).priority, 50);
});

test('US-02-R18: a principal other than the persona\'s holder, and an agent persona, are refused from the screen and the refusal is recorded', async () => {
  const { db, tools } = await setup();
  const other = await handleStaffRequest(tools, { method: 'POST', path: '/api/staff/pgm-reach/act', principal: 'mallory', body: { op: 'promote', args: { item_id: 'R1' } } });
  const agent = await handleStaffRequest(tools, { method: 'POST', path: '/api/staff/pgm-ops/act', principal: 'alex', body: { op: 'promote', args: { item_id: 'O1' } } });
  assert.deepEqual([other.status, agent.status], [403, 403]);
  assert.equal(one(db, `SELECT priority FROM items WHERE id IN ('R1') `).priority, 50); assert.equal(one(db, `SELECT COUNT(*) AS n FROM staff_actions`).n, 0);
  assert.deepEqual(db.raw.prepare(`SELECT persona_id, op, kind FROM staff_denials ORDER BY id`).all().map(d => [d.persona_id, d.op, d.kind]), [['pgm-reach', 'screen:act', 'authority'], ['pgm-ops', 'screen:act', 'authority']]);
  // the identity is the principal and the path, never the body
  const spoof = await handleStaffRequest(tools, { method: 'POST', path: '/api/staff/pgm-reach/act', principal: 'mallory', body: { op: 'promote', persona: 'pgm-reach', principal: 'alex', args: { item_id: 'R1' } } });
  assert.equal(spoof.status, 403);
  assert.equal((await handleStaffRequest(tools, { method: 'GET', path: '/api/staff', principal: null })).status, 401);
  assert.equal((await handleStaffRequest(tools, { method: 'POST', path: '/api/staff/nobody/act', principal: 'alex', body: { op: 'promote' } })).status, 404);
});

test('US-02-R18: the screen lists only operations on the persona\'s authority list with their eligible items, and an operation outside it is refused and recorded', async () => {
  const { db, tools } = await setup();
  await registerPersona(db, { id: 'pgm-lite', role: 'program-manager', program_id: 'REACH', scope: 's', instruction_source: 'f.md', authority: ['score'], filled_by: 'person', holder: 'blake', now: NOW });
  const sc = await handleStaffRequest(tools, { method: 'GET', path: '/api/staff', principal: 'alex' });
  assert.equal(sc.status, 200); assert.deepEqual(sc.body.personas.map(p => p.id), ['pgm-reach']);             // only the personas alex fills
  const p = sc.body.personas[0];
  assert.deepEqual(p.eligible.promote.map(e => [e.item_id, e.from, e.to]), [['R1', 50, 10]]);                  // a focus item the persona could promote now
  assert.deepEqual(p.eligible.restore, []);                                                                    // nothing demoted: nothing to restore
  assert.deepEqual(p.eligible.supersede, { needs: ['by'], candidates: ['R1'] });                               // the lane is the persona's program only
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM staff_actions`).n + one(db, `SELECT COUNT(*) AS n FROM staff_denials`).n, 0);   // viewing writes nothing
  const lite = (await buildStaffScreen(tools, { principal: 'blake' })).personas[0];
  assert.deepEqual(Object.keys(lite.eligible), []);
  const r = await handleStaffRequest(tools, { method: 'POST', path: '/api/staff/pgm-lite/act', principal: 'blake', body: { op: 'promote', args: { item_id: 'R1' } } });
  assert.deepEqual([r.status, r.body.kind], [422, 'authority']);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM staff_denials WHERE persona_id = 'pgm-lite' AND kind = 'authority'`).n, 1);
  assert.equal((await handleStaffRequest(tools, { method: 'POST', path: '/api/staff/pgm-reach/act', principal: 'alex', body: {} })).status, 400);
  await assert.rejects(buildStaffScreen(tools, {}), /principal/);
});
