// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-26 (ignition ladder): each test is named by the requirement it proves. The clock is frozen and the database is in memory.
// Each call of ignitionStep stands for one tick's reading; `now` stays inside one 10-minute slot unless a test says otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { ensureItem } from '../src/tick.js';
import { judge, ignitionStep, readIgnition, STAGES, DEFAULTS, BOOTSTRAPPED_AT, REQUIRED_TABLES } from '../src/ignition.js';

const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const NOW = Date.parse('2026-11-10T01:05:30Z'), W = 600e3, CUR = Math.floor(NOW / W);
const PULSE = { every_min: 10, not_ticking: [], warming: 0, coverage_24h: 0.99, missed_24h: 0, ticking: 5, loops: 5, watchdog: true };
const CRIT = { k_eff: 1.4, k_min: 1, open_ignition_gaps: 0, human_touches: 0, credited_deploys: 3, originated_credited: 0, spend_units: 2 };

// A database with one role and `n` complete ticks in the n slots before NOW's slot, oldest inserted first (the reading counts newest first).
function world({ ticks = 8, skip = [], role = true } = {}) {
  const db = makeDb();
  if (role) db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m')");
  for (let k = ticks; k >= 1; k--) {
    if (skip.includes(k)) continue;
    const at = iso((CUR - k) * W + 30e3);
    db.raw.prepare('INSERT INTO tick_runs (started_at, finished_at, steps_completed, steps_total) VALUES (?,?,19,19)').run(at, at);
  }
  return db;
}
const step = (db, over = {}, now = NOW) => ignitionStep(db, { db, now, nowIso: iso(now), tickId: 9999, config: {}, notes: [], errors: [], pulse: PULSE, criticality: null, ...over }, ensureItem);
const verifiedDone = (db, id = 'W-1', at = iso(NOW - 3600e3)) => {
  db.raw.prepare("INSERT INTO items (id, title, owner_role, done_check, status, disposition) VALUES (?, 't', 'operations', 'd', 'done', 'fixed')").run(id);
  db.raw.prepare("INSERT INTO outcomes (item_id, surface, action_class, result, evidence, at) VALUES (?, 'repo', 'merge', 'verified', 'probe:x', ?)").run(id, at);
};
const instrument = db => {
  db.raw.exec("INSERT INTO objectives (id, statement, owner_role) VALUES ('OBJ-1','s','operations')");
  db.raw.exec("INSERT INTO metrics (id, objective_id, name, kind, source, spec, op, threshold, owner_role, remedy) VALUES ('M-1','OBJ-1','m','target','builtin','items_done','>=',0,'operations','r')");
};
const ev = (o = {}) => ({ missing_tables: [], roles: 3, tick_streak: 10, tick_missed_1h: 0, closed_verified: 2, silent_drops: 0, metrics: 6, declared_metrics: 0, objectives_without_probe: 0,
  dispatches: 10, dispatch_verified: 8, k_streak: 0, pulse: { ...PULSE }, criticality: { ...CRIT, k_eff: 0.2 }, ...o });

test('US-26-R01: eight stages in fixed order, computed from the tables; a snapshot that declares a higher stage changes nothing', async () => {
  assert.deepEqual(STAGES, ['unseeded', 'seeded', 'ticking', 'looping', 'closing', 'instrumented', 'critical', 'self-sustaining']);
  assert.equal(BOOTSTRAPPED_AT, 'instrumented');
  const db = world({ ticks: 0 });
  db.raw.prepare("INSERT INTO org (key, value) VALUES ('ignition', ?)").run(JSON.stringify({ stage: 'self-sustaining', since: '2026-11-01 00:00:00', k_streak: 0 }));
  const snap = await step(db);
  assert.equal(snap.stage, 'seeded', 'the stored claim is not an input: the evidence says seeded');
  assert.equal((await readIgnition(db)).log[0].direction, 'down');
  for (const e of [ev(), ev({ tick_streak: 0 }), ev({ roles: 0 })]) assert.ok(STAGES.includes(judge(e).stage));
});

test('US-26-R02: the stage is the highest whose condition and every one below it hold; the first unmet one is the block', () => {
  const full = judge(ev({ k_streak: 144, criticality: { ...CRIT } }));
  assert.equal(full.stage, 'self-sustaining'); assert.equal(full.blocking, null);
  const j = judge(ev({ k_streak: 200, tick_streak: 0 }));  // every higher condition holds, ticking does not
  assert.equal(j.stage, 'seeded'); assert.equal(j.blocking.stage, 'ticking');
  assert.match(j.blocking.why, /0 complete tick\(s\) in a row \(need 6\)/);
  assert.equal(j.holds.closing.ok, true, 'a higher condition may hold on its own and still not count');
  assert.equal(judge(ev({ roles: 0 })).stage, 'unseeded');
});

