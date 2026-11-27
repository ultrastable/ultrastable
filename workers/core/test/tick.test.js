// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { runTick, STEP_ORDER, reliability, DEFAULTS, withDefaults } from '../src/tick.js';
import { openDb } from '../../adapters/sqlite/d1-sqlite.js';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const T0 = Date.parse('2026-11-10T00:00:00Z');

function seed(db) {
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m'), ('op-1','operations',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('A','a','staff','x',10,'open'), ('B','b','staff','x',20,'open');
    INSERT INTO items (id,title,owner_role,done_check,trigger_on,status) VALUES ('C','c','staff','x','A','open');`);
}

test('US-03-T03 and US-03-R07: a tick runs every step and dispatches in priority order; the item whose trigger is not done stays open', async () => {
  const db = makeDb(); seed(db);
  const r = await runTick(db, { config, now: T0 });
  assert.equal(r.completed, STEP_ORDER.length);
  assert.deepEqual(r.errors, []);
  const claims = db.raw.prepare('SELECT item_id FROM claims').all().map(x => x.item_id);
  assert.deepEqual(claims, ['A']);
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='C'").get().status, 'open'); // trigger not done
  assert.match(r.report, /^Happened:/); assert.match(r.report, /Open:/);
});

test('US-03-R03, US-03-R04 and US-03-T02: a failing step never kills the tick and becomes a backlog item', async () => {
  const db = makeDb(); seed(db);
  db.raw.exec('DROP TABLE predictions');
  const r = await runTick(db, { config, now: T0 });
  assert.equal(r.completed, STEP_ORDER.length - 1);
  assert.equal(r.errors.length, 1);
  const item = db.raw.prepare("SELECT owner_role, priority FROM items WHERE id LIKE 'TICKFAIL-score_predictions%'").get();
  assert.equal(item.owner_role, 'operations'); assert.equal(item.priority, 0);
});

test('items that left the active set without a disposition are reopened and counted as silent drops', async () => {
  const db = makeDb(); seed(db);
  db.raw.exec("UPDATE items SET status='done' WHERE id='B'");
  await runTick(db, { config, now: T0 });
  assert.notEqual(db.raw.prepare("SELECT status FROM items WHERE id='B'").get().status, 'done');
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM outcomes WHERE result='silent_drop'").get().n, 1);
});

test('stale claims are released', async () => {
  const db = makeDb(); seed(db);
  await runTick(db, { config, now: T0 });
  await runTick(db, { config, now: T0 + 3 * 3600e3 });
  const dispatches = db.raw.prepare('SELECT COUNT(*) AS n FROM dispatches').get().n;
  assert.ok(dispatches >= 2); // item A was released and re-dispatched
});

test('gate cards close when their probe shows the owner step is done', async () => {
  const db = makeDb(); seed(db);
  db.raw.exec("INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G','set key','owner','dry run','env:CLOUDFLARE_API_TOKEN')");
  await runTick(db, { config, now: T0, env: {} });
  assert.equal(db.raw.prepare("SELECT status FROM gate_cards WHERE id='G'").get().status, 'open');
  await runTick(db, { config, now: T0 + 600e3, env: { CLOUDFLARE_API_TOKEN: true } });
  assert.equal(db.raw.prepare("SELECT status FROM gate_cards WHERE id='G'").get().status, 'closed');
});

test('predictions are scored against built-in metrics', async () => {
  const db = makeDb(); seed(db);
  db.raw.exec("INSERT INTO predictions (id,metric,op,target,due_at) VALUES ('P','open_gate_cards','<=',0,'2026-11-09 00:00:00')");
  await runTick(db, { config, now: T0 });
  assert.equal(db.raw.prepare("SELECT verdict FROM predictions WHERE id='P'").get().verdict, 'hit');
});

test('trust promotes only inside the surface ceiling and only by opening a PR item', async () => {
  const db = makeDb(); seed(db);
  for (let i = 0; i < 12; i++) {
    db.raw.exec("INSERT INTO outcomes (surface,action_class,result) VALUES ('repo','branch_commit_push','verified'), ('money','estimate_cost','verified')");
  }
  await runTick(db, { config, now: T0 });
  const ladder = db.raw.prepare("SELECT id FROM items WHERE kind='ladder'").all().map(x => x.id);
  assert.ok(ladder.some(id => id.startsWith('LADDER-repo-branch_commit_push-autonomous')));
  // money is capped at propose -> assisted; it starts at observed so it may reach assisted, never beyond
  assert.ok(ladder.some(id => id.startsWith('LADDER-money-estimate_cost-assisted')));
  // the ledger itself never changes rung: only a reviewed policy PR does
  assert.equal(db.raw.prepare("SELECT rung FROM trust_ledger WHERE surface='repo'").get().rung, 'delegated');
});

test('a hidden failure demotes', async () => {
  const db = makeDb(); seed(db);
  db.raw.exec("INSERT INTO trust_ledger (surface,action_class,rung,reliability) VALUES ('repo','merge_pr_green','autonomous',0.9)");
  db.raw.exec("INSERT INTO outcomes (surface,action_class,result) VALUES ('repo','merge_pr_green','hidden_failure')");
  await runTick(db, { config, now: T0 });
  assert.ok(db.raw.prepare("SELECT id FROM items WHERE id LIKE 'LADDER-repo-merge_pr_green-delegated'").get());
});

test('reliability starts at the baseline and moves with outcomes', () => {
  assert.equal(reliability(0, 0, policy.trust), 0.5);
  assert.ok(reliability(10, 10, policy.trust) > 0.9);
});

test('US-03-R09: an item addressed to one role instance is dispatched to that instance, not left ready for ever', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, project, tick_every, model) VALUES ('product-manager-1','product-manager','OUT-1',1,'m'), ('product-manager-2','product-manager','OUT-2',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('P2','p','product-manager-2','x',10,'ready');`);
  await runTick(db, { config, now: T0 });
  const claim = db.raw.prepare("SELECT agent FROM claims WHERE item_id='P2'").get();
  assert.ok(claim, 'the item was claimed'); assert.equal(claim.agent, 'product-manager-2');
});

