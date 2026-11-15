import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick, STEP_ORDER } from '../src/tick.js';
import { beat, DDL, LIVENESS, STAGES, clockLedger, loopLedger, measureIgnition, readIgnition, watchPulse, pulseConfig } from '../src/pulse.js';
import { hiddenByHealthOnly } from '../src/visibility.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const crit = JSON.parse(readFileSync(new URL('../../autonomy/criticality.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy, criticality: crit };
const P = pulseConfig(config), I = P.interval_minutes * 60e3;
const T0 = Date.parse('2026-11-10T00:00:16Z');  // frozen: 16 s into a slot, like the cron
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const seed = db => db.raw.exec(`INSERT INTO org (key, value) VALUES ('slug','t'); INSERT INTO roles (id, role, model, tick_every) VALUES ('ops-1','operations','small',1);
  INSERT INTO items (id, title, owner_role, done_check, status) VALUES ('A','a','operations','x','ready'), ('B','b','operations','x','ready'), ('C','c','operations','x','ready');`);
const beatAll = async (db, now, skip = []) => { for (const l of P.loops) if (!skip.includes(l)) await beat(db, l, async () => ({ status: 'ok' }), () => now); };
const stage = (g, id) => g.stages.find(s => s.id === id);

test('the migration and the self-created schema are the same statements', () => {
  const sql = readFileSync(new URL('../migrations/0012_pulse.sql', import.meta.url), 'utf8').split('\n').filter(l => l && !l.startsWith('--')).map(l => l.replace(/;$/, ''));
  assert.deepEqual(sql, DDL);
});

test('the declared loops are exactly the beats the cron handler leaves', () => {
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const left = [...src.matchAll(/beat\((?:env\.DB|db), '([a-z-]+)'/g)].map(m => m[1]);
  assert.deepEqual([...left].sort(), [...P.loops].sort());
  assert.deepEqual(Object.keys(P.watchers).sort(), ['dashboard', 'site']);
  for (const f of ['../../../dashboard/worker.js', '../../../site/worker.js']) assert.match(readFileSync(new URL(f, import.meta.url), 'utf8'), /\/internal\/pulse\?from=(dashboard|site)/);
});

test('beat: a row is opened before the loop runs and closed with the outcome; a throw is recorded, not raised', async () => {
  const db = makeDb(); let seenOpen = null;
  await beat(db, 'lane', async () => { seenOpen = db.raw.prepare(`SELECT ok, finished_at FROM loop_beats WHERE loop='lane'`).get(); return { status: 'ok', merged: [1] }; }, () => T0);
  assert.equal(seenOpen.ok, null); assert.equal(seenOpen.finished_at, null);
  assert.equal(db.raw.prepare(`SELECT ok FROM loop_beats WHERE loop='lane'`).get().ok, 1);
  assert.equal(await beat(db, 'gate', async () => { throw new Error('boom'); }, () => T0), undefined);
  const g = db.raw.prepare(`SELECT ok, evidence FROM loop_beats WHERE loop='gate'`).get();
  assert.equal(g.ok, 0); assert.match(g.evidence, /threw: boom/);
  await beat(db, 'sweeper', async () => ({ status: 'no-token' }), () => T0);
  assert.equal(db.raw.prepare(`SELECT ok FROM loop_beats WHERE loop='sweeper'`).get().ok, 0);
  await beat(db, 'issuesync', async () => ({ status: 'errors', errors: ['one file'] }), () => T0);
  assert.equal(db.raw.prepare(`SELECT ok FROM loop_beats WHERE loop='issuesync'`).get().ok, 1);  // it ran; the item-level error is its evidence
});

test('every tick leaves one row per step, and a tick seeds its own liveness metrics', async () => {
  const db = makeDb(); seed(db);
  const r = await runTick(db, { config, now: T0 });
  assert.equal(r.completed, STEP_ORDER.length, JSON.stringify(r.errors));
  const rows = db.raw.prepare(`SELECT step, ok FROM tick_steps WHERE tick_id = ?`).all(r.tickId);
  assert.deepEqual(rows.map(x => x.step).sort(), [...STEP_ORDER].sort());
  assert.ok(rows.every(x => x.ok === 1));
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM metrics WHERE kind='liveness'`).get().n, LIVENESS.length);
  assert.match(r.report, /ignition /);
});

test('slot ledger: a missed slot is counted and named, and breaks the run of complete slots', async () => {
  const db = makeDb(); seed(db);
  for (let i = 0; i < 10; i++) if (i !== 6) await runTick(db, { config, now: T0 + i * I });
  const c = await clockLedger(db, P, T0 + 10 * I);
  assert.equal(c.expected_slots, 10); assert.equal(c.complete_slots, 9); assert.equal(c.missed_slots, 1);
  assert.equal(c.consecutive_complete, 3);
  assert.deepEqual(c.last_missed, [iso(T0 - 16e3 + 6 * I)]);
});

test('loop ledger: silent, failed and unfinished loops are told apart; a fresh ledger is warming, not judged', async () => {
  const db = makeDb(); seed(db);
  assert.equal((await loopLedger(db, P, T0)).lane.state, 'warming');
  for (let i = 0; i < 6; i++) await beatAll(db, T0 + i * I, i >= 2 ? ['lane'] : []);
  await beat(db, 'gate', async () => ({ status: 'error crashed' }), () => T0 + 5 * I + 1000);
  db.raw.prepare(`INSERT INTO loop_beats (loop, started_at) VALUES ('sweeper', ?)`).run(iso(T0 + 5 * I + 2000));
  const l = await loopLedger(db, P, T0 + 6 * I);
  assert.equal(l.lane.state, 'silent'); assert.equal(l.gate.state, 'failed'); assert.equal(l.sweeper.state, 'unfinished'); assert.equal(l.executor.state, 'ok');
});

test('ladder: a system climbs to bootstrapped from its own records, names its blocker, and logs each change of stage', async () => {
  const db = makeDb(); seed(db);
  let r;
  for (let i = 0; i < 8; i++) {
    const now = T0 + i * I;
    await beatAll(db, now); await watchPulse(db, config, 'dashboard', null, now); await watchPulse(db, config, 'site', null, now);
    r = await runTick(db, { config, now });
    if (i === 3) db.raw.exec(`UPDATE items SET status='done', disposition='fixed', updated_at='${iso(now)}' WHERE id='A';
      INSERT INTO outcomes (item_id, surface, action_class, result, evidence, at) VALUES ('A','deploy','deploy','verified','probe: live matches commit','${iso(now)}')`);
  }
  const { ignition: g, transitions } = await readIgnition(db);
  for (const id of ['seeded', 'ticking', 'instrumented', 'loops', 'acting', 'closing', 'verified']) assert.equal(stage(g, id).ok, true, id + ': ' + stage(g, id).evidence);
  assert.equal(g.bootstrapped, true); assert.ok(g.bootstrapped_at);
  assert.ok(transitions.length >= 2); assert.equal(transitions.at(-1).direction, 'first');
  assert.ok(transitions.some(t => t.direction === 'up'));
  assert.ok(STAGES.includes(g.stage));
  if (!g.critical) { assert.equal(g.blocker.id, 'critical'); assert.ok(g.blocker.to_close.verified_deploys_missing >= 0); }
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id='IGNITION-ticking'`).get().status, 'done');  // the blocker's item closed itself when the stage held
});

