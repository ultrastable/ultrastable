// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-26 (criticality and its control loop): each test is named by the requirement it proves. Clocks are frozen, databases are in memory,
// no network. The route tests run the Worker from a private copy of the seed with a stub config, so nothing is written into the checkout.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeDb } from './d1shim.js';
import { runTick, ensureItem } from '../src/tick.js';
import { computeKEff, measureCriticality, criticalityStep, readCriticality, addSample, addIgnitionGaps, deriveIgnitionGaps, emitSuccessors } from '../src/criticality.js';
import { ignitionStep } from '../src/ignition.js';
import { readControl, pickForRole, regimeOf, raisesK, loopHealth, RAISE, OPEN } from '../src/critloop.js';

const SEED = fileURLToPath(new URL('../../', import.meta.url));
const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const crit = JSON.parse(readFileSync(new URL('../../autonomy/criticality.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy, criticality: crit };
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const NOW = Date.parse('2026-11-10T00:00:00Z'), DAY = 86400e3;
const cur = (o = {}) => ({ deploys: 0, fail: 0, spend: 0, human: 0, originated: 0, ...o });
const ctxOf = (over = {}, now = NOW) => ({ now, nowIso: iso(now), tickId: 1, dispatched: 0, errors: [], notes: [], config: { org_slug: 'mine' }, ...over });
const stepOf = (db, over = {}, now = NOW) => criticalityStep(db, ctxOf(over, now), crit, ensureItem);
const outcome = (db, surface, cls, result, evidence, at = iso(NOW - DAY)) =>
  db.raw.prepare('INSERT INTO outcomes (item_id, surface, action_class, result, evidence, at) VALUES (?,?,?,?,?,?)').run('X', surface, cls, result, evidence, at);
const item = (db, id, o = {}) => db.raw.prepare('INSERT INTO items (id, title, kind, owner_role, done_check, status, priority, tenant_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
  .run(id, 't', o.kind || 'work', o.owner || 'operations', 'd', o.status || 'ready', o.priority ?? 10, o.tenant ?? null, o.created || iso(NOW - DAY), o.updated || iso(NOW - DAY));

let APP = null;
async function app() {
  if (APP) return APP;
  const dir = mkdtempSync(path.join(tmpdir(), 'spec26-'));
  cpSync(SEED, path.join(dir, 'seed'), { recursive: true, filter: s => !/(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(path.relative(SEED, s)) });
  writeFileSync(path.join(dir, 'seed/worker/src/config.js'), 'export default ' + JSON.stringify({ org_slug: 'spec26', criticality: crit }) + ';\n');
  const mod = await import(pathToFileURL(path.join(dir, 'seed/worker/src/index.js')).href);
  APP = { dir, worker: mod.default };
  return APP;
}
after(() => { if (APP) rmSync(APP.dir, { recursive: true, force: true }); });
const get = async (db, p, env = {}) => (await app()).worker.fetch(new Request('https://spec26.example' + p), { DB: db, ...env }, { waitUntil() {} });

test('US-26-R16: k_eff is credited work over spend plus human touches, floored, rounded to four places and read over a 14-day window', async () => {
  assert.equal(computeKEff(cur({ deploys: 6, originated: 2, spend: 6, human: 2 }), null, crit).k_eff, 1);
  assert.equal(computeKEff(cur({ deploys: 1, spend: 3 }), null, crit).k_eff, 0.3333);
  assert.equal(computeKEff(cur({ deploys: 3 }), null, crit).k_eff, 3, 'the denominator never falls below denominator_floor');
  assert.deepEqual([crit.window_days, crit.k_min, crit.denominator_floor, crit.dispatch_spend_units], [14, 1, 1, 1]);
  const db = makeDb();
  await addSample(db, { source: 't', deploys_ok: 4, spend_units: 2, human_touches: 1 }, '2026-11-05 00:00:00');
  await addSample(db, { source: 't', deploys_ok: 99, spend_units: 99, human_touches: 9 }, '2026-09-01 00:00:00');  // older than two windows: never read
  for (let i = 0; i < 3; i++) db.raw.prepare("INSERT INTO dispatches (tick_id, role_id, model, at) VALUES (1, 'r', 'm', '2026-11-09 00:00:00')").run();
  db.raw.exec(`INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe) VALUES ('G-open','w','y','d','manual');
    INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe, status, closed_at) VALUES ('G-recent','w','y','d','manual','closed','2026-11-09 00:00:00'), ('G-old','w','y','d','manual','closed','2026-10-01 00:00:00')`);
  item(db, 'ORIGIN-x', { status: 'done', created: '2026-11-08 00:00:00' });
  const m = await measureCriticality(db, crit, NOW);
  assert.equal(m.raw_deploys, 4);
  assert.equal(m.spend_units, 5, 'sample spend 2 plus 3 dispatches at dispatch_spend_units 1');
  assert.equal(m.human_touches, 3, 'sample touches 1 plus an open card plus a card closed inside the window; a card closed before it is not owner attention now');
  assert.equal(m.originated_credited, 1); assert.equal(m.window_days, 14); assert.equal(m.k_min, 1);
  assert.equal(m.k_eff, 0.625);
});

test('US-26-R17: only a probe-verified deploy credits k_eff; a loop that verifies itself earns nothing and failures are counted in the same scope', async () => {
  const db = makeDb();
  outcome(db, 'deploy', 'deploy', 'verified', 'probe:live-sha-match');
  outcome(db, 'deploy', 'deploy', 'verified', 'probe:live-sha-match');
  outcome(db, 'repo', 'branch_commit_push', 'verified', 'probe:pushed');
  outcome(db, 'deploy', 'deploy', 'verified', 'self-reported ok');           // the changing loop's own word
  outcome(db, 'repo', 'merge', 'verified', 'probe:merged');                    // not a deploy action class
  outcome(db, 'ignition', 'probe', 'verified', 'probe:ignition:ticking holds'); // not a deploy surface
  outcome(db, 'deploy', 'deploy', 'failed', 'x');
  outcome(db, 'deploy', 'release', 'hidden_failure', 'x');
  outcome(db, 'deploy', 'deploy', 'failed', 'x', iso(NOW - 40 * DAY));          // outside the window
  const m = await measureCriticality(db, crit, NOW);
  assert.equal(m.raw_deploys, 3); assert.equal(m.fail_rate, 0.4);
  assert.deepEqual(crit.deploy.action_classes, ['deploy', 'release', 'branch_commit_push']); assert.deepEqual(crit.deploy.surfaces, ['deploy', 'repo']);
  assert.equal(crit.deploy.verifier_evidence_prefix, 'probe:');
  await addSample(db, { source: 'github-runs', deploys_ok: 2, deploys_fail: 1 }, '2026-11-09 00:00:00');  // an external sample is independent by construction
  assert.equal((await measureCriticality(db, crit, NOW)).raw_deploys, 5);
});

test('US-26-R18: a rise in deploys is not credited when spend rises more than 10 percent or the failure rate rises more than 0.05', async () => {
  const prev = cur({ deploys: 10, spend: 100 });
  const spend = computeKEff(cur({ deploys: 40, spend: 111 }), prev, crit);
  assert.equal(spend.guard.tripped, true); assert.equal(spend.credited_deploys, 10); assert.equal(spend.raw_deploys, 40);
  assert.equal(computeKEff(cur({ deploys: 40, spend: 110 }), prev, crit).guard.tripped, false, 'exactly 10 percent is within tolerance');
  const fail = computeKEff(cur({ deploys: 20, fail: 6, spend: 10 }), cur({ deploys: 10, fail: 1, spend: 10 }), crit);
  assert.equal(fail.guard.fail_worse, true); assert.equal(fail.credited_deploys, 10);
  assert.equal(computeKEff(cur({ deploys: 20, fail: 3, spend: 10 }), cur({ deploys: 10, fail: 1, spend: 10 }), crit).guard.fail_worse, false);
  assert.equal(computeKEff(cur({ deploys: 9, spend: 500 }), prev, crit).credited_deploys, 9, 'no rise, no guard');
  assert.equal(computeKEff(cur({ deploys: 40, spend: 500 }), null, crit).credited_deploys, 40, 'no previous window, no guard');
  assert.deepEqual([crit.guards.spend_worse_tolerance, crit.guards.fail_rate_worse_tolerance], [0.1, 0.05]);
  const db = makeDb();
  await addSample(db, { source: 't', deploys_ok: 10, spend_units: 100 }, '2026-10-20 00:00:00');   // previous window
  await addSample(db, { source: 't', deploys_ok: 40, spend_units: 200 }, '2026-11-05 00:00:00');   // current window
  const m = await measureCriticality(db, crit, NOW);
  assert.equal(m.guard.tripped, true); assert.equal(m.credited_deploys, 10);
});

test('US-26-R19: items the loops filed themselves credit k_eff by id prefix, at most 20 a window', async () => {
  assert.equal(computeKEff(cur({ originated: 500, spend: 10 }), null, crit).originated_credited, 20);
  assert.deepEqual(crit.originated.id_prefixes, ['ORIGIN-', 'BREACH-', 'TICKFAIL-', 'REBALANCE-', 'LADDER-', 'NEXT-']); assert.equal(crit.originated.credit_cap, 20);
  const db = makeDb();
  for (const id of ['ORIGIN-a', 'BREACH-b', 'TICKFAIL-c', 'REBALANCE-d', 'LADDER-e', 'NEXT-f', 'OTHER-g']) item(db, id, { created: '2026-11-08 00:00:00' });
  item(db, 'ORIGIN-old', { created: '2026-09-01 00:00:00' });
  assert.equal((await measureCriticality(db, crit, NOW)).originated_credited, 6);
  for (let i = 0; i < 30; i++) item(db, `ORIGIN-n${i}`, { created: '2026-11-08 00:00:00' });
  assert.equal((await measureCriticality(db, crit, NOW)).originated_credited, 20);
});

test('US-26-R20: k_self counts only deploys the system shipped on itself, never more than were credited; the regime says which source keeps it critical', async () => {
  const out = computeKEff(cur({ deploys: 4, self: 0, spend: 2 }), null, crit);
  assert.deepEqual([out.k_eff, out.k_self, out.self_regime], [2, 0, 'driven']);
  const own = computeKEff(cur({ deploys: 4, self: 3, spend: 2 }), null, crit);
  assert.deepEqual([own.k_eff, own.k_self, own.self_regime, own.self_deploys], [2, 1.5, 'self-sustaining', 3]);
  assert.equal(computeKEff(cur({ deploys: 1, self: 1, spend: 4 }), null, crit).self_regime, 'subcritical');
  const g = computeKEff(cur({ deploys: 40, self: 40, spend: 200 }), cur({ deploys: 10, spend: 10 }), crit);
  assert.ok(g.guard.tripped && g.self_deploys <= g.credited_deploys && g.k_self <= g.k_eff);
  assert.deepEqual(crit.self.origins, ['executor', 'self-agent']);
  const db = makeDb();
  outcome(db, 'deploy', 'deploy', 'verified', 'probe:live_matches_commit=true sha=aaaa origin=executor');
  outcome(db, 'deploy', 'deploy', 'verified', 'probe:live_matches_commit=true sha=bbbb origin=self-agent');
  outcome(db, 'deploy', 'deploy', 'verified', 'probe:live_matches_commit=true sha=cccc origin=outside');
  outcome(db, 'deploy', 'deploy', 'verified', 'probe:live_matches_commit=true sha=dddd origin=unknown');
  const m = await measureCriticality(db, crit, NOW);
  assert.equal(m.raw_deploys, 4); assert.equal(m.self_deploys, 2);
  assert.equal(m.k_self, 2); assert.equal(m.k_eff, 4); assert.equal(m.self_regime, 'self-sustaining');
});

test('US-26-R21: every tick the snapshot is stored under org key criticality with the figures behind k_eff, and read back unchanged', async () => {
  const db = makeDb();
  await addSample(db, { source: 't', deploys_ok: 6, spend_units: 3 }, '2026-11-09 00:00:00');
  const snap = await stepOf(db, { dispatched: 1 });
  for (const k of ['k_eff', 'k_self', 'self_regime', 'credited_deploys', 'raw_deploys', 'originated_credited', 'spend_units', 'human_touches', 'fail_rate', 'guard', 'cap_breached',
    'window_days', 'k_min', 'at', 'emitted_successors', 'queue_open', 'idle', 'reasons', 'originated_now', 'open_ignition_gaps', 'ignition_gaps', 'self_sustaining', 'control']) assert.ok(k in snap, k);
  assert.deepEqual(await readCriticality(db), JSON.parse(JSON.stringify(snap)));
  assert.equal(snap.k_eff, 2); assert.equal(snap.at, iso(NOW));
  assert.equal(await readCriticality(makeDb()), null, 'no tick, no reading');
  const bare = makeDb();  // no thresholds configured: nothing is measured, and the ladder reads that as unmeasured, never as zero or as met
  await runTick(bare, { config: { org_slug: 't', policy: {} }, now: NOW });
  assert.equal(await readCriticality(bare), null);
  assert.match(JSON.parse(bare.raw.prepare("SELECT value FROM org WHERE key = 'ignition'").get().value).holds.critical.why, /k_eff is unmeasured/);
});

test('US-26-R22: a tick that is empty, subcritical or idle originates the highest-value item at the head, one a day per problem', async () => {
  const db = makeDb();
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m'), ('pm-1','portfolio-manager',1,'m')");  // the org has doers: its own idle repair is not an unowned backlog
  const a = await stepOf(db);
  assert.deepEqual(a.reasons, ['queue_empty', 'k_eff_below_min', 'idle_tick']);
  assert.equal(a.originated_now.kind, 'generic'); assert.equal(a.originated_now.created, true);
  const o = db.raw.prepare("SELECT * FROM items WHERE id LIKE 'ORIGIN-%'").get();
  assert.equal(o.id, 'ORIGIN-generic-2026-11-10-t1'); assert.equal(o.priority, crit.origination.head_priority); assert.equal(o.kind, 'fix');
  assert.equal(o.owner_role, 'portfolio-manager'); assert.equal(o.closing_probe, 'criticality:generic');
  const again = await stepOf(db, { tickId: 2 });
  assert.equal(again.originated_now.created, false); assert.equal(again.originated_now.id, o.id, "today's item for this problem is still at the head");
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM items WHERE id LIKE 'ORIGIN-%'").get().n, 1);
  db.raw.exec("UPDATE items SET status = 'done', disposition = 'fixed' WHERE id LIKE 'ORIGIN-%'");
  assert.equal((await stepOf(db, { tickId: 3 })).originated_now.created, true, 'a closed one is replaced: the queue may not stay empty');
  const kinds = async (setup) => { const d = makeDb(); await setup(d); return (await stepOf(d)).originated_now.kind; };
  assert.equal(await kinds(d => addSample(d, { source: 't', spend_units: crit.origination.spend_budget_units + 1 }, '2026-11-09 00:00:00')), 'cost_cut');
  assert.equal(await kinds(d => addSample(d, { source: 't', deploys_ok: 5, deploys_fail: 5, spend_units: 5 }, '2026-11-09 00:00:00')), 'flaky_deploy');
  assert.equal(await kinds(d => { item(d, 'U-1', { owner: 'nobody', status: 'open' }); }), 'unowned_backlog');
  assert.equal(await kinds(d => addSample(d, { source: 't', deploys_ok: 5, deploys_fail: 5, spend_units: crit.origination.spend_budget_units + 1 }, '2026-11-09 00:00:00')), 'cost_cut', 'cost_cut comes before flaky_deploy');
  const healthy = makeDb(); item(healthy, 'A'); await addSample(healthy, { source: 't', deploys_ok: 50, spend_units: 10 }, '2026-11-09 00:00:00');
  const h = await stepOf(healthy, { dispatched: 1 });
  assert.deepEqual(h.reasons, []); assert.equal(h.originated_now, null);
});

test('US-26-R23: while a spend cap is breached only a cost cut is originated, and a frozen budget files no idle repair', async () => {
  const sample = makeDb(); await addSample(sample, { source: 'cost-probe', spend_units: 1, cap_breached: 1 }, '2026-11-09 00:00:00');
  item(sample, 'U-1', { owner: 'nobody', status: 'open' });  // an unowned backlog would be next in order, but spend is capped
  const s = await stepOf(sample);
  assert.ok(s.cap_breached); assert.equal(s.originated_now.kind, 'cost_cut');
  for (const over of [{ budget: { mode: 'frozen' } }, { budget: { mode: 'crawl' } }, { costBreach: { over: true } }]) {
    const db = makeDb(); const r = await stepOf(db, over);
    assert.ok(r.cap_breached, JSON.stringify(over)); assert.equal(r.originated_now.kind, 'cost_cut');
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM items WHERE id LIKE 'IDLE-%'").get().n, 0, 'no new work that spends');
    assert.deepEqual(db.raw.prepare("SELECT id FROM items WHERE id LIKE 'ORIGIN-%'").all().map(x => x.id), ['ORIGIN-cost_cut-2026-11-10-t1']);
  }
});

test('US-26-R24: a tick that dispatched nothing and holds no claim files its own idle repair and records the error', async () => {
  const db = makeDb(); const ctx = ctxOf();
  await criticalityStep(db, ctx, crit, ensureItem);
  const idle = db.raw.prepare("SELECT * FROM items WHERE id LIKE 'IDLE-%'").get();
  assert.equal(idle.id, 'IDLE-2026-11-10T00'); assert.equal(idle.owner_role, 'operations'); assert.equal(idle.priority, crit.origination.head_priority);
  assert.equal(idle.closing_probe, 'criticality:idle'); assert.equal(idle.done_check, 'next tick dispatches or claims an item');
  assert.deepEqual(ctx.errors, ['idle_tick: tick 1 dispatched nothing; repair filed']);
  const busy = makeDb(); const c2 = ctxOf({ dispatched: 1 }); await criticalityStep(busy, c2, crit, ensureItem);
  assert.equal(busy.raw.prepare("SELECT COUNT(*) n FROM items WHERE id LIKE 'IDLE-%'").get().n, 0); assert.deepEqual(c2.errors, []);
  const held = makeDb(); item(held, 'C', { status: 'claimed' }); held.raw.exec("INSERT INTO claims (item_id, agent) VALUES ('C', 'op-1')");
  await stepOf(held); assert.equal(held.raw.prepare("SELECT COUNT(*) n FROM items WHERE id LIKE 'IDLE-%'").get().n, 0, 'a held claim is not idle');
});

test('US-26-R25: each closed item emits one successor while k_eff is at or under k_max, three a tick at most; above k_max none', async () => {
  assert.equal(crit.k_max, 3); assert.equal(crit.successor.batch, 3);
  const db = makeDb();
  for (const [i, id] of ['A', 'B', 'C', 'D', 'E'].entries()) item(db, id, { status: 'done', kind: 'work', owner: 'pm', priority: 7, updated: `2026-11-0${i + 1} 00:00:00` });
  item(db, 'NEXT-Z', { status: 'done' }); item(db, 'IDLE-1', { status: 'done' });
  assert.equal(await emitSuccessors(db, crit, ctxOf(), ensureItem), 3);
  const nx = db.raw.prepare("SELECT id, kind, owner_role, priority, closing_probe FROM items WHERE id LIKE 'NEXT-%' AND id <> 'NEXT-Z' ORDER BY id").all();
  assert.deepEqual(nx.map(x => x.id), ['NEXT-C', 'NEXT-D', 'NEXT-E'], 'the most recently closed first');
  assert.ok(nx.every(x => x.kind === 'plus' && x.owner_role === 'pm' && x.priority === 7)); assert.equal(nx[0].closing_probe, 'successor:C');
  assert.equal(await emitSuccessors(db, crit, ctxOf(), ensureItem), 2, 'items that already have a successor are skipped');
  assert.equal(await emitSuccessors(db, crit, ctxOf(), ensureItem), 0);
  const rod = makeDb(); item(rod, 'X', { status: 'done' });
  await addSample(rod, { source: 't', deploys_ok: 500, spend_units: 1 }, '2026-11-09 00:00:00');
  const s = await stepOf(rod);
  assert.ok(s.k_eff > crit.k_max); assert.equal(s.emitted_successors, 0); assert.equal(rod.raw.prepare("SELECT COUNT(*) n FROM items WHERE id = 'NEXT-X'").get().n, 0);
});

test('US-26-R26: every link that does not close on itself is a row; derived rows close with their time when the cause is gone and are never deleted; self_sustaining needs zero', async () => {
  const db = makeDb();
  db.raw.exec("INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe) VALUES ('G1','pay','y','d','manual')");
  db.raw.exec("INSERT INTO metrics (id, name, kind, source, spec, op, threshold, owner_role, remedy) VALUES ('M-d','d','target','declared','later','>=',0,'operations','r')");
  item(db, 'U-1', { owner: 'nobody', status: 'open' });
  const r = await deriveIgnitionGaps(db, '2026-11-10 00:00:00', { not_ticking: [{ loop: 'lane', state: 'failing' }] }, 'mine');
  assert.deepEqual(r.ignition_gaps.map(g => g.link), ['gate:G1', 'items:unowned', 'loop:lane:not-ticking', 'metric:M-d:unprobed']);
  assert.equal(r.open_ignition_gaps, 4);
  assert.equal(r.ignition_gaps.find(g => g.link === 'items:unowned').owner, 'portfolio-manager');
  await addIgnitionGaps(db, [{ link: 'family Q-X grows', owner: 'operations', closing_probe: 'throughput --doer Q-X' }], '2026-11-10 00:01:00');
  assert.equal((await deriveIgnitionGaps(db, '2026-11-10 00:02:00', null, 'mine')).open_ignition_gaps, 4, 'three derived causes remain, the loop one is gone, and the external link stays open: a derived pass leaves it to its collector');
  db.raw.exec("UPDATE gate_cards SET status = 'closed'; DELETE FROM metrics; UPDATE items SET owner_role = 'operations'");
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m')");
  const done = await deriveIgnitionGaps(db, '2026-11-10 00:03:00', null, 'mine');
  assert.equal(done.open_ignition_gaps, 1); assert.equal(done.ignition_gaps[0].source, 'external');
  const rows = db.raw.prepare("SELECT link, status, closed_at, source FROM ignition_gaps ORDER BY link").all();
  assert.equal(rows.length, 5, 'closed links are kept');
  assert.ok(rows.filter(x => x.source === 'tick').every(x => x.status === 'closed' && x.closed_at), 'every derived row is closed with its time');
  assert.equal(rows.find(x => x.link === 'loop:lane:not-ticking').closed_at, '2026-11-10 00:02:00', 'each closed at the pass that found its cause gone');
  assert.equal(rows.find(x => x.link === 'gate:G1').closed_at, '2026-11-10 00:03:00');
  await addIgnitionGaps(db, [], '2026-11-10 00:04:00');  // the collector's sample is its full list: what it no longer reports has closed
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM ignition_gaps WHERE status = 'open'").get().n, 0);
  const sus = makeDb(); item(sus, 'A'); await addSample(sus, { source: 't', deploys_ok: 5, spend_units: 2 }, '2026-11-09 00:00:00');
  sus.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m')");
  const ok = await stepOf(sus, { dispatched: 1 });
  assert.equal(ok.open_ignition_gaps, 0); assert.equal(ok.self_sustaining, true);
  sus.raw.exec("INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe) VALUES ('G9','w','y','d','manual')");
  const held = await stepOf(sus, { dispatched: 1 });
  assert.equal(held.open_ignition_gaps, 1); assert.equal(held.self_sustaining, false); assert.ok(held.k_eff >= crit.k_min);
});

test('US-26-R27: collector samples are stored with coerced numbers, and their ignition gaps are taken in; the route needs the bearer token', async () => {
  const db = makeDb();
  await addSample(db, { source: 'x'.repeat(60), deploys_ok: 'oops', deploys_fail: '2', spend_units: '2.5', human_touches: null, cap_breached: 1,
    ignition_gaps: [{ link: 'a link', owner: 'o', closing_probe: 'p' }, null, { owner: 'no link' }] }, '2026-11-09 00:00:00');
  const s = db.raw.prepare('SELECT * FROM criticality_samples').get();
  assert.equal(s.source.length, 40); assert.deepEqual([s.deploys_ok, s.deploys_fail, s.spend_units, s.human_touches, s.cap_breached], [0, 2, 2.5, 0, 1]);
  assert.deepEqual(db.raw.prepare('SELECT link, source, status FROM ignition_gaps').all().map(x => ({ ...x })), [{ link: 'a link', source: 'external', status: 'open' }]);
  assert.equal(await addIgnitionGaps(db, Array.from({ length: 300 }, (_, i) => ({ link: 'l' + i })), '2026-11-09 00:00:00'), 200, 'at most 200 links a sample');
  const body = JSON.stringify({ source: 'collector', deploys_ok: 3, spend_units: 1 });
  const post = async (headers, env) => (await app()).worker.fetch(new Request('https://spec26.example/api/criticality/sample', { method: 'POST', headers, body }), { DB: makeDb(), ...env }, { waitUntil() {} });
  assert.equal((await post({}, { CRITICALITY_TOKEN: 't0k' })).status, 401);
  assert.equal((await post({ authorization: 'Bearer wrong' }, { CRITICALITY_TOKEN: 't0k' })).status, 401);
  assert.equal((await post({ authorization: 'Bearer t0k' }, {})).status, 401, 'no configured token, no route');
  const good = makeDb(); const env = { DB: good, CRITICALITY_TOKEN: 't0k' };
  const r = await (await app()).worker.fetch(new Request('https://spec26.example/api/criticality/sample', { method: 'POST', headers: { authorization: 'Bearer t0k' }, body }), env, { waitUntil() {} });
  assert.equal(r.status, 202); assert.equal(good.raw.prepare('SELECT deploys_ok FROM criticality_samples').get().deploys_ok, 3);
});

test('US-26-R28: a runtime counts and picks only rows that are its own (tenant_id NULL or its slug)', async () => {
  const db = makeDb();
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m'), ('pm-1','portfolio-manager',1,'m')");
  item(db, 'MINE', { tenant: null }); item(db, 'SLUG', { tenant: 'mine' }); item(db, 'OTHER', { tenant: 'other' });
  item(db, 'U-OTHER', { owner: 'nobody', status: 'open', tenant: 'other' });
  db.raw.exec("INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe, tenant_id) VALUES ('G-other','w','y','d','manual','other')");
  const s = await stepOf(db, { dispatched: 1 });
  assert.equal(s.queue_open, 2, 'another tenant\'s ready items are not this queue');
  assert.deepEqual(s.ignition_gaps.map(g => g.link), [], "another tenant's gate card and unowned item are not this runtime's gaps");
  const role = { role: 'operations', project: null };
  db.raw.exec("UPDATE items SET priority = 0 WHERE id = 'OTHER'");
  assert.notEqual((await pickForRole(db, role, crit, [], 'mine')).id, 'OTHER');
  item(db, 'PROJ', { priority: 1 }); db.raw.exec("UPDATE items SET project = 'p2' WHERE id = 'PROJ'");
  assert.equal((await pickForRole(db, { role: 'operations', project: 'p1' }, crit, [], 'mine')).id, 'MINE', 'an item of another project is not this role\'s');
});

// ---- the control loop (critloop.js), on an empty database and a frozen clock ----
const step = i => NOW + i * 600e3;
const hist = db => db.raw.prepare('SELECT * FROM criticality_history ORDER BY id').all();
const acts = db => db.raw.prepare('SELECT * FROM criticality_actions ORDER BY id').all();

test('US-26-R29: with a control block every tick appends one beat and prunes beats older than 30 days; without it the lever stays open and nothing is written', async () => {
  const db = makeDb();
  db.raw.prepare("INSERT INTO criticality_history (tick_id, at, k_eff, regime, mode) VALUES (0, '2026-09-01 00:00:00', 0, 'subcritical', 'open')").run();
  for (let i = 0; i < 3; i++) await runTick(db, { config, now: step(i) });
  const h = hist(db);
  assert.equal(h.length, 3, 'one beat per tick and the 70-day-old row pruned'); assert.ok(h.every(r => r.at >= '2026-11-10' && r.k_eff >= 0 && r.regime === 'subcritical'));
  assert.equal(crit.control.history_keep_days, 30);
  const { control, ...bare } = crit; const none = makeDb();
  for (let i = 0; i < 5; i++) await runTick(none, { config: { ...config, criticality: bare }, now: step(i) });
  assert.equal(hist(none).length, 0); assert.equal((await readControl(none)).mode, OPEN); assert.equal(acts(none).length, 0);
  assert.equal((await readControl(makeDb())).mode, OPEN, 'an unwritten lever reads as open');
});

test('US-26-R30: k_eff under k_min is subcritical, over k_max supercritical, from k_min to k_max inclusive critical', () => {
  assert.equal(regimeOf(0.99, crit), 'subcritical'); assert.equal(regimeOf(1, crit), 'critical'); assert.equal(regimeOf(3, crit), 'critical'); assert.equal(regimeOf(3.01, crit), 'supercritical');
});

test('US-26-R31: after three beats under k_min the dispatch lever moves to raise-only with the prediction k_eff > k within 24 h; not before', async () => {
  const early = makeDb();
  for (let i = 0; i < crit.control.subcritical_ticks - 1; i++) await runTick(early, { config, now: step(i) });
  assert.equal((await readControl(early)).mode, OPEN); assert.equal(acts(early).length, 0);
  const db = makeDb();
  for (let i = 0; i < crit.control.subcritical_ticks; i++) await runTick(db, { config, now: step(i) });
  const ctl = await readControl(db);
  assert.equal(ctl.mode, RAISE);
  const a = acts(db);
  assert.equal(a.length, 1); assert.equal(a[0].lever, 'dispatch_mode'); assert.deepEqual([a[0].from_value, a[0].to_value], [OPEN, RAISE]);
  assert.match(a[0].reason, /k_eff under k_min for 3 beats/);
  assert.equal(a[0].prediction, `k_eff > ${a[0].k_at_action} within 24 h`); assert.equal(a[0].result, null);
  assert.equal(Date.parse(a[0].due_at.replace(' ', 'T') + 'Z') - Date.parse(a[0].at.replace(' ', 'T') + 'Z'), 24 * 3600e3);
  assert.equal(hist(db).at(-1).mode, RAISE);
});

test('US-26-R32: in raise-only each role takes its highest-ranked item that raises k_eff and otherwise its ordinary head', async () => {
  const db = makeDb();
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('operations-1','operations',1,'m')");
  item(db, 'W-1', { priority: 1 }); item(db, 'Q-COST-9', { priority: 5 }); item(db, 'F-1', { priority: 9, kind: 'fix' }); item(db, 'CLAIMED', { priority: 0 });
  db.raw.exec("INSERT INTO claims (item_id, agent) VALUES ('CLAIMED', 'x')");
  const role = db.raw.prepare('SELECT * FROM roles').get();
  assert.equal((await pickForRole(db, role, crit)).id, 'W-1', 'open lever: the ordinary head, claimed items skipped');
  db.raw.prepare("INSERT INTO org (key, value) VALUES ('criticality_control', ?)").run(JSON.stringify({ mode: RAISE }));
  assert.equal((await pickForRole(db, role, crit)).id, 'Q-COST-9', 'raise-only: a declared prefix first');
  db.raw.exec("DELETE FROM items WHERE id = 'Q-COST-9'");
  assert.equal((await pickForRole(db, role, crit)).id, 'F-1', 'a fix item raises k_eff by kind');
  db.raw.exec("DELETE FROM items WHERE id = 'F-1'");
  assert.equal((await pickForRole(db, role, crit)).id, 'W-1', 'nothing raises: the head, never starved');
  assert.equal(await pickForRole(makeDb(), role, crit), null);
  assert.equal(raisesK({ id: 'Q-DEPLOY-1', kind: 'work' }, crit.control), true); assert.equal(raisesK({ id: 'W-1', kind: 'work' }, crit.control), false);
  assert.deepEqual(crit.control.raises_kinds, ['fix']);
});

test('US-26-R33: a prediction is graded when due: a rise is a hit and keeps the lever; no rise is a miss that reverts it, files CRIT-LEVER at the head and blocks a retry for 24 h', async () => {
  const db = makeDb();
  for (let i = 0; i < 3; i++) await runTick(db, { config, now: step(i) });
  const due = Date.parse(acts(db)[0].due_at.replace(' ', 'T') + 'Z');
  await runTick(db, { config, now: due + 1000 });
  const a = acts(db);
  assert.equal(a[0].result, 'miss'); assert.ok(a[0].graded_at);
  assert.equal((await readControl(db)).mode, OPEN); assert.deepEqual([a[1].from_value, a[1].to_value, a[1].prediction], [RAISE, OPEN, null]);
  const lever = db.raw.prepare("SELECT * FROM items WHERE id LIKE 'CRIT-LEVER-%'").get();
  assert.equal(lever.priority, crit.origination.head_priority); assert.equal(lever.closing_probe, 'criticality:lever'); assert.equal(lever.owner_role, 'operations');
  for (const dt of [600e3, 1200e3, 23 * 3600e3]) await runTick(db, { config, now: due + dt });
  assert.equal((await readControl(db)).mode, OPEN, 'the cooldown holds the lever open'); assert.equal(acts(db).length, 2);
  const hit = makeDb();
  for (let i = 0; i < 3; i++) await runTick(hit, { config, now: step(i) });
  const d2 = Date.parse(acts(hit)[0].due_at.replace(' ', 'T') + 'Z');
  hit.raw.prepare("INSERT INTO criticality_samples (at, source, deploys_ok) VALUES (?, 'test', 50)").run('2026-11-10 00:20:00');
  await runTick(hit, { config, now: d2 + 1000 });
  assert.equal(acts(hit)[0].result, 'hit');
});

test('US-26-R34: k_eff back at or over k_min releases the lever and grades the open prediction a hit', async () => {
  const db = makeDb();
  for (let i = 0; i < 3; i++) await runTick(db, { config, now: step(i) });
  assert.equal((await readControl(db)).mode, RAISE);
  db.raw.prepare("INSERT INTO criticality_samples (at, source, deploys_ok) VALUES (?, 'test', 500)").run('2026-11-10 00:31:00');
  await runTick(db, { config, now: step(4) });
  assert.equal((await readControl(db)).mode, OPEN);
  const a = acts(db); assert.equal(a[0].result, 'hit'); assert.deepEqual([a.at(-1).from_value, a.at(-1).to_value, a.at(-1).prediction], [RAISE, OPEN, null]);
  assert.match(a.at(-1).reason, /lever released/);
});

test('US-26-R35: subcritical with k_eff no higher than 144 beats ago files CRIT-STALL for the day at the head and marks the beat stalled', async () => {
  assert.equal(crit.control.stall_ticks, 144);
  const db = makeDb();
  const c = { ...crit, control: { ...crit.control, stall_ticks: 3 } };
  for (let i = 0; i < 2; i++) await runTick(db, { config: { ...config, criticality: c }, now: step(i) });
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM items WHERE id LIKE 'CRIT-STALL-%'").get().n, 0, 'fewer beats than stall_ticks cannot stall');
  for (let i = 2; i < 4; i++) await runTick(db, { config: { ...config, criticality: c }, now: step(i) });
  const st = db.raw.prepare("SELECT * FROM items WHERE id = 'CRIT-STALL-2026-11-10'").get();
  assert.ok(st); assert.equal(st.priority, crit.origination.head_priority); assert.equal(st.closing_probe, 'criticality:stall');
  assert.ok(hist(db).some(h => h.stalled === 1));
  const rising = makeDb();
  for (let i = 0; i < 4; i++) {
    if (i === 2) rising.raw.prepare("INSERT INTO criticality_samples (at, source, deploys_ok, spend_units) VALUES (?, 't', 1, 3)").run(iso(step(2) - 1000));
    await runTick(rising, { config: { ...config, criticality: c }, now: step(i) });
  }
  assert.equal(rising.raw.prepare("SELECT COUNT(*) n FROM items WHERE id LIKE 'CRIT-STALL-%'").get().n, 0, 'a rise in k_eff is not a stall');
});

test('US-26-R36: the loop is beating while its last beat is no older than twice beat_interval_s, and reports the lever and how its predictions graded', async () => {
  const db = makeDb();
  assert.deepEqual((await loopHealth(db, crit, NOW)).predictions, { hit: 0, miss: 0, open: 0 });
  assert.equal((await loopHealth(db, crit, NOW)).beating, false, 'a loop that never beat is not beating');
  for (let i = 0; i < 3; i++) await runTick(db, { config, now: step(i) });
  const h = await loopHealth(db, crit, step(2) + 1000);
  assert.equal(h.beating, true); assert.equal(h.max_age_s, 1200); assert.equal(h.mode, RAISE); assert.equal(h.regime, 'subcritical'); assert.equal(h.predictions.open, 1);
  assert.equal((await loopHealth(db, crit, step(2) + 1200e3 + 5000)).beating, false);
  assert.equal((await loopHealth(db, null, step(2) + 1000)).max_age_s, 1200, 'without a control block the default interval is 600 s');
});

test('US-26-R14: /health carries the compact stage reading and /live the full snapshot with k_eff, the loop health and the log', async () => {
  const db = makeDb();
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m')");
  const ign = await ignitionStep(db, ctxOf({ pulse: null }), ensureItem);
  assert.equal(ign.blocking.stage, 'ticking');
  const res = await get(db, '/health');
  assert.equal(res.status, 503, 'no finished tick, so the heartbeat is not ok');
  const j = await res.json();
  assert.deepEqual(Object.keys(j.ignition).sort(), ['at', 'blocking', 'since', 'stage']);
  assert.deepEqual(Object.keys(j.ignition.blocking).sort(), ['stage', 'why']); assert.equal(j.ignition.stage, 'seeded'); assert.ok(j.ignition.blocking.why.length <= 400);
  db.raw.exec("INSERT INTO tick_runs (started_at, finished_at, steps_completed, steps_total) VALUES ('2026-11-10 00:00:00', '2026-11-10 00:00:05', 19, 19)");
  assert.equal((await get(db, '/health')).status, 200);
  await stepOf(db, { dispatched: 1 });
  const live = await (await get(db, '/live')).json();
  assert.equal(live.ok, true); assert.equal(typeof live.k_eff, 'number'); assert.ok('k_self' in live && 'self_regime' in live && 'open_ignition_gaps' in live && 'self_sustaining' in live);
  assert.equal(live.ignition.stage, 'seeded'); assert.ok(Array.isArray(live.ignition.log) && live.ignition.log[0].direction === 'first'); assert.ok(live.ignition.holds);
  assert.equal(live.criticality_loop.last_beat, iso(NOW)); assert.equal(typeof live.criticality_loop.age_s, 'number');
  const metric = await (await get(db, '/metrics/criticality.json')).json();
  assert.equal(metric.k_eff, live.k_eff); assert.ok(metric.loop);
});