test('US-03-R25 and issue #173: a claim released with no work is recorded, and the item is parked after max_unworked_releases', async () => {
  const db = makeDb(); seed(db);
  const cfg = { ...config, max_unworked_releases: 2 };
  await runTick(db, { config: cfg, now: T0 });
  await runTick(db, { config: cfg, now: T0 + 3 * 3600e3 });
  await runTick(db, { config: cfg, now: T0 + 6 * 3600e3 });
  const unworked = db.raw.prepare("SELECT COUNT(*) AS n FROM outcomes WHERE surface='dispatch' AND result='unworked' AND item_id='A'").get().n;
  assert.equal(unworked, 2);
  const a = db.raw.prepare("SELECT status, blocker, disposition FROM items WHERE id='A'").get();
  assert.equal(a.status, 'blocked');
  assert.match(a.disposition, /^parked: dispatched 2 times, never worked/);
  await runTick(db, { config: cfg, now: T0 + 9 * 3600e3 });
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='A'").get().status, 'blocked', 'a parked item is not claimed again');
});

test('US-03-R25 and issue #173: a claim that was heartbeated is released without an unworked outcome', async () => {
  const db = makeDb(); seed(db);
  await runTick(db, { config, now: T0 });
  db.raw.exec("UPDATE claims SET heartbeat_at = datetime(claimed_at, '+1 minute')");
  await runTick(db, { config, now: T0 + 3 * 3600e3 });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM outcomes WHERE result='unworked'").get().n, 0);
});