test('ladder: a loop going silent takes bootstrapped away, opens an ignition gap and files the regression', async () => {
  const db = makeDb(); seed(db);
  for (let i = 0; i < 14; i++) {
    const now = T0 + i * I;
    await beatAll(db, now, i >= 8 ? ['handoffs'] : []); await watchPulse(db, config, 'dashboard', null, now); await watchPulse(db, config, 'site', null, now);
    await runTick(db, { config, now });
    if (i === 3) db.raw.exec(`UPDATE items SET status='done', disposition='fixed', updated_at='${iso(now)}' WHERE id='A';
      INSERT INTO outcomes (item_id, surface, action_class, result, evidence, at) VALUES ('A','deploy','deploy','verified','probe: ok','${iso(now)}')`);
  }
  const { ignition: g, transitions } = await readIgnition(db);
  assert.equal(g.bootstrapped, false); assert.equal(g.blocker.id, 'loops'); assert.match(g.blocker.evidence, /handoffs: silent/);
  assert.equal(db.raw.prepare(`SELECT status FROM ignition_gaps WHERE link='loop:handoffs:silent'`).get().status, 'open');
  assert.ok(transitions.some(t => t.direction === 'down'));
  assert.ok(db.raw.prepare(`SELECT COUNT(*) AS n FROM items WHERE id LIKE 'IGNITION-REGRESS-loops-%'`).get().n >= 1);
  assert.ok(db.raw.prepare(`SELECT 1 AS x FROM items WHERE id='IGNITION-loops' AND status NOT IN ('done','superseded','cancelled')`).get());
});

test('self_sustaining needs k_eff at or over k_min for hold_ticks ticks in a row and no open gap', async () => {
  const db = makeDb(); seed(db);
  let g;
  for (let i = 0; i < P.hold_ticks; i++) {
    g = await measureIgnition(db, config, T0 + i * I, { k_eff: 2, k_min: 1, spend_units: 1, human_touches: 0 });
    db.raw.prepare(`INSERT INTO org (key, value) VALUES ('ignition', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(JSON.stringify(g));
  }
  assert.equal(g.critical, true); assert.equal(g.critical_streak, P.hold_ticks); assert.equal(stage(g, 'self_sustaining').ok, true);
  const lost = await measureIgnition(db, config, T0 + 9 * I, { k_eff: 0.5, k_min: 1, spend_units: 10, human_touches: 0, credited_deploys: 5, originated_credited: 0 });
  assert.equal(lost.critical_streak, 0); assert.equal(lost.critical_since, null);
});

test('watcher: a fresh tick is left alone, a stale one is run on the spot, and only declared watchers leave a beat', async () => {
  const db = makeDb(); seed(db);
  await runTick(db, { config, now: T0 });
  let ran = 0; const rescue = async () => { ran++; return runTick(db, { config, now: T0 + 5 * I }); };
  const fresh = await watchPulse(db, config, 'dashboard', rescue, T0 + I);
  assert.equal(fresh.stale, false); assert.equal(ran, 0); assert.equal(fresh.ok, true);
  const stale = await watchPulse(db, config, 'site', rescue, T0 + 5 * I);
  assert.equal(stale.stale, true); assert.equal(stale.rescued, true); assert.equal(ran, 1); assert.equal(stale.ok, true);
  assert.equal(db.raw.prepare(`SELECT ok FROM loop_beats WHERE loop='tick-rescue'`).get().ok, 1);
  await watchPulse(db, config, 'stranger', null, T0 + 6 * I);
  assert.deepEqual(db.raw.prepare(`SELECT DISTINCT loop FROM loop_beats WHERE loop LIKE 'watch:%' ORDER BY 1`).all().map(r => r.loop), ['watch:dashboard', 'watch:site']);
  assert.equal(hiddenByHealthOnly({ PUBLIC_HEALTH_ONLY: '1' }, 'POST', '/internal/pulse'), false);
});
