// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from '../_shared/testdb.js';
import { MIGRATIONS_DIR as KERNEL_DIR, registerProgram } from '../kernel/index.js';
import { MIGRATIONS_DIR, registerPersona, createToolLayer, isControlPlane, originate, DEFAULTS } from './index.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const GUARDS = ['tools/spec_truth.py', 'tools/selfhost_check.py', 'core/test/no-qnfo.test.js', 'scripts/protected_paths.py', 'core/org/index.js', 'core/org/buildout.js',
  'adapters/cloudflare/src/index.js', 'adapters/cloudflare/src/heartbeat.js', 'runtimes/python/ultrastable/engine.py', 'seed/worker/src/tick.js', 'worker/src/tick.js'];
const OLD = ['autonomy/policy.json', 'core/src/tick.js', 'SCOPE.md', '.github/workflows/x.yml', 'core/governance/amend.js', 'agents/roles/staff.md', 'ultrastable.json'];

test('US-02-R10: the guards the repository protects and every implementation of the tick are control-plane paths; ordinary specs and modules are not', () => {
  for (const p of [...GUARDS, ...OLD]) assert.equal(isControlPlane(p), true, p);
  for (const p of ['specs/US-SPEC-02-virtual-staff.md', 'core/plus/index.js', 'site/home.js', 'core/staff/index.js', 'tools/other.py']) assert.equal(isControlPlane(p), false, p);
  assert.equal(isControlPlane('./tools/spec_truth.py'), true);                       // a leading ./ does not hide it
  assert.equal(isControlPlane('vendor/x/tools/spec_truth.py'), true);                // nor does a prefix
});

test('US-02-R10: control_plane_extra appends to the defaults; control_plane replaces them', () => {
  assert.equal(isControlPlane('site/billing.js', { control_plane_extra: ['site/billing.js'] }), true);
  assert.equal(isControlPlane('autonomy/policy.json', { control_plane_extra: ['site/billing.js'] }), true);               // the defaults still hold
  assert.equal(isControlPlane('tools/spec_truth.py', { control_plane: ['only/this.js'] }), false);                          // replacement is the old, explicit meaning
  assert.ok(DEFAULTS.control_plane.length > 11);
});

test('US-02-R10: assign_doer and originate refuse a guard file with a control_plane denial', async () => {
  const db = makeDb([KERNEL_DIR, MIGRATIONS_DIR]);
  await registerProgram(db, { id: 'OPS', name: 'ops' });
  await registerPersona(db, { id: 'pgm-ops', role: 'program-manager', program_id: 'OPS', scope: 's', instruction_source: 'f.md', authority: ['assign_doer', 'originate'], now: NOW });
  db.raw.prepare(`INSERT INTO items (id, title, owner_role, done_check, priority, status, project) VALUES ('A', 'A', 'staff', 'x', 50, 'ready', 'OPS')`).run();
  const tools = createToolLayer({ db, now: () => NOW, ports: { readFile: async () => 'x // ANCHOR y', research: async () => 'TITLE: t\nWHY: w\ncode-task: tools/spec_truth.py\ncode-anchor: // ANCHOR\nEDIT: e' } });
  const r = await tools.act('pgm-ops', 'assign_doer', { item_id: 'A', doer: 'staff', path: 'tools/spec_truth.py', anchor: '// ANCHOR' });
  assert.deepEqual([r.ok, r.kind], [false, 'control_plane']);
  const o = await originate(tools, 'pgm-ops', { tickId: 1 });
  assert.match(o.refused, /control-plane file/);
  const kinds = db.raw.prepare(`SELECT kind FROM staff_denials ORDER BY id`).all().map(d => d.kind);
  assert.deepEqual(kinds, ['control_plane', 'control_plane']);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM items WHERE id LIKE 'ROADMAP-%'`).get().n, 0);
});