test('US-03-R24 and US-03-T11 (issue #173 execute): a dispatched item whose probe passes ends done with evidence in the same tick', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,closing_probe,status) VALUES ('DEP','dep','nobody','x',NULL,'done');
    UPDATE items SET disposition='done: seeded' WHERE id='DEP';
    INSERT INTO items (id,title,owner_role,done_check,closing_probe,priority,status) VALUES ('P1','p','operations','dep is done','item_done:DEP',1,'ready');`);
  const r = await runTick(db, { config, now: T0 });
  assert.deepEqual(r.errors, []);
  const it = db.raw.prepare("SELECT status, disposition FROM items WHERE id='P1'").get();
  assert.equal(it.status, 'done'); assert.match(it.disposition, /done by tick-doer in tick 1: item DEP is done/);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM claims").get().n, 0);
  const o = db.raw.prepare("SELECT agent, result, evidence FROM outcomes WHERE item_id='P1'").get();
  assert.deepEqual([o.agent, o.result], ['tick-doer', 'verified']);
  assert.equal(db.raw.prepare("SELECT status FROM dispatches WHERE item_id='P1'").get().status, 'done');
  assert.match(r.report, /executed: 1 done \(0 from parked\), 0 parked on a probe, 0 left for an executor/);
});

test('US-03-R24 and US-03-T11 (issue #173 execute): a failing probe parks the item with a reason, and it closes by itself when the probe passes', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,closing_probe,priority,status) VALUES ('E1','needs a setting','operations','setting present','env:SOME_SETTING',1,'ready'),
      ('S1','sql probe','operations','two ticks ran','SELECT COUNT(*) FROM tick_runs WHERE id >= 2',2,'ready');`);
  await runTick(db, { config, now: T0 });
  const e1 = db.raw.prepare("SELECT status, blocker, disposition FROM items WHERE id='E1'").get();
  assert.equal(e1.status, 'blocked');
  assert.match(e1.blocker, /^waiting on probe: env:SOME_SETTING \(setting SOME_SETTING is absent\)/);
  assert.match(e1.disposition, /parked by tick-doer/);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM claims").get().n, 0, 'a parked item holds no claim');
  // never re-dispatched while parked, never counted as released unworked
  await runTick(db, { config, now: T0 + 3 * 3600e3 });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM dispatches WHERE item_id='E1'").get().n, 1);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM outcomes WHERE result='unworked'").get().n, 0);
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='S1'").get().status, 'done', 'the SELECT probe passed on tick 2');
  const r = await runTick(db, { config, env: { SOME_SETTING: true }, now: T0 + 4 * 3600e3 });
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='E1'").get().status, 'done');
  assert.match(r.report, /\(1 from parked\)/);
});

test('US-03-R24 and US-03-T11 (issue #173 execute): an item with no machine-readable probe keeps its claim for an outside executor; a worked claim is not touched', async () => {
  const db = makeDb(); seed(db);
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,closing_probe,priority,status) VALUES ('W1','worked','operations','x','env:NOPE',1,'ready')`);
  const r = await runTick(db, { config: { ...config, execute_max_items: 0 }, now: T0 }); // nothing executed this tick: both stay claimed
  assert.match(r.report, /0 left for an executor/);
  db.raw.exec(`UPDATE claims SET heartbeat_at='2026-11-10 00:30:00' WHERE item_id='W1'`); // an executor is working it
  const r2 = await runTick(db, { config, now: T0 + 60e3 });
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='W1'").get().status, 'claimed');
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='A'").get().status, 'claimed');
  assert.match(r2.report, /0 parked on a probe, 2 left for an executor/); // A and B wait for an executor; W1 is being worked
});

test('US-03-R04 and US-03-R24 (issue #173 execute): a TICKFAIL item closes when a later tick completes the step, and an unreadable SELECT probe parks instead of throwing', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m');
    INSERT INTO items (id,title,kind,owner_role,done_check,priority,status,created_at) VALUES ('TICKFAIL-score_predictions-2026-11-09T23','failed','fix','operations','next tick completes step score_predictions',0,'ready','2026-11-09 23:00:00');
    INSERT INTO tick_runs (started_at, finished_at, steps_completed, steps_total, errors) VALUES ('2026-11-09 23:10:00','2026-11-09 23:10:00',7,8,'["score_predictions: boom"]'), ('2026-11-09 23:20:00','2026-11-09 23:20:00',8,8,NULL);
    INSERT INTO items (id,title,owner_role,done_check,closing_probe,priority,status) VALUES ('BADSQL','bad','operations','x','select n from no_such_table',1,'ready');`);
  const r = await runTick(db, { config: { ...config, max_wip_per_role: 5 }, now: T0 });
  assert.deepEqual(r.errors, []);
  const t = db.raw.prepare("SELECT status, disposition FROM items WHERE id LIKE 'TICKFAIL-%'").get();
  assert.equal(t.status, 'done'); assert.match(t.disposition, /tick 2 completed step score_predictions/);
  await runTick(db, { config, now: T0 + 60e3 });
  const b = db.raw.prepare("SELECT status, blocker FROM items WHERE id='BADSQL'").get();
  assert.equal(b.status, 'blocked'); assert.match(b.blocker, /probe could not run/);
});

// ---- US-SPEC-03 L1 requirements, each proved under its id ----
const q = (db, sql, ...a) => db.raw.prepare(sql).all(...a);
const q1 = (db, sql, ...a) => db.raw.prepare(sql).get(...a);

