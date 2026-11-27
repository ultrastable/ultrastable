// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-03 (the tick): the requirements the seed's runtime tick implements beyond the portable L1 tick in workers/core/src/tick.js, each proved
// under its id so the conformance manifest can attach them (US-00-R03). Uses only files of the seed: it runs in a seed checkout too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick, STEPS, STEP_ORDER, stepPlan, COST_ESSENTIAL_STEPS, LEAN_EVERY_H, lastTickForHealth, INFLIGHT_MS, ensureItem, ORIGINATE_MAX_PER_DAY } from '../src/tick.js';
import { watch } from '../src/pulse.js';
import { halted } from '../src/budget.js';
import { isOff, roster } from '../src/managers.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy, tick_every_min: 10 };
const T0 = Date.parse('2026-11-10T00:00:00Z');
const MIN = 60e3;
const get = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const at = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

test('US-03-R20 and US-03-T09: health judges the newest finished tick, so a tick in flight does not fail it, and an unfinished tick older than five minutes does', async () => {
  const db = makeDb();
  await runTick(db, { config, now: T0 });
  db.raw.prepare(`INSERT INTO tick_runs (started_at, steps_total) VALUES (?, ?)`).run('2026-11-10 00:10:00', STEP_ORDER.length);
  const during = await lastTickForHealth(db, T0 + 10 * MIN + 5e3);
  assert.equal(during.steps_completed, during.steps_total, 'the finished tick is the one judged while the next one runs');
  const stuck = await lastTickForHealth(db, T0 + 10 * MIN + INFLIGHT_MS + 1000);
  assert.notEqual(stuck.steps_completed, stuck.steps_total, 'an unfinished tick older than five minutes is the newest row: a real fault, so 503');
  assert.equal(INFLIGHT_MS, 300e3);
});

test('US-03-R19 and US-03-T07: a step that throws on a missing table or column is retried once after migrate runs again, with no TICKFAIL; any other error still files one', async () => {
  const db = makeDb();
  const orig = { measure: STEPS.measure, migrate: STEPS.migrate };
  let calls = 0, migrates = 0;
  STEPS.migrate = async () => { migrates++; };
  STEPS.measure = async () => { calls++; if (calls === 1) throw new Error('D1_ERROR: no such table: metrics'); };
  try {
    const r = await runTick(db, { config, now: T0 });
    assert.equal(calls, 2, 'retried once'); assert.ok(migrates >= 2, 'migrate ran again before the retry');
    assert.equal(r.completed, r.total); assert.deepEqual(r.errors, []);
    assert.match(r.report, /measure: healed missing schema by re-running migrate/);
    assert.equal(get(db, "SELECT COUNT(*) AS n FROM items WHERE id LIKE 'TICKFAIL-measure-%'").n, 0);
    STEPS.measure = async () => { throw new Error('boom'); };
    const r2 = await runTick(db, { config, now: T0 + 3600e3 });
    assert.equal(r2.completed, r2.total - 1);
    assert.equal(get(db, "SELECT COUNT(*) AS n FROM items WHERE id LIKE 'TICKFAIL-measure-%'").n, 1);
    STEPS.measure = async () => { throw new Error('no such table: metrics'); };   // still missing after the retry: that is a failure too
    const r3 = await runTick(db, { config, now: T0 + 7200e3 });
    assert.equal(r3.completed, r3.total - 1);
  } finally { Object.assign(STEPS, orig); }
});

