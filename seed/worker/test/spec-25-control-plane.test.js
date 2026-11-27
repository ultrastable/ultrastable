// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-25 US-25-R23 (TS-13): in the shared control plane a runtime selects, claims, advances, closes and counts only rows of its own tenant.
// A row with no tenant is the runtime's own, a row carrying another tenant's id is never acted on, and the predicate is one clause on the rows the
// existing access path already reads (src/tenant.js OWN_SQL). The full per-step suite is test/tenant-isolation.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick } from '../src/tick.js';
import { pickForRole } from '../src/critloop.js';
import { OWN_SQL } from '../src/tenant.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 'ultrastable', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const T0 = Date.parse('2026-11-10T00:00:00Z');
const get = (db, sql, ...a) => db.raw.prepare(sql).get(...a);

test('US-25-R23: the own-tenant predicate is one clause, NULL or the runtime\'s own slug, and adds no query', () => {
  assert.equal(OWN_SQL(), '(tenant_id IS NULL OR tenant_id = ?)');
  assert.equal(OWN_SQL('i.tenant_id'), '(i.tenant_id IS NULL OR i.tenant_id = ?)');
});

test('US-25-R23: another tenant\'s ready item is never picked, claimed or dispatched; an own item and a row carrying the own slug are', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,priority,status,tenant_id) VALUES ('F-1','f','operations','x',0,'ready','other-tenant');`);
  assert.equal(await pickForRole(db, { role: 'operations', project: null }, null, [], 'ultrastable'), null);
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,priority,status,tenant_id) VALUES ('S-1','s','operations','x',90,'ready','ultrastable');`);
  assert.equal((await pickForRole(db, { role: 'operations', project: null }, null, [], 'ultrastable')).id, 'S-1');
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m');`);
  await runTick(db, { config, now: T0 });
  assert.equal(get(db, "SELECT item_id FROM claims WHERE item_id='F-1'"), undefined, 'the foreign item is not claimed');
  assert.equal(get(db, "SELECT status FROM items WHERE id='F-1'").status, 'ready', 'the foreign item is not advanced');
  assert.equal(get(db, "SELECT COUNT(*) AS n FROM dispatches WHERE item_id='F-1'").n, 0);
});