test('US-03-T01 and US-03-R05: a tick on a seeded store completes every step, with no error, and the stored report starts with Happened', async () => {
  const db = makeDb(); seed(db);
  const r = await runTick(db, { config, now: T0 });
  assert.equal(STEP_ORDER.length, 8);
  assert.deepEqual([r.completed, r.total, r.errors], [8, 8, []]);
  const row = q1(db, 'SELECT steps_completed, steps_total, errors, report, finished_at FROM tick_runs WHERE id = ?', r.tickId);
  assert.deepEqual([row.steps_completed, row.steps_total, row.errors], [8, 8, null]);
  assert.match(row.report, /^Happened:/); assert.ok(row.finished_at);
});

test('US-03-R01: one function runs the tick over any store handle: the node:sqlite test shim and the SQLite adapter produce the same tick_runs row', async () => {
  const migrations = fileURLToPath(new URL('../migrations/', import.meta.url));
  const shim = makeDb(); seed(shim);
  const adapter = openDb(':memory:', migrations); seed(adapter);
  const a = await runTick(shim, { config, now: T0 });
  const b = await runTick(adapter, { config, now: T0 });
  assert.deepEqual([a.completed, a.total, a.errors], [b.completed, b.total, b.errors]);
  assert.equal(a.report, b.report);
  assert.deepEqual(q1(shim, 'SELECT * FROM tick_runs'), q1(adapter, 'SELECT * FROM tick_runs'));
  assert.deepEqual(q(shim, 'SELECT item_id, agent FROM claims'), q(adapter, 'SELECT item_id, agent FROM claims'));
});

test('US-03-R02: the tick_runs row exists before the first step runs, unfinished, with the step count already set', async () => {
  const db = makeDb(); seed(db);
  let seen = null;
  const probe = { name: 'probe', run: async (d, ctx) => { seen = await d.prepare('SELECT id, finished_at, steps_total, steps_completed FROM tick_runs WHERE id = ?').bind(ctx.tickId).first(); } };
  const r = await runTick(db, { config, now: T0, extraSteps: [probe] });
  assert.equal(seen.id, r.tickId); assert.equal(seen.finished_at, null); assert.equal(seen.steps_total, STEP_ORDER.length + 1); assert.equal(seen.steps_completed, 0, 'the completed count is written when the tick ends');
  assert.ok(q1(db, 'SELECT finished_at FROM tick_runs WHERE id = ?', r.tickId).finished_at);
});

test('US-03-R03: after a step fails the later steps still run: dispatch still claims the top item', async () => {
  const db = makeDb(); seed(db);
  db.raw.exec('DROP TABLE predictions');
  const r = await runTick(db, { config, now: T0 });
  assert.equal(r.errors.length, 1); assert.match(r.errors[0], /^score_predictions:/);
  assert.deepEqual(q(db, 'SELECT item_id FROM claims').map(x => x.item_id), ['A']);
  assert.deepEqual(r.steps.filter(s => !s.ok).map(s => s.name), ['score_predictions']);
  assert.ok(r.steps.slice(r.steps.findIndex(s => s.name === 'score_predictions') + 1).every(s => s.ok === 1), 'every step after it completed');
});

test('US-03-R04: TICKFAIL-<step>-<hour> is filed once per hour, a new hour files a new one, and a store that refuses the filing does not stop the tick', async () => {
  const db = makeDb(); seed(db);
  db.raw.exec('DROP TABLE predictions');
  await runTick(db, { config, now: T0 });
  await runTick(db, { config, now: T0 + 600e3 });
  assert.deepEqual(q(db, "SELECT id FROM items WHERE id LIKE 'TICKFAIL-%'").map(x => x.id), ['TICKFAIL-score_predictions-2026-11-10T00']);
  await runTick(db, { config, now: T0 + 3600e3 });
  assert.deepEqual(q(db, "SELECT id FROM items WHERE id LIKE 'TICKFAIL-%' ORDER BY id").map(x => x.id), ['TICKFAIL-score_predictions-2026-11-10T00', 'TICKFAIL-score_predictions-2026-11-10T01']);
  const refusing = makeDb(); seed(refusing);
  refusing.raw.exec(`DROP TABLE predictions; CREATE TRIGGER store_refuses BEFORE INSERT ON items WHEN NEW.id LIKE 'TICKFAIL-%' BEGIN SELECT RAISE(ABORT, 'store refuses'); END;`);
  const r = await runTick(refusing, { config, now: T0 });
  assert.equal(r.completed, STEP_ORDER.length - 1); assert.equal(r.errors.length, 1);
  assert.equal(q1(refusing, "SELECT COUNT(*) AS n FROM items WHERE id LIKE 'TICKFAIL-%'").n, 0);
  assert.deepEqual(q(refusing, 'SELECT item_id FROM claims').map(x => x.item_id), ['A'], 'the later steps ran');
  assert.ok(q1(refusing, 'SELECT report, errors, finished_at FROM tick_runs').errors, 'the error is still in tick_runs');
});

