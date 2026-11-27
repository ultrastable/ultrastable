// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-08 in the seed: the requirements whose reference implementation is the seed tick and doer, not workers/core/claims.
// US-08-R24 (a runtime on a shared store acts only on its own tenant's rows) and US-08-R25 (an owner-only item is held under a gate card
// with a default in effect and a closing probe). The wider behaviour is covered by tenant-isolation.test.js and doer.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick } from '../src/tick.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 'ultrastable', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const T0 = Date.parse('2026-11-10T00:00:00Z');
const get = (db, sql, ...a) => db.raw.prepare(sql).get(...a);

test('US-08-R24: a runtime on a shared store selects, advances, closes and counts only its own tenant rows', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status,tenant_id) VALUES
    ('F-open','f','nobody','x','open','other-tenant'), ('F-drop','f','nobody','x','done','other-tenant'), ('O-open','o','nobody','x','open',NULL), ('O-drop','o','nobody','x','done',NULL);
    INSERT INTO claims (item_id,agent,claimed_at,heartbeat_at,tenant_id) VALUES ('F-open','zz-1','2026-11-01 00:00:00','2026-11-01 00:00:00','other-tenant');
    INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe,tenant_id) VALUES ('G-F','f','w','d','env:KEY','other-tenant'), ('G-O','o','w','d','env:KEY',NULL);`);
  await runTick(db, { config, now: T0, env: { KEY: true } });
  assert.equal(get(db, "SELECT status FROM items WHERE id='F-open'").status, 'open', 'a foreign item is not advanced');
  assert.equal(get(db, "SELECT status FROM items WHERE id='F-drop'").status, 'done', 'a foreign silent drop is not reopened');
  assert.ok(get(db, "SELECT item_id FROM claims WHERE item_id='F-open'"), 'a foreign claim is not reaped');
  assert.equal(get(db, "SELECT status FROM gate_cards WHERE id='G-F'").status, 'open', 'a foreign card is not closed by this probe');
  assert.notEqual(get(db, "SELECT status FROM items WHERE id='O-open'").status, 'open', 'an own item is advanced');
  assert.notEqual(get(db, "SELECT status FROM items WHERE id='O-drop'").status, 'done', 'an own silent drop is reopened');
  assert.equal(get(db, "SELECT status FROM gate_cards WHERE id='G-O'").status, 'closed', 'an own card closes on its probe');
  assert.equal(get(db, "SELECT COUNT(*) AS n FROM outcomes WHERE result='silent_drop'").n, 1, 'only the own drop is counted');
});

test('US-08-R25: an owner-only item is held under one gate card that carries a default in effect and a closing probe', async () => {
  const db = makeDb();
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m')");
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,priority,status,created_at) VALUES
    ('FN-A','FN-A: Cloudflare for Startups application','staff','Submission confirmation',10,'ready','2026-11-09 00:00:00'),
    ('FN-B','FN-B: Google for Startups Cloud Program application','staff','Submission confirmation',11,'ready','2026-11-09 00:00:00')`);
  await runTick(db, { config, now: T0 });
  await runTick(db, { config, now: T0 + 600e3 });
  const held = db.raw.prepare("SELECT id, status, blocker FROM items WHERE id IN ('FN-A','FN-B') ORDER BY id").all();
  assert.ok(held.every(h => h.status === 'blocked' && /^owner-only:/.test(h.blocker)), 'both are parked with an owner-only reason');
  const cards = db.raw.prepare('SELECT * FROM gate_cards').all();
  assert.equal(cards.length, 1, 'one consolidated card holds both');
  assert.equal(cards[0].id, 'GATE-OWNER-ITEMS');
  assert.ok(cards[0].default_in_effect && cards[0].default_in_effect.trim(), 'a default in effect');
  assert.equal(cards[0].closing_probe, 'owner_items:0');
  assert.equal(cards[0].status, 'open');
  db.raw.exec("UPDATE items SET status='done', disposition='submitted' WHERE id IN ('FN-A','FN-B')");
  await runTick(db, { config, now: T0 + 1200e3 });
  assert.equal(get(db, "SELECT status FROM gate_cards WHERE id='GATE-OWNER-ITEMS'").status, 'closed', 'the card closes when no owner-only item is left');
});