test('US-03-R18 and US-03-T08: under a cost breach the plan defers every step but the essential ones, a deferred step counts as completed, and the deferred steps run again on the first tick of every few hours', async () => {
  assert.deepEqual(COST_ESSENTIAL_STEPS, ['migrate', 'reconcile', 'measure', 'criticality']);
  const quiet = Date.parse('2026-11-10T01:30:00Z'), due = Date.parse('2026-11-10T03:05:00Z');
  assert.equal(LEAN_EVERY_H, 3);
  for (const name of STEP_ORDER) assert.equal(stepPlan(name, { lean: true, now: quiet }), COST_ESSENTIAL_STEPS.includes(name) ? 'run' : 'defer', name);
  for (const name of STEP_ORDER) assert.equal(stepPlan(name, { lean: true, now: due }), 'run', `${name} runs on the first tick of the third hour`);
  assert.equal(stepPlan('dispatch', { now: quiet }), 'run', 'no breach: every step runs');
  const breach = (db, now) => db.raw.prepare('INSERT INTO cost_samples (at, target, rows_read_1h) VALUES (?,?,?)').run(at(now - 60e3), 'org', 150);
  const cfg = { ...config, cost_budgets: [{ id: 'org', max_rows_read_per_hour: 100 }] };
  const seedWork = db => db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m'); INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('W','w','operations','x','open')`);
  const lean = makeDb(); seedWork(lean); breach(lean, quiet);
  const r = await runTick(lean, { config: cfg, now: quiet });
  assert.equal(r.completed, r.total, 'deferring is a decision, not a failure');
  assert.match(r.report, /cost breach: org read 150 rows\/h > 100; skipped non-essential steps/);
  assert.equal(get(lean, "SELECT status FROM items WHERE id='W'").status, 'ready', 'reconcile ran');
  assert.equal(get(lean, 'SELECT COUNT(*) AS n FROM claims').n, 0, 'dispatch was deferred');
  assert.ok(get(lean, 'SELECT COUNT(*) AS n FROM metrics').n > 0, 'measure ran');
  const full = makeDb(); seedWork(full); breach(full, due);
  await runTick(full, { config: cfg, now: due });
  assert.equal(get(full, 'SELECT COUNT(*) AS n FROM claims').n, 1, 'on the due tick the deferred steps run');
});

test('US-03-R26: a metric with no good reading for twice the tick cadence files STALE-<id>, and a fresh reading closes it', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO metrics (id,name,kind,source,spec,op,threshold,owner_role,remedy) VALUES ('M-x','x','target','sql','SELECT 0','<=',0,'operations','r')`);
  await runTick(db, { config, now: T0 });
  await runTick(db, { config, now: T0 + 10 * MIN });
  assert.equal(get(db, "SELECT 1 AS x FROM items WHERE id='STALE-M-x'"), undefined, 'a reading inside twice the cadence is fresh');
  db.raw.exec(`UPDATE metrics SET last_at = '2026-11-10 00:10:00' WHERE id = 'M-x'`);
  const stale = STEPS.measure;
  STEPS.measure = async () => {};                      // the producer stops: no tick reads the metric for 50 minutes
  try { await runTick(db, { config, now: T0 + 60 * MIN }); } finally { STEPS.measure = stale; }
  await runTick(db, { config, now: T0 + 61 * MIN });
  const it = get(db, "SELECT status, priority, owner_role, closing_probe FROM items WHERE id='STALE-M-x'");
  assert.ok(it, 'filed'); assert.deepEqual([it.priority, it.owner_role, it.closing_probe], [0, 'operations', 'metric:M-x']);
  await runTick(db, { config, now: T0 + 72 * MIN });
  assert.equal(get(db, "SELECT status FROM items WHERE id='STALE-M-x'").status, 'done');
});

test('US-03-R22: the system files at most twenty items of its own a day; the refusal is counted, and a new day files again', async () => {
  const db = makeDb();
  const day = Date.parse('2026-11-10T12:00:00Z');
  const file = (n, now) => ensureItem(db, { id: `O-${n}`, title: 't', owner_role: 'operations', done_check: 'x' }, { now });
  assert.equal(ORIGINATE_MAX_PER_DAY, 20);
  for (let i = 0; i < ORIGINATE_MAX_PER_DAY; i++) assert.equal(await file(i, day), true);
  assert.equal(await file(20, day), false, 'the twenty-first is refused');
  assert.equal(get(db, "SELECT COUNT(*) AS n FROM items WHERE id LIKE 'O-%'").n, 20);
  assert.deepEqual(Object.values(get(db, "SELECT calls, refused FROM budget_ledger WHERE kind='originated' AND day='2026-11-10'")), [20, 1]);
  assert.equal(await file(0, day), false, 'an item that exists is not filed twice and is not counted');
  assert.equal(get(db, "SELECT refused FROM budget_ledger WHERE kind='originated'").refused, 1);
  assert.equal(await file(21, day + 86400e3), true, 'the next day has its own allowance');
});

test('US-03-R27: an event wakes the role it names out of turn, a role that is switched off in the register is never dispatched, and one tick_every still holds for the rest', async () => {
  const mk = () => { const db = makeDb(); db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('pm-1','portfolio-manager',5,'m'), ('ops-1','operations',5,'m');
    INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('P','p','portfolio-manager','x','ready'), ('O','o','operations','x','ready')`); return db; };
  const claimed = db => db.raw.prepare('SELECT agent FROM claims ORDER BY agent').all().map(r => r.agent);
  const plain = mk(); await runTick(plain, { config, now: T0 });           // tick 1: 1 % 5 = 1, neither is due
  assert.deepEqual(claimed(plain), []);
  const woken = mk(); await runTick(woken, { config, now: T0, wake: 'portfolio-manager' });
  assert.deepEqual(claimed(woken), ['pm-1'], 'only the role the event names runs out of turn');
  const reg = { managers: [{ id: 'portfolio-manager', core: false, tick_every: 1 }, { id: 'operations', core: true, tick_every: 1 }], switch: { 'portfolio-manager': { state: 'off', reason: 'not used in this deployment' }, operations: { state: 'off', reason: 'tries to switch a core manager off' } } };
  assert.equal(isOff(reg, 'portfolio-manager'), true); assert.equal(isOff(reg, 'operations'), false, 'a core manager cannot be switched off');
  assert.match(roster(reg).find(m => m.id === 'operations').refused, /core manager cannot be switched off/);
  const off = mk(); await runTick(off, { config: { ...config, managers: reg }, now: T0, wake: 'portfolio-manager' });
  assert.deepEqual(claimed(off), [], 'an off manager is not dispatched even when an event wakes it');
});

