// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { makeDb } from '../_shared/testdb.js';
import { runTick } from '../src/tick.js';
import { MIGRATIONS_DIR as KERNEL_DIR } from '../kernel/index.js';
import { MIGRATIONS_DIR, registerPersona } from './index.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const NOW = Date.parse('2026-11-10T12:00:00Z');
const root = new URL('../../', import.meta.url);

test('US-02-R01: a role is a record naming role, scope and instruction source, and the roles table carries a tick interval and a model', async () => {
  const db = makeDb([KERNEL_DIR, MIGRATIONS_DIR]);
  const base = { id: 'p', role: 'program-manager', program_id: 'OPS', scope: 'program OPS', instruction_source: 'agents/roles/product-manager.md', authority: ['score'] };
  for (const f of ['role', 'scope', 'instruction_source']) await assert.rejects(registerPersona(db, { ...base, [f]: '' }), new RegExp(f));
  await registerPersona(db, base);
  const cols = db.raw.prepare(`PRAGMA table_info(roles)`).all().map(c => c.name);
  for (const c of ['role', 'tick_every', 'model']) assert.ok(cols.includes(c), `roles.${c}`);
  const cfg = JSON.parse(readFileSync(new URL('ultrastable.json', root), 'utf8'));
  assert.ok(cfg.roles.length >= 6);
  for (const r of cfg.roles) {
    assert.ok(r.id && r.instructions, `role ${r.id} names an id and an instruction source`);
    assert.ok(existsSync(new URL(r.instructions, root)), `${r.instructions} exists`);
    assert.ok(Number.isInteger(r.tick_every) && r.tick_every >= 1, `${r.id} has a tick interval`);
  }
});

test('US-02-R01: a role with tick_every 3 is dispatched only on ticks divisible by 3', async () => {
  const db = makeDb([KERNEL_DIR, MIGRATIONS_DIR]);
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('slow-1', 'slow', 3, 'm')`);
  for (let i = 1; i <= 6; i++) db.raw.prepare(`INSERT INTO items (id, title, owner_role, done_check, status) VALUES (?,?,?,?,?)`).run(`S${i}`, `S${i}`, 'slow', 'x', 'ready');
  const ticks = [];
  for (let i = 0; i < 6; i++) { const r = await runTick(db, { config: { ...config, max_wip_per_role: 9 }, now: NOW + i * 3600e3 }); ticks.push(r.tickId); }
  const dispatched = db.raw.prepare(`SELECT DISTINCT tick_id FROM dispatches WHERE role_id = 'slow-1' ORDER BY tick_id`).all().map(r => r.tick_id);
  assert.ok(dispatched.length >= 1 && dispatched.every(t => t % 3 === 0), `dispatched on ticks ${dispatched}`);
  assert.deepEqual(dispatched, ticks.filter(t => t % 3 === 0));
});
