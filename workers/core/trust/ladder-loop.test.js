// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-06-R24, US-06-T10: the ladder loop closes in one database, from a scored decision to a rung in the ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { runTick, evalProbe } from '../src/tick.js';
import * as P from '../predict/index.js';
import * as T from './index.js';

const POLICY = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const NOW = Date.UTC(2026, 10, 11, 10, 0, 0);
const H = 3600e3;
const mk = () => makeDb([fileURLToPath(P.MIGRATIONS_DIR), fileURLToPath(T.MIGRATIONS_DIR)]);
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const rows = (db, sql, ...a) => db.raw.prepare(sql).all(...a);

test('US-06-R24, US-06-T10: 12 scored predictions become outcomes, the tick proposes the ladder item, the merge by a different agent applies it (decision to rung, one database); the same agent is refused', async () => {
  const db = mk();
  db.raw.prepare(`INSERT INTO items (id, title, owner_role, done_check, status, disposition) VALUES ('W1','w','operations','observed','done','done: observed')`).run();
  await P.registerMetric(db, { name: 'items_done', read_sql: `SELECT COUNT(*) FROM items WHERE status='done'` });
  for (let i = 0; i < 12; i++) {
    await P.recordDecision(db, { id: `D${i}`, decision: `draft ${i}`, predicted_outcome: 'items_done >= 1 within 1 h', revert_path: 'discard the draft', surface: 'outreach', action_class: 'draft', persona: 'writer-1' }, { now: NOW - 2 * H });
  }
  let merges = [];
  const merged = async () => merges;
  const config = { policy: POLICY, claim_ttl_minutes: 60, max_wip_per_role: 2, plus_share: 0.2 };
  const extraSteps = [
    { name: 'predict', run: async (db_, ctx) => { const r = await P.step({ db: db_, now: ctx.now }); ctx.notes.push(`predict scored ${r.scored}`); } },
    { name: 'trust', run: async (db_, ctx) => { const r = await T.step({ db: db_, policy: POLICY, now: ctx.now, merged }); ctx.notes.push(`trust ${JSON.stringify(r)}`); } },
  ];
  const tick = async (at) => { const r = await runTick(db, { config, now: at, extraSteps }); assert.deepEqual(r.errors, []); return r; };

  // tick 1: the predictions are scored and write 12 verified outcomes; trust recompute then proposes the ladder item
  await tick(NOW);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM outcomes WHERE surface='outreach' AND action_class='draft' AND result='verified'`).n, 12);
  const ITEM = 'LADDER-outreach-draft-assisted';
  assert.deepEqual({ ...one(db, `SELECT kind, status, closing_probe FROM items WHERE id=?`, ITEM) }, { kind: 'ladder', status: 'ready', closing_probe: 'trust_ledger rung = assisted' });
  assert.equal(rows(db, `SELECT * FROM trust_transitions WHERE item_id=? AND status='proposed'`, ITEM).length, 1, 'one proposal, for the pair: an executor is never promoted above its pair');
  assert.equal(rows(db, `SELECT * FROM items WHERE kind='ladder' AND id=?`, ITEM).length, 1);

  // tick 2: the merge was made by the agent that opened the item: refused, the item stays open with the reason as its blocker
  merges = [{ item_id: ITEM, merged_by: 'operations' }];
  await tick(NOW + 10 * 60e3);
  assert.equal(one(db, `SELECT rung FROM trust_ledger WHERE surface='outreach' AND action_class='draft'`).rung, 'observed');
  const open = one(db, `SELECT status, blocker FROM items WHERE id=?`, ITEM);
  assert.notEqual(open.status, 'done'); assert.equal(open.blocker, 'merged by the agent that opened the item');
  await tick(NOW + 20 * 60e3); // the same listing again is not logged again
  assert.equal(rows(db, `SELECT * FROM trust_transitions WHERE item_id=? AND status='refused'`, ITEM).length, 1);

  // tick 4: a different agent merged it: the rung is written, the transition is applied, the item closes naming the agent
  merges = [{ item_id: ITEM, merged_by: 'reviewer-2' }];
  await tick(NOW + 30 * 60e3);
  assert.equal(one(db, `SELECT rung FROM trust_ledger WHERE surface='outreach' AND action_class='draft'`).rung, 'assisted');
  const done = one(db, `SELECT status, blocker, disposition FROM items WHERE id=?`, ITEM);
  assert.equal(done.status, 'done'); assert.equal(done.blocker, null);
  assert.match(done.disposition, /^done: outreach\/draft now assisted \(transition \d+, merged by reviewer-2\)$/);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM trust_transitions WHERE item_id=? AND status='applied'`, ITEM).n, 1);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM outcomes WHERE item_id=? AND surface='work_tracker' AND action_class='ladder' AND result='verified'`, ITEM).n, 1);
  assert.equal((await evalProbe(db, { env: {} }, { ...one(db, `SELECT * FROM items WHERE id=?`, ITEM) })).ok, true, 'the closing probe the seed tick reads is now true');

  // a later pass with the same listing neither applies twice nor records a second outcome
  await tick(NOW + 40 * 60e3);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM trust_transitions WHERE item_id=? AND status='applied'`, ITEM).n, 1);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM outcomes WHERE item_id=? AND action_class='ladder'`, ITEM).n, 1);
});

test('US-06-R24: settleLadder with no port changes nothing; an item with no proposed transition is reported, not invented; a rung above the ceiling is refused with the reason as the blocker; a crash between the two writes is repaired', async () => {
  const db = mk();
  assert.deepEqual(await T.settleLadder(db, { policy: POLICY, now: NOW }), { applied: [], refused: [], unknown: [] });
  assert.deepEqual((await T.settleLadder(db, { policy: POLICY, merged: async () => [{ item_id: 'NOPE', merged_by: 'reviewer-2' }, null, {}], now: NOW })).unknown, ['NOPE']);
  db.raw.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, status, surface, action_class) VALUES ('X','promote money','ladder','operations','d','ready','money','estimate_cost')`).run();
  db.raw.prepare(`INSERT INTO trust_transitions (surface, action_class, executor, from_rung, to_rung, direction, status, evidence, item_id, opened_by, at) VALUES ('money','estimate_cost','','observed','delegated','promote','proposed','{}','X','ops-1','t')`).run();
  const r = await T.settleLadder(db, { policy: POLICY, merged: async () => [{ item_id: 'X', merged_by: 'reviewer-2' }], now: NOW });
  assert.equal(r.refused.length, 1); assert.match(r.refused[0].reason, /above the surface ceiling assisted/);
  assert.match(one(db, `SELECT blocker FROM items WHERE id='X'`).blocker, /above the surface ceiling assisted/);
  assert.equal(one(db, `SELECT status FROM items WHERE id='X'`).status, 'ready');
  // applied in the ledger but the item still open (a crash between the writes): the next pass closes it
  db.raw.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, status, surface, action_class) VALUES ('Y','promote outreach','ladder','operations','d','ready','outreach','draft')`).run();
  db.raw.prepare(`INSERT INTO trust_transitions (surface, action_class, executor, from_rung, to_rung, direction, status, evidence, item_id, opened_by, merged_by, at) VALUES ('outreach','draft','','observed','assisted','promote','applied','{}','Y','ops-1','reviewer-2','t')`).run();
  await T.settleLadder(db, { policy: POLICY, merged: async () => [{ item_id: 'Y', merged_by: 'reviewer-3' }], now: NOW });
  assert.match(one(db, `SELECT disposition FROM items WHERE id='Y'`).disposition, /merged by reviewer-2\)$/, 'the recorded merging agent is the one named, not the later listing');
  assert.equal(one(db, `SELECT status FROM items WHERE id='Y'`).status, 'done');
});