test('US-03-R05: the report is four lines (Happened, Decided, Next, Open), stored as written, and the Open line carries the errors', async () => {
  const db = makeDb(); seed(db);
  db.raw.exec('DROP TABLE predictions');
  const r = await runTick(db, { config, now: T0 });
  const lines = r.report.split('\n');
  assert.equal(lines.length, 4);
  assert.deepEqual(lines.map(l => l.split(':')[0]), ['Happened', 'Decided', 'Next', 'Open']);
  assert.match(lines[3], /errors: score_predictions:/);
  assert.equal(q1(db, 'SELECT report FROM tick_runs').report, r.report);
});

test('US-03-R07: the order is fixed: reconcile before dispatch, score_predictions before accrue_trust, and extra steps run after the L1 steps', async () => {
  const at = n => STEP_ORDER.indexOf(n);
  assert.ok(at('reconcile') === 0 && at('reconcile') < at('dispatch') && at('score_predictions') < at('accrue_trust') && at('dispatch') < at('execute'));
  const db = makeDb(); seed(db);
  const order = [];
  const extra = ['x1', 'x2'].map(name => ({ name, run: async () => { order.push(name); } }));
  const r = await runTick(db, { config, now: T0, extraSteps: extra });
  assert.deepEqual(r.steps.map(s => s.name), [...STEP_ORDER, 'x1', 'x2']);
  assert.deepEqual(order, ['x1', 'x2']);
  assert.equal(r.total, STEP_ORDER.length + 2);
});

test('US-03-R08 and US-03-T05: a prediction naming an unknown metric, an unknown operator or an inherited property is scored miss with no observed value', async () => {
  const db = makeDb(); seed(db);
  db.raw.exec(`INSERT INTO predictions (id,metric,op,target,due_at) VALUES
    ('P1','no_such_metric','>=',0,'2026-11-09 00:00:00'), ('P2','items_done','~=',0,'2026-11-09 00:00:00'),
    ('P3','constructor','>=',0,'2026-11-09 00:00:00'), ('P4','toString','>=',0,'2026-11-09 00:00:00'), ('P5','items_done','constructor',0,'2026-11-09 00:00:00')`);
  await runTick(db, { config, now: T0 });
  const rows = q(db, 'SELECT id, verdict, observed FROM predictions ORDER BY id');
  assert.deepEqual(rows.map(r => [r.id, r.verdict, r.observed]), [['P1', 'miss', null], ['P2', 'miss', null], ['P3', 'miss', null], ['P4', 'miss', null], ['P5', 'miss', null]]);
});

test('US-03-R09: a role runs only on its tick_every, never beyond its work-in-progress cap, and an item that already has a claim is not dispatched again', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('slow-1','slow',2,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('S1','a','slow','x',1,'ready'), ('S2','b','slow','x',2,'ready')`);
  const cfg = { ...config, max_wip_per_role: 1 };
  await runTick(db, { config: cfg, now: T0 });                       // tick 1: 1 % 2 = 1, not due
  assert.equal(q1(db, 'SELECT COUNT(*) AS n FROM claims').n, 0);
  await runTick(db, { config: cfg, now: T0 + 600e3 });                // tick 2: due, claims S1
  assert.deepEqual(q(db, 'SELECT item_id FROM claims').map(x => x.item_id), ['S1']);
  await runTick(db, { config: cfg, now: T0 + 1200e3 }); await runTick(db, { config: cfg, now: T0 + 1800e3 }); // tick 4: due, but the role holds one claim and the cap is one
  assert.deepEqual(q(db, 'SELECT item_id FROM claims').map(x => x.item_id), ['S1']);
  const two = makeDb(); seed(two);
  two.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-2','staff',1,'m')`);
  await runTick(two, { config, now: T0 });                            // two role instances, two items: each takes a different one
  assert.deepEqual(q(two, "SELECT agent, item_id FROM claims ORDER BY agent").map(x => [x.agent, x.item_id]), [['staff-1', 'A'], ['staff-2', 'B']]);
  await runTick(two, { config, now: T0 + 600e3 });
  assert.equal(q1(two, "SELECT COUNT(*) AS n FROM dispatches WHERE item_id = 'A'").n, 1, 'a claimed item is not dispatched again');
});