test('US-26-R03: seeded needs every required table and at least one role; the reason names what is missing', async () => {
  assert.ok(REQUIRED_TABLES.includes('ignition_log') && REQUIRED_TABLES.includes('trust_ledger') && REQUIRED_TABLES.includes('criticality_samples'));
  const j = judge(ev({ missing_tables: ['trust_ledger'] }));
  assert.equal(j.stage, 'unseeded'); assert.match(j.blocking.why, /missing tables: trust_ledger/);
  assert.match(judge(ev({ roles: 0 })).blocking.why, /0 role\(s\), schema complete/);
  const db = world(); db.raw.exec('DROP TABLE trust_ledger');
  const s = await step(db);
  assert.equal(s.stage, 'unseeded'); assert.match(s.blocking.why, /trust_ledger/);
});

test('US-26-R04: ticking needs six complete ticks in a row and no missed slot in the last hour', async () => {
  assert.equal(DEFAULTS.ticking.min_streak, 6);
  const six = await step(world({ ticks: 6 }));
  assert.equal(six.holds.ticking.ok, true, six.holds.ticking.why); assert.equal(six.tick_streak, 6);
  assert.equal((await step(world({ ticks: 6 }), { pulse: null })).stage, 'ticking', 'six complete ticks reach ticking; looping needs the pulse reading');
  const five = await step(world({ ticks: 5 }));
  assert.equal(five.stage, 'seeded'); assert.match(five.blocking.why, /5 complete tick\(s\) in a row \(need 6\), 0 slot\(s\) missed/);
  const gap = await step(world({ ticks: 8, skip: [3] }));
  assert.equal(gap.stage, 'seeded'); assert.match(gap.blocking.why, /1 slot\(s\) missed in the last hour/);
  const db = world({ ticks: 8 });  // an unfinished newest tick ends the streak
  db.raw.exec('UPDATE tick_runs SET steps_completed = 18 WHERE id = (SELECT MAX(id) FROM tick_runs)');
  const cut = await step(db);
  assert.equal(cut.stage, 'seeded'); assert.match(cut.blocking.why, /0 complete tick\(s\) in a row/);
});

test('US-26-R05: looping needs a pulse reading with every loop ticking, coverage at least 0.95 and a watching second producer', () => {
  const at = o => judge(ev(o));
  assert.equal(at({}).stage, 'instrumented', 'the baseline holds through looping');
  assert.match(at({ pulse: null }).blocking.why, /no pulse reading: loop execution is unmeasured/);
  assert.equal(at({ pulse: null }).blocking.stage, 'looping');
  assert.match(at({ pulse: { ...PULSE, not_ticking: [{ loop: 'lane', state: 'failing' }] } }).blocking.why, /not ticking: lane \(failing\)/);
  assert.match(at({ pulse: { ...PULSE, warming: 2 } }).blocking.why, /2 declared loop\(s\) have no recorded run yet/);
  assert.equal(at({ pulse: { ...PULSE, coverage_24h: 0.94 } }).blocking.stage, 'looping');
  assert.equal(at({ pulse: { ...PULSE, coverage_24h: 0.95 } }).holds.looping.ok, true, 'the threshold itself is met');
  assert.equal(at({ pulse: { ...PULSE, coverage_24h: null } }).blocking.stage, 'looping', 'unmeasured coverage is unmet, never met');
  const dog = at({ pulse: { ...PULSE, watchdog: false } });
  assert.equal(dog.stage, 'ticking'); assert.match(dog.blocking.why, /no second producer is watching the tick/);
  const t = { ...DEFAULTS, looping: { ...DEFAULTS.looping, require_watchdog: false } };
  assert.notEqual(judge(ev({ pulse: { ...PULSE, watchdog: false } }), t).stage, 'ticking');
});