test('US-03-R28: the worker variable HALT wins over the committed halt file in both directions, and the entry points check it before they act', () => {
  assert.equal(halted({ halt: { halted: true } }, {}), true);
  assert.equal(halted({ halt: { halted: true } }, { HALT: '0' }), false, 'HALT=0 resumes without a deploy');
  assert.equal(halted({ halt: { halted: false } }, { HALT: 'on' }), true);
  assert.equal(halted(null, {}), false);
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(src, /async scheduled\(/); assert.ok(/halted\(config, env\)/.test(src), 'the Worker entry reads the halt switch');
  for (const route of ['/hook/github', '/hook/host', '/hook/cloudflare', '/pulse/watch']) assert.ok(src.includes(`'${route}'`), `${route} is guarded`);
  assert.ok((src.match(/halted\(config, env\)/g) || []).length >= 5, 'the schedule, the hooks and the watch route each check it');
});

test('US-03-R21 and US-03-T10: the second producer runs a tick only when the newest one is older than two intervals, and leaves its own beat either way', async () => {
  const db = makeDb();
  await runTick(db, { config, now: T0 });
  let ran = 0;
  const fresh = await watch(db, async () => { ran++; }, { now: () => T0 + 12 * MIN, config });
  assert.deepEqual([fresh.stale, ran], [false, 0], 'twelve minutes on a ten-minute cadence is not stale');
  const late = T0 + 45 * MIN;
  const r = await watch(db, () => runTick(db, { config, now: late }), { now: () => late, config });
  assert.equal(r.stale, true); assert.equal(r.completed, r.total);
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM tick_runs').n, 2);
  assert.equal(get(db, "SELECT COUNT(*) AS n FROM loop_beats WHERE loop='watchdog' AND ok=1").n, 2, 'a beat is left on both calls');
  assert.match(String(get(db, "SELECT detail FROM loop_beats WHERE loop='watchdog' ORDER BY id DESC LIMIT 1").detail), new RegExp(`"ran_tick":${r.ran_tick}\\b`), 'the beat names the tick it ran');
  const again = await watch(db, () => runTickNow(), { now: () => late + MIN, config });
  function runTickNow() { throw new Error('a fresh tick must not start another'); }
  assert.equal(again.stale, false, 'called again at once: the tick it just ran is fresh');
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM tick_runs').n, 2, 'no new tick');
  assert.equal(get(db, "SELECT COUNT(*) AS n FROM loop_beats WHERE loop='watchdog' AND ok=1").n, 3, 'and still a beat');
});
