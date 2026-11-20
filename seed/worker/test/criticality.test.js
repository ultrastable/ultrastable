import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick } from '../src/tick.js';
import { computeKEff, readCriticality, addSample, deriveIgnitionGaps } from '../src/criticality.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const crit = JSON.parse(readFileSync(new URL('../../autonomy/criticality.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy, criticality: crit };
const T0 = Date.parse('2026-11-10T00:00:00Z'); // frozen: no wall-clock reads anywhere in these tests
const cur = (o = {}) => ({ deploys: 0, fail: 0, spend: 0, human: 0, originated: 0, ...o });

test('k_eff is credited work over spend plus human touches, with a denominator floor', () => {
  assert.equal(computeKEff(cur({ deploys: 6, originated: 2, spend: 6, human: 2 }), null, crit).k_eff, 1);
  assert.equal(computeKEff(cur({ deploys: 3 }), null, crit).k_eff, 3); // floor 1, not divide by zero
});

test('guard: a deploy rise while spend worsens is not credited', () => {
  const prev = cur({ deploys: 10, spend: 100 });
  const r = computeKEff(cur({ deploys: 40, spend: 200 }), prev, crit);
  assert.equal(r.guard.tripped, true);
  assert.equal(r.credited_deploys, 10);
});

test('guard: a deploy rise while the failure rate worsens is not credited', () => {
  const prev = cur({ deploys: 10, fail: 0, spend: 10 });
  const r = computeKEff(cur({ deploys: 20, fail: 10, spend: 10 }), prev, crit);
  assert.equal(r.guard.fail_worse, true);
  assert.equal(r.credited_deploys, 10);
});

test('guard: a rise with cost and failures steady is credited in full', () => {
  const r = computeKEff(cur({ deploys: 20, spend: 10 }), cur({ deploys: 10, spend: 10 }), crit);
  assert.equal(r.guard.tripped, false);
  assert.equal(r.credited_deploys, 20);
});

test('originated credit is capped so filing noise cannot inflate k_eff', () => {
  const r = computeKEff(cur({ originated: 500, spend: 10 }), null, crit);
  assert.equal(r.originated_credited, crit.originated.credit_cap);
});

test('an empty queue cannot end the tick idle: it originates an item at the head and files the idle repair', async () => {
  const db = makeDb();
  const r = await runTick(db, { config, now: T0 });
  const head = db.raw.prepare("SELECT id, priority FROM items WHERE id LIKE 'ORIGIN-%'").get();
  assert.ok(head, 'an originated item exists');
  assert.equal(head.priority, crit.origination.head_priority);
  assert.ok(db.raw.prepare("SELECT 1 FROM items WHERE id LIKE 'IDLE-%'").get(), 'idle tick filed its own repair');
  assert.ok(r.errors.some(e => e.startsWith('idle_tick')));
  const c = await readCriticality(db);
  assert.ok(c.reasons.includes('queue_empty') && c.reasons.includes('idle_tick'));
});

test('origination picks cost_cut first when spend is over budget, flaky_deploy when failures are over the ceiling', async () => {
  const db = makeDb();
  await addSample(db, { source: 'cost-probe', spend_units: crit.origination.spend_budget_units + 1 }, '2026-11-09 00:00:00');
  await runTick(db, { config, now: T0 });
  assert.ok(db.raw.prepare("SELECT 1 FROM items WHERE id LIKE 'ORIGIN-cost_cut-2026-11-10%'").get());
  const db2 = makeDb();
  await addSample(db2, { source: 'github-runs', deploys_ok: 5, deploys_fail: 5 }, '2026-11-09 00:00:00');
  await runTick(db2, { config, now: T0 });
  assert.ok(db2.raw.prepare("SELECT 1 FROM items WHERE id LIKE 'ORIGIN-flaky_deploy-2026-11-10%'").get());
});

test('an unowned backlog item (owner role with no doer row) gets a doer item', async () => {
  const db = makeDb();
  db.raw.exec("INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('workers-173','x','nobody','x','open')");
  await runTick(db, { config, now: T0 });
  assert.ok(db.raw.prepare("SELECT 1 FROM items WHERE id LIKE 'ORIGIN-unowned_backlog-2026-11-10%'").get());
});

test('while a spend cap is breached only the cost cut is originated', async () => {
  const db = makeDb();
  await addSample(db, { source: 'cost-probe', spend_units: 1, cap_breached: 1 }, '2026-11-09 00:00:00');
  await runTick(db, { config, now: T0 });
  const ids = db.raw.prepare("SELECT id FROM items WHERE id LIKE 'ORIGIN-%'").all().map(x => x.id);
  assert.deepEqual(ids, ['ORIGIN-cost_cut-2026-11-10-t1']);
});

test('a healthy tick with queued work and k_eff over the minimum originates nothing', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('A','a','operations','x',10,'open'), ('B','b','operations','x',20,'open');`);
  await addSample(db, { source: 'github-runs', deploys_ok: 50, spend_units: 10 }, '2026-11-09 00:00:00');
  await runTick(db, { config, now: T0 });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'ORIGIN-%'").get().n, 0);
  const c = await readCriticality(db);
  assert.ok(c.k_eff >= crit.k_min && !c.idle);
});

test('only probe-verified deploy outcomes count: a loop that verifies its own deploy earns nothing', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO outcomes (surface,action_class,result,evidence,at) VALUES
    ('deploy','deploy','verified','self-reported ok','2026-11-09 00:00:00'),
    ('deploy','deploy','verified','probe:live-sha-match','2026-11-09 00:00:00')`);
  await runTick(db, { config, now: T0 });
  assert.equal((await readCriticality(db)).raw_deploys, 1);
});