test('US-26-R06: closing needs a verified closed item in seven days and no silent drop; an old outcome does not count', async () => {
  const db = world(); assert.equal((await step(db)).blocking.stage, 'closing');
  verifiedDone(db, 'OLD', iso(NOW - 8 * 86400e3));
  const old = await step(db);
  assert.equal(old.stage, 'looping'); assert.match(old.blocking.why, /0 item\(s\) closed with a verified outcome in 7 d \(need 1\), 0 silent drop/);
  verifiedDone(db, 'W-1');
  assert.equal((await step(db)).blocking.stage, 'instrumented', 'closing now holds and the next stage blocks');
  db.raw.prepare("INSERT INTO outcomes (item_id, surface, action_class, result, evidence, at) VALUES ('X','repo','merge','silent_drop','gone', ?)").run(iso(NOW - 3600e3));
  const drop = await step(db);
  assert.equal(drop.stage, 'looping'); assert.match(drop.blocking.why, /1 silent drop\(s\)/);
  // a verified outcome on an item that is not done is not a closure
  const open = world(); open.raw.exec("INSERT INTO items (id, title, owner_role, done_check, status) VALUES ('P','t','operations','d','ready')");
  open.raw.prepare("INSERT INTO outcomes (item_id, surface, action_class, result, evidence, at) VALUES ('P','repo','merge','verified','probe:x', ?)").run(iso(NOW - 3600e3));
  assert.equal((await step(open)).stage, 'looping');
});

test('US-26-R07: instrumented needs a metric, a probe-backed target for every objective and no metric that is only declared', async () => {
  const db = world(); verifiedDone(db);
  assert.match((await step(db)).blocking.why, /0 metric\(s\), 0 objective\(s\) without a probe, 0 metric\(s\) only declared/);
  db.raw.exec("INSERT INTO objectives (id, statement, owner_role) VALUES ('OBJ-1','s','operations')");
  db.raw.exec("INSERT INTO metrics (id, name, kind, source, spec, op, threshold, owner_role, remedy) VALUES ('M-live','l','liveness','builtin','items_done','>=',0,'operations','r')");
  const noTarget = await step(db);
  assert.equal(noTarget.stage, 'closing'); assert.match(noTarget.blocking.why, /1 metric\(s\), 1 objective\(s\) without a probe/);
  db.raw.exec("INSERT INTO metrics (id, objective_id, name, kind, source, spec, op, threshold, owner_role, remedy) VALUES ('M-t','OBJ-1','t','target','builtin','items_done','>=',0,'operations','r')");
  const ok = await step(db);
  assert.equal(ok.stage, 'instrumented'); assert.equal(ok.bootstrapped, true);
  db.raw.exec("INSERT INTO metrics (id, name, kind, source, spec, op, threshold, owner_role, remedy) VALUES ('M-d','d','target','declared','later','>=',0,'operations','r')");
  const declared = await step(db);
  assert.equal(declared.stage, 'closing'); assert.match(declared.blocking.why, /1 metric\(s\) only declared/);
});

test('US-26-R08: critical needs k_eff at or over k_min for six readings in a row, kept in the stored snapshot; one miss or an unmeasured k resets it', async () => {
  const db = world(); verifiedDone(db); instrument(db);
  let s;
  for (let i = 1; i <= 5; i++) { s = await step(db, { criticality: CRIT }); assert.equal(s.stage, 'instrumented'); assert.equal(s.k_streak, i); }
  s = await step(db, { criticality: CRIT });
  assert.equal(s.stage, 'critical'); assert.equal(s.k_streak, 6); assert.equal(s.critical, true);
  s = await step(db, { criticality: { ...CRIT, k_eff: 0.4 } });
  assert.equal(s.k_streak, 0); assert.equal(s.stage, 'instrumented');
  assert.match(s.blocking.why, /k_eff 0\.4 against k_min 1 for 0 tick\(s\) in a row \(need 6\)/);
  await step(db, { criticality: CRIT });
  s = await step(db, { criticality: null });
  assert.equal(s.k_streak, 0); assert.match(s.blocking.why, /k_eff is unmeasured/);
  assert.equal(DEFAULTS.critical.min_streak, 6);
});

test('US-26-R09: self-sustaining needs 144 critical readings, zero open ignition gaps and a measured zero human touches', async () => {
  const seed = db => db.raw.prepare("INSERT INTO org (key, value) VALUES ('ignition', ?)").run(JSON.stringify({ stage: 'critical', since: '2026-11-09 00:00:00', k_streak: 143 }));
  const build = () => { const db = world(); verifiedDone(db); instrument(db); seed(db); return db; };
  assert.equal(DEFAULTS.sustained_ticks, 144);
  const ok = await step(build(), { criticality: CRIT });
  assert.equal(ok.stage, 'self-sustaining'); assert.equal(ok.blocking, null);
  const gap = await step(build(), { criticality: { ...CRIT, open_ignition_gaps: 1 } });
  assert.equal(gap.stage, 'critical'); assert.match(gap.blocking.why, /critical for 144 tick\(s\) \(need 144\), 1 open ignition gap\(s\), 0 human touch/);
  const touched = await step(build(), { criticality: { ...CRIT, human_touches: 2 } });
  assert.equal(touched.stage, 'critical');
  const { human_touches, ...unmeasured } = CRIT;
  const un = await step(build(), { criticality: unmeasured });
  assert.equal(un.stage, 'critical'); assert.match(un.blocking.why, /unmeasured human touch/, 'an unmeasured touch count is not zero');
  const early = world(); verifiedDone(early); instrument(early);
  early.raw.prepare("INSERT INTO org (key, value) VALUES ('ignition', ?)").run(JSON.stringify({ stage: 'critical', k_streak: 142 }));
  assert.equal((await step(early, { criticality: CRIT })).stage, 'critical', '143 readings are not enough');
});