test('US-03-R10: the tick never edits the policy: with a deeply frozen policy it completes, opens a LADDER item and leaves the policy and the rung as they were', async () => {
  const deep = o => { for (const v of Object.values(o)) if (v && typeof v === 'object') deep(v); return Object.freeze(o); };
  const frozen = deep(structuredClone(policy));
  const before = JSON.stringify(frozen);
  const db = makeDb(); seed(db);
  for (let i = 0; i < 12; i++) db.raw.exec("INSERT INTO outcomes (surface,action_class,result) VALUES ('repo','branch_commit_push','verified')");
  const r = await runTick(db, { config: { ...config, policy: frozen }, now: T0 });
  assert.deepEqual(r.errors, []);
  assert.ok(q(db, "SELECT id FROM items WHERE kind='ladder'").some(x => x.id.startsWith('LADDER-repo-branch_commit_push-autonomous')));
  assert.equal(JSON.stringify(frozen), before);
  assert.equal(q1(db, "SELECT rung FROM trust_ledger WHERE surface='repo'").rung, 'delegated');
});

test('US-03-T02: dropping predictions leaves seven steps complete and exactly one TICKFAIL-score_predictions item (priority 0, owner operations), also after a second tick', async () => {
  const db = makeDb(); seed(db);
  db.raw.exec('DROP TABLE predictions');
  const r1 = await runTick(db, { config, now: T0 });
  assert.equal(r1.completed, 7); assert.equal(r1.total, 8);
  const r2 = await runTick(db, { config, now: T0 + 600e3 });
  assert.equal(r2.completed, 7);
  const items = q(db, "SELECT id, priority, owner_role FROM items WHERE id LIKE 'TICKFAIL-score_predictions-%'");
  assert.equal(items.length, 1); assert.deepEqual([items[0].priority, items[0].owner_role], [0, 'operations']);
});

test('US-03-T03: with A ready, B open and C triggered by A, dispatch claims A only and C stays open', async () => {
  const db = makeDb(); seed(db);
  await runTick(db, { config, now: T0 });
  assert.deepEqual(q(db, 'SELECT item_id FROM claims').map(x => x.item_id), ['A']);
  assert.equal(q1(db, "SELECT status FROM items WHERE id='C'").status, 'open');
  assert.equal(q1(db, "SELECT status FROM items WHERE id='B'").status, 'ready', 'B became ready by reconcile and waits for the next dispatch');
});

// ---- US-03-R23 and US-00-R07: documented defaults for the limits ----
test('US-03-T13, US-03-R09 and US-03-R23: with a configuration that omits every limit a role is never given more than three claims and no step fails', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('w-1','w',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ${Array.from({ length: 6 }, (_, i) => `('W${i}','t','w','x',${i},'ready')`).join(',')}`);
  const bare = { policy };
  for (let i = 0; i < 6; i++) { const r = await runTick(db, { config: bare, now: T0 + i * 600e3 }); assert.deepEqual(r.errors, [], `tick ${i + 1}`); assert.equal(r.completed, r.total); }
  assert.equal(q1(db, "SELECT COUNT(*) AS n FROM claims WHERE agent='w-1'").n, DEFAULTS.max_wip_per_role);
  assert.equal(DEFAULTS.max_wip_per_role, 3);
});

test('US-03-T13, US-03-R03 and US-03-R23, US-00-R07: a claim older than the default 120 minutes is released with no TICKFAIL when claim_ttl_minutes is omitted', async () => {
  const db = makeDb(); seed(db);
  const bare = { policy };
  await runTick(db, { config: bare, now: T0 });
  assert.equal(q1(db, 'SELECT COUNT(*) AS n FROM claims').n, 1);
  const young = await runTick(db, { config: bare, now: T0 + 119 * 60e3 });
  assert.deepEqual(young.errors, []); assert.equal(q1(db, "SELECT COUNT(*) AS n FROM outcomes WHERE result='unworked'").n, 0, 'inside 120 minutes the claim stays');
  const old = await runTick(db, { config: bare, now: T0 + 3 * 3600e3 });
  assert.deepEqual(old.errors, []);
  assert.equal(q1(db, "SELECT COUNT(*) AS n FROM outcomes WHERE result='unworked' AND item_id='A'").n, 1, 'past 120 minutes the claim is released and recorded');
  assert.equal(q1(db, "SELECT COUNT(*) AS n FROM items WHERE id LIKE 'TICKFAIL-%'").n, 0);
  assert.equal(DEFAULTS.claim_ttl_minutes, 120);
});

test('US-00-R07 and US-03-R23: a configured value overrides the default, an undefined value does not, and the caller configuration object is not changed', () => {
  const given = Object.freeze({ claim_ttl_minutes: 5, max_wip_per_role: undefined, plus_share: 0, execute_max_items: 0, policy: { x: 1 } });
  const merged = withDefaults(given);
  assert.deepEqual([merged.claim_ttl_minutes, merged.max_wip_per_role, merged.plus_share, merged.execute_max_items], [5, 3, 0, 0]);
  assert.equal(merged.policy, given.policy, 'values the tick does not default pass through by reference');
  assert.deepEqual(Object.keys(given), ['claim_ttl_minutes', 'max_wip_per_role', 'plus_share', 'execute_max_items', 'policy'], 'the caller object was not changed');
  assert.deepEqual(withDefaults(undefined), { ...DEFAULTS });
  assert.ok(Object.isFrozen(DEFAULTS), 'the defaults cannot be edited at run time');
});

test('US-03-R23: an omitted plus_share still opens the rebalance item (the default 20 percent applies)', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('o-1','operations',1,'m')`);
  for (let i = 0; i < 12; i++) db.raw.exec(`INSERT INTO items (id,title,kind,owner_role,done_check,status,disposition) VALUES ('D${i}','d','fix','operations','x','done','shipped')`);
  await runTick(db, { config: { policy }, now: T0 });
  assert.ok(q1(db, "SELECT id FROM items WHERE id LIKE 'REBALANCE-%'"), 'zero plus items of twelve is under half the target');
});