// IGNITION: something from nothing. An empty database, a stub doer that closes whatever it is handed, 30 frozen ticks.
test('ignition from nothing: the queue never empties, every closed item emits a successor, and the reaction does not run away', async () => {
  const db = makeDb();
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m'), ('pm-1','portfolio-manager',1,'m')");
  let t = T0, maxQueue = 0;
  for (let i = 0; i < 30; i++, t += 600e3) {
    await runTick(db, { config, now: t });
    const live = db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE status IN ('open','ready','claimed')").get().n;
    assert.ok(live > 0, `queue empty at the end of tick ${i}`); // the invariant is checked at tick end, before the doer runs
    // stub doer: closes every claimed item with a disposition and a probe-verified deploy outcome
    for (const c of db.raw.prepare('SELECT item_id FROM claims').all()) {
      db.raw.prepare("UPDATE items SET status='done', disposition='fixed: stub', updated_at=? WHERE id=?").run(new Date(t).toISOString().replace('T', ' ').slice(0, 19), c.item_id);
      db.raw.prepare("INSERT INTO outcomes (item_id,surface,action_class,result,evidence,at) VALUES (?,?,?,?,?,?)").run(c.item_id, 'deploy', 'deploy', 'verified', 'probe:stub', new Date(t).toISOString().replace('T', ' ').slice(0, 19));
      db.raw.prepare('DELETE FROM claims WHERE item_id=?').run(c.item_id);
    }
    maxQueue = Math.max(maxQueue, live);
  }
  assert.ok(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'NEXT-%'").get().n > 0, 'successors were emitted');
  assert.ok(db.raw.prepare("SELECT COUNT(*) AS n FROM outcomes WHERE result='verified'").get().n >= 20, 'work kept completing');
  assert.ok(maxQueue < 60, `bounded queue, saw ${maxQueue}`);
});

test('control rod: above k_max no successors are emitted', async () => {
  const db = makeDb();
  db.raw.exec("INSERT INTO items (id,title,owner_role,done_check,status,disposition) VALUES ('X','x','operations','x','done','fixed')");
  await addSample(db, { source: 'github-runs', deploys_ok: 500, spend_units: 1 }, '2026-11-09 00:00:00');
  await runTick(db, { config, now: T0 });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id='NEXT-X'").get().n, 0);
});

test('Q-CRIT-IGNITION: open chain links are rows, open_ignition_gaps sits next to k_eff, self-sustaining only at 0', async () => {
  const db = makeDb();
  db.raw.exec("INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G1','pay','identity-bound','dry run','manual')");
  await addSample(db, { source: 'sauce', ignition_gaps: [{ link: 'family Q-X grows and nothing closes it', owner: 'operations', closing_probe: 'throughput --doer Q-X' }] }, '2026-11-09 00:00:00');
  await runTick(db, { config, now: T0 });
  const c = await readCriticality(db);
  assert.deepEqual(c.ignition_gaps.map(g => g.link).sort(), ['family Q-X grows and nothing closes it', 'gate:G1', 'items:unowned'].sort(), 'tick-derived links (owner card, items whose role does not exist in an empty org) plus the collector link');
  assert.equal(c.open_ignition_gaps, 3);
  assert.equal(c.self_sustaining, false);
  assert.ok(c.ignition_gaps.some(g => g.link === 'gate:G1' && g.source === 'tick'));
  db.raw.exec("UPDATE gate_cards SET status='closed' WHERE id='G1'");
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) SELECT DISTINCT owner_role, owner_role, 1, 'm' FROM items WHERE owner_role NOT IN (SELECT role FROM roles)");
  await addSample(db, { source: 'sauce', ignition_gaps: [] }, '2026-11-09 01:00:00');
  const r = await deriveIgnitionGaps(db, '2026-11-10 01:00:00');
  assert.equal(r.open_ignition_gaps, 0);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM ignition_gaps WHERE status='closed' AND closed_at IS NOT NULL").get().n, 3, 'a closed link is kept with its time, never deleted');
});

test('SELF-REFERENCE-1: an outside-origin deploy raises k_eff but not k_self; the regime says which source keeps it critical', () => {
  const outside = computeKEff(cur({ deploys: 4, self: 0, spend: 2 }), null, crit);
  assert.equal(outside.k_eff, 2); assert.equal(outside.k_self, 0); assert.equal(outside.self_regime, 'driven');
  const own = computeKEff(cur({ deploys: 4, self: 3, spend: 2 }), null, crit);
  assert.equal(own.k_eff, 2); assert.equal(own.k_self, 1.5); assert.equal(own.self_regime, 'self-sustaining');
  assert.equal(computeKEff(cur({ deploys: 1, self: 1, spend: 4 }), null, crit).self_regime, 'subcritical');
  // a guard that withholds credit for a deploy rise also caps the self count: k_self never exceeds k_eff
  const guarded = computeKEff(cur({ deploys: 40, self: 40, spend: 200 }), cur({ deploys: 10, spend: 10 }), crit);
  assert.ok(guarded.guard.tripped); assert.ok(guarded.k_self <= guarded.k_eff);
});