test('US-26-R10: bootstrapped means instrumented or above; the since-stamps hold while the property holds and clear when it stops', async () => {
  const db = world(); verifiedDone(db); instrument(db);
  const a = await step(db, { criticality: CRIT }, NOW);
  assert.equal(a.bootstrapped, true); assert.equal(a.critical, false);
  assert.equal(a.bootstrapped_since, iso(NOW)); assert.equal(a.critical_since, null);
  const b = await step(db, { criticality: CRIT }, NOW + 60e3);
  assert.equal(b.bootstrapped_since, iso(NOW), 'unbroken run keeps its first time');
  assert.equal(b.since, iso(NOW), 'since is the time of the last change of stage');
  for (let i = 0; i < 3; i++) await step(db, { criticality: CRIT }, NOW + 120e3);
  const c = await step(db, { criticality: CRIT }, NOW + 180e3);  // the sixth reading in a row
  assert.equal(c.critical, true); assert.equal(c.critical_since, iso(NOW + 180e3)); assert.equal(c.since, iso(NOW + 180e3));
  db.raw.exec("INSERT INTO metrics (id, name, kind, source, spec, op, threshold, owner_role, remedy) VALUES ('M-d','d','target','declared','later','>=',0,'operations','r')");
  const d = await step(db, { criticality: CRIT }, NOW + 240e3);
  assert.equal(d.bootstrapped, false); assert.equal(d.bootstrapped_since, null); assert.equal(d.critical_since, null);
});

test('US-26-R11: every change of stage appends one log row with its evidence, a fall also records a failed outcome, no change appends none', async () => {
  const db = world(); verifiedDone(db); instrument(db);
  await step(db, { criticality: CRIT });
  let log = db.raw.prepare('SELECT * FROM ignition_log ORDER BY id').all();
  assert.equal(log.length, 1); assert.equal(log[0].direction, 'first'); assert.equal(log[0].prev, null); assert.equal(log[0].stage, 'instrumented');
  const evidence = JSON.parse(log[0].evidence);
  assert.ok(evidence.holds && evidence.holds.seeded === true && evidence.holds.critical === false); assert.equal(evidence.k_eff, 1.4);
  assert.ok(log[0].evidence.length <= 2000);
  await step(db, { criticality: CRIT });
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM ignition_log').get().n, 1, 'no change, no row');
  db.raw.exec("INSERT INTO metrics (id, name, kind, source, spec, op, threshold, owner_role, remedy) VALUES ('M-d','d','target','declared','later','>=',0,'operations','r')");
  await step(db, { criticality: CRIT });
  log = db.raw.prepare('SELECT * FROM ignition_log ORDER BY id').all();
  assert.deepEqual(log.map(r => r.direction), ['first', 'down']); assert.equal(log[1].prev, 'instrumented');
  const fall = db.raw.prepare("SELECT * FROM outcomes WHERE item_id = 'IGNITE-instrumented' AND result = 'failed'").get();
  assert.equal(fall.surface, 'ignition'); assert.match(fall.evidence, /stage fell from instrumented to closing/);
  db.raw.exec("DELETE FROM metrics WHERE source = 'declared'");
  await step(db, { criticality: CRIT });
  assert.equal(db.raw.prepare('SELECT direction FROM ignition_log ORDER BY id DESC LIMIT 1').get().direction, 'up');
});
test('US-26-R12: IGNITE-<stage> is open for the first unmet stage with the numbers that block it, closed by the same reading, reopened when the stage is lost', async () => {
  const db = world();
  await step(db, { pulse: null });
  const it = db.raw.prepare("SELECT * FROM items WHERE id = 'IGNITE-looping'").get();
  assert.equal(it.kind, 'fix'); assert.equal(it.priority, -1); assert.equal(it.status, 'ready'); assert.equal(it.owner_role, 'operations');
  assert.equal(it.done_check, 'org.ignition.stage is looping or above'); assert.equal(it.closing_probe, 'ignition:looping');
  assert.match(it.title, /^Reach stage looping: no pulse reading: loop execution is unmeasured/);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM items WHERE id LIKE 'IGNITE-%'").get().n, 1, 'only the first unmet stage is filed');
  db.raw.prepare("INSERT INTO claims (item_id, agent) VALUES ('IGNITE-looping', 'op-1')").run();
  await step(db);  // the pulse reading is back: looping holds, closing blocks
  const done = db.raw.prepare("SELECT status, disposition FROM items WHERE id = 'IGNITE-looping'").get();
  assert.equal(done.status, 'done'); assert.equal(done.disposition, 'probe green: ignition:looping holds');
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM claims WHERE item_id = 'IGNITE-looping'").get().n, 0);
  const out = db.raw.prepare("SELECT surface, action_class, result, evidence FROM outcomes WHERE item_id = 'IGNITE-looping'").get();
  assert.deepEqual([out.surface, out.action_class, out.result], ['ignition', 'probe', 'verified']); assert.match(out.evidence, /^probe:ignition:looping holds at /);
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id = 'IGNITE-closing'").get().status, 'ready');
  await step(db, { pulse: null });
  const again = db.raw.prepare("SELECT status, disposition FROM items WHERE id = 'IGNITE-looping'").get();
  assert.equal(again.status, 'ready'); assert.equal(again.disposition, null, 'a closed item whose stage is blocked again is reopened, not duplicated');
});