// ---- US-03-R11: what each step reported is returned for the layer above to store ----
test('US-03-R11: the tick returns, for every step it ran, whether it completed and what it reported (its notes, or its error)', async () => {
  const db = makeDb(); seed(db);
  db.raw.exec('DROP TABLE predictions');
  const r = await runTick(db, { config, now: T0 });
  assert.deepEqual(r.steps.map(s => s.name), STEP_ORDER);
  const byName = Object.fromEntries(r.steps.map(s => [s.name, s]));
  assert.equal(byName.reconcile.ok, 1); assert.match(byName.reconcile.evidence, /^reconciled: 0 reopened, \d+ became ready$/);
  assert.equal(byName.dispatch.ok, 1); assert.match(byName.dispatch.evidence, /^dispatched \d+ item\(s\)$/);
  assert.equal(byName.score_predictions.ok, 0); assert.match(byName.score_predictions.evidence, /no such table: predictions/);
  assert.match(byName.probe_gates.evidence, /completed/);
});

test('US-08-R03: a ready item whose trigger item is not done is not dispatched; one whose trigger is done with its disposition is; a list or gate trigger the tick cannot judge goes back to open undispatched', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('A','a','staff','x',50,'open');
    INSERT INTO items (id,title,owner_role,done_check,priority,status,trigger_on) VALUES ('C','c','staff','x',10,'ready','A'), ('L','l','staff','x',20,'ready','A,B'), ('G','g','staff','x',30,'ready','gate:card-1');`);
  // C was made ready by hand while its trigger A is still open: it must not go first although it has the best priority
  await runTick(db, { config, now: T0 });
  const claimed = () => db.raw.prepare('SELECT item_id FROM claims ORDER BY item_id').all().map(x => x.item_id);
  assert.deepEqual(claimed(), ['A'], 'C waits for A; with no judge L and G are not known to be done, so the role takes the next ready item');
  assert.deepEqual(db.raw.prepare(`SELECT id, status FROM items WHERE id IN ('L','G') ORDER BY id`).all().map(r => `${r.id}:${r.status}`), ['G:open', 'L:open']);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM outcomes WHERE action_class='trigger_guard' AND item_id IN ('L','G')`).get().n, 2);
  // the trigger is reopened after it was done: still not dispatched
  db.raw.exec(`DELETE FROM claims; UPDATE items SET status='done', disposition='merged' WHERE id='A'; UPDATE items SET status='ready' WHERE id='L'`);
  db.raw.exec(`UPDATE items SET status='open' WHERE id='A'`);
  await runTick(db, { config, now: T0 + 60e3 });
  assert.ok(!claimed().includes('C'), 'a reopened trigger holds its dependent back');
  // the trigger done with a disposition releases it
  db.raw.exec(`DELETE FROM claims; UPDATE items SET status='ready' WHERE id='L'; UPDATE items SET status='done', disposition='merged' WHERE id='A'`);
  await runTick(db, { config, now: T0 + 120e3 });
  assert.deepEqual(claimed(), ['C']);
});