test('US-26-R13: the snapshot is stored under org key ignition every tick and read back with the newest 20 log rows', async () => {
  const db = world();
  const snap = await step(db);
  const stored = JSON.parse(db.raw.prepare("SELECT value FROM org WHERE key = 'ignition'").get().value);
  for (const k of ['stage', 'since', 'at', 'bootstrapped', 'bootstrapped_since', 'critical', 'critical_since', 'k_streak', 'tick_streak', 'blocking', 'holds']) assert.ok(k in stored, k);
  assert.deepEqual(Object.keys(stored.holds), ['seeded', 'ticking', 'looping', 'closing', 'instrumented', 'critical', 'self-sustaining']);
  assert.ok(stored.holds.seeded.ok === true && typeof stored.holds.seeded.why === 'string');
  assert.equal(stored.at, iso(NOW)); assert.equal(snap.stage, stored.stage);
  for (let i = 0; i < 25; i++) db.raw.prepare("INSERT INTO ignition_log (at, stage, prev, direction, evidence) VALUES (?, 'seeded', 'ticking', 'down', '{}')").run(`2026-11-10 02:00:${String(i).padStart(2, '0')}`);
  const r = await readIgnition(db);
  assert.equal(r.log.length, 20); assert.equal(r.log[0].at, '2026-11-10 02:00:24', 'newest first');
  assert.deepEqual(Object.keys(r.log[0]).sort(), ['at', 'direction', 'prev', 'stage']);
  assert.equal(await readIgnition(makeDb()), null, 'no reading yet is null, never a stage');
});

test('US-26-R15: thresholds default and are overridden key by key from config.ignition', async () => {
  const two = world({ ticks: 2 });
  assert.equal((await step(two)).stage, 'seeded');
  assert.equal((await step(world({ ticks: 2 }))).holds.ticking.ok, false);
  const loose = await step(world({ ticks: 2 }), { pulse: null, config: { ignition: { ticking: { min_streak: 2 }, owner_roles: { looping: 'ops-2' } } } });
  assert.equal(loose.stage, 'ticking', 'min_streak 2 is met by two ticks; the other thresholds keep their defaults');
  assert.equal(loose.holds.looping.ok, false);
  const db = world({ ticks: 8 });
  await step(db, { pulse: null, config: { ignition: { owner_roles: { looping: 'ops-2' } } } });
  assert.equal(db.raw.prepare("SELECT owner_role FROM items WHERE id = 'IGNITE-looping'").get().owner_role, 'ops-2');
  const other = world({ ticks: 8 }); await step(other, { pulse: null });
  assert.equal(other.raw.prepare("SELECT owner_role FROM items WHERE id = 'IGNITE-looping'").get().owner_role, 'operations');
  assert.deepEqual(DEFAULTS.owner_roles, { default: 'operations', critical: 'portfolio-manager', 'self-sustaining': 'portfolio-manager' });
  const strict = await step(world({ ticks: 8 }), { pulse: { ...PULSE, coverage_24h: 0.9 }, config: { ignition: { looping: { min_coverage: 0.85 } } } });
  assert.notEqual(strict.blocking && strict.blocking.stage, 'looping', 'a lowered coverage threshold is honoured');
});