test('US-14-R11: a dispatcher that loses the race for a claim skips the item: one claim, one dispatch row, the item untouched', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('A','a','staff','x',10,'ready');`);
  const prepare = db.prepare.bind(db);
  // the other writer's row lands between this dispatcher's read and its insert
  db.prepare = sql => { if (/^INSERT OR IGNORE INTO claims/.test(sql)) db.raw.exec(`INSERT OR IGNORE INTO claims (item_id, agent, claimed_at, heartbeat_at) VALUES ('A', 'other-writer', '2026-11-10 00:00:00', '2026-11-10 00:00:00')`); return prepare(sql); };
  const r = await runTick(db, { config, now: T0 });
  assert.deepEqual(r.errors, [], 'no unique violation fails the step');
  assert.deepEqual(db.raw.prepare('SELECT item_id, agent FROM claims').all().map(x => [x.item_id, x.agent]), [['A', 'other-writer']]);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM dispatches').get().n, 0, 'no dispatch row for a claim this dispatcher does not hold');
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='A'").get().status, 'ready', 'the item is not changed by the dispatcher that lost');
});

test('US-03-R17: steps_total is the length of the declared list, extra steps included, and an extra step is guarded like a core step: it files its own TICKFAIL item and the steps after it run', async () => {
  const db = makeDb(); seed(db);
  const ran = [];
  const extra = [
    { name: 'x_breaks', run: async () => { throw new Error('extra step broke'); } },
    { name: 'x_after', run: async () => { ran.push('x_after'); } },
  ];
  const r = await runTick(db, { config, now: T0, extraSteps: extra });
  assert.equal(r.total, STEP_ORDER.length + extra.length, 'the declared list is the core steps and the extra steps');
  assert.equal(r.completed, r.total - 1, 'only the step that threw is not complete');
  assert.deepEqual(ran, ['x_after'], 'the step after the failing one still ran');
  const row = q1(db, 'SELECT steps_total, steps_completed FROM tick_runs');
  assert.equal(row.steps_total, STEP_ORDER.length + extra.length); assert.equal(row.steps_completed, r.total - 1);
  const fail = q1(db, "SELECT id, priority, owner_role FROM items WHERE id LIKE 'TICKFAIL-x_breaks-%'");
  assert.equal(fail.id, 'TICKFAIL-x_breaks-2026-11-10T00'); assert.equal(fail.priority, 0); assert.equal(fail.owner_role, 'operations');
  await runTick(db, { config, now: T0 + 600e3, extraSteps: extra });
  assert.equal(q1(db, "SELECT COUNT(*) AS n FROM items WHERE id LIKE 'TICKFAIL-x_breaks-%'").n, 1, 'deduplicated by identifier within the hour');
});

test('US-08-R03: with a trigger judge the tick dispatches a list or gate trigger that is done and holds back one that is not', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status,disposition) VALUES ('A','a','staff','x',50,'done','merged'), ('B','b','staff','x',50,'open',NULL);
    INSERT INTO items (id,title,owner_role,done_check,priority,status,trigger_on) VALUES ('L1','l','staff','x',10,'ready','A,B'), ('L2','l','staff','x',20,'ready','A, gate:G1');
    INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe, status) VALUES ('G1','w','y','d','manual','closed');`);
  const seen = [];
  const triggerJudge = async spec => { seen.push(spec); const toks = spec.split(',').map(t => t.trim());
    const done = toks.every(t => t.startsWith('gate:') ? db.raw.prepare(`SELECT status FROM gate_cards WHERE id=?`).get(t.slice(5))?.status === 'closed' : db.raw.prepare(`SELECT status FROM items WHERE id=?`).get(t)?.status === 'done');
    return { done, waiting_on: done ? [] : toks, reasons: {} }; };
  await runTick(db, { config, now: T0, triggerJudge });
  assert.deepEqual(db.raw.prepare('SELECT item_id FROM claims').all().map(x => x.item_id), ['L2'], 'L1 waits on B; L2 has its item done and its card closed');
  assert.deepEqual(seen, ['A,B', 'A, gate:G1']);
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id='L1'`).get().status, 'open');
});
