import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { runTick, STEP_ORDER, reliability, lastTickForHealth } from '../src/tick.js';
import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const T0 = Date.parse('2026-11-10T00:00:00Z');

function seed(db) {
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m'), ('op-1','operations',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('A','a','staff','x',10,'open'), ('B','b','staff','x',20,'open');
    INSERT INTO items (id,title,owner_role,done_check,trigger_on,status) VALUES ('C','c','staff','x','A','open');`);
}

test('a tick runs every step and dispatches in priority order', async () => {
  const db = makeDb(); seed(db);
  const r = await runTick(db, { config, now: T0 });
  assert.equal(r.completed, STEP_ORDER.length);
  assert.deepEqual(r.errors, []);
  const claims = db.raw.prepare('SELECT item_id FROM claims').all().map(x => x.item_id);
  assert.deepEqual(claims, ['A']);
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='C'").get().status, 'open'); // trigger not done
  assert.match(r.report, /^Happened:/); assert.match(r.report, /Open:/);
});

test('a failing step never kills the tick and becomes a backlog item', async () => {
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

test('HEALTH-INFLIGHT-1: health ignores a tick in flight, but an unfinished tick older than 5 minutes is the newest row', async () => {
  const db = makeDb(); seed(db);
  await runTick(db, { config, now: T0 });
  db.raw.prepare(`INSERT INTO tick_runs (started_at, steps_total) VALUES (?, 8)`).run('2026-11-10 00:10:00');
  const live = await lastTickForHealth(db, T0 + 10 * 60e3 + 5e3);
  assert.equal(live.steps_completed, live.steps_total); // the finished tick, so /health stays 200 during a tick
  const stuck = await lastTickForHealth(db, T0 + 10 * 60e3 + 301e3);
  assert.notEqual(stuck.steps_completed, stuck.steps_total); // stuck for over 5 minutes: 503
});

// Q-LESSON-COST-SAMPLE-ACT: a D1 rows-read sample over its hourly cap holds the next tick to its essential steps for the hour.
test('over_budget reads the latest sample per budget within the hour; a failed sample is not a breach', async () => {
  const { over_budget } = await import('../src/costsample.js');
  const db = makeDb();
  const at = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  const budgets = [{ id: 'org', max_rows_read_per_hour: 100 }, { id: 'ops', max_rows_read_per_hour: 50 }];
  assert.deepEqual(await over_budget(db, budgets, T0), { over: false, breaches: [], advisory: [] }, 'no samples, no breach');
  db.raw.prepare('INSERT INTO cost_samples (at, target, rows_read_1h) VALUES (?,?,?)').run(at(T0 - 7200e3), 'org', 999);
  assert.equal((await over_budget(db, budgets, T0)).over, false, 'a sample older than the hour has expired');
  db.raw.prepare('INSERT INTO cost_samples (at, target, rows_read_1h) VALUES (?,?,?)').run(at(T0 - 600e3), 'org', 150);
  db.raw.prepare('INSERT INTO cost_samples (at, target, rows_read_1h, error) VALUES (?,?,?,?)').run(at(T0 - 300e3), 'ops', null, 'graphql 500');
  const r = await over_budget(db, budgets, T0);
  assert.equal(r.over, true); assert.deepEqual(r.breaches.map(b => [b.target, b.rows_read_1h, b.max_rows_read_per_hour]), [['org', 150, 100]]);
  db.raw.prepare('INSERT INTO cost_samples (at, target, rows_read_1h) VALUES (?,?,?)').run(at(T0 - 60e3), 'org', 90);
  assert.equal((await over_budget(db, budgets, T0)).over, false, 'a newer sample back under the cap releases it');
  assert.equal((await over_budget(db, null, T0)).over, false, 'no budgets configured');
});

test('OPS-QUEUE-1: a breach of a database the tick does not read (gates_tick:false) is advisory and never holds dispatch', async () => {
  const { over_budget } = await import('../src/costsample.js');
  const db = makeDb();
  const at = new Date(T0 - 60e3).toISOString().replace('T', ' ').slice(0, 19);
  db.raw.prepare('INSERT INTO cost_samples (at, target, rows_read_1h) VALUES (?,?,?)').run(at, 'ops', 52524);
  const r = await over_budget(db, [{ id: 'ops', max_rows_read_per_hour: 50000, gates_tick: false }], T0);
  assert.equal(r.over, false); assert.deepEqual(r.breaches, []); assert.equal(r.advisory[0].target, 'ops');
});

test('a breached D1 budget skips the non-essential steps, records the breach and caps origination to a cost cut', async () => {
  const { COST_ESSENTIAL_STEPS } = await import('../src/tick.js');
  const crit = JSON.parse(readFileSync(new URL('../../autonomy/criticality.json', import.meta.url), 'utf8'));
  const db = makeDb(); seed(db);
  const at = new Date(T0 - 600e3).toISOString().replace('T', ' ').slice(0, 19);
  db.raw.prepare('INSERT INTO cost_samples (at, target, rows_read_1h) VALUES (?,?,?)').run(at, 'org', 500000);
  const cfg = { ...config, criticality: crit, cost_budgets: [{ id: 'org', max_rows_read_per_hour: 120000 }] };
  const r = await runTick(db, { config: cfg, now: T0 });
  assert.deepEqual(COST_ESSENTIAL_STEPS, ['migrate', 'reconcile', 'measure', 'criticality']);
  assert.equal(r.completed, STEP_ORDER.length, 'a skip is a decision, not a failure: health stays green');
  assert.deepEqual(r.errors, []);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM claims').get().n, 0, 'dispatch was skipped');
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM dispatches').get().n, 0);
  assert.match(r.report, /cost breach: org read 500000 rows\/h > 120000; skipped non-essential steps \(reap_claims, connector_health, probe_gates/);
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='A'").get().status, 'ready', 'reconcile still ran');
  const breach = JSON.parse(db.raw.prepare("SELECT value FROM org WHERE key='cost_breach'").get().value);
  assert.equal(breach.breaches[0].target, 'org');
  const snap = JSON.parse(db.raw.prepare("SELECT value FROM org WHERE key='criticality'").get().value);
  assert.equal(snap.cap_breached, 1, 'criticality treats it as a breached spend cap');
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM items WHERE id LIKE 'IDLE-%'").get().n, 0, 'a lean tick files no idle item');
  assert.equal(snap.originated_now && snap.originated_now.kind, 'cost_cut', 'only a cost cut is originated while the budget is breached');

  const T1 = T0 + 3700e3;  // the hour passes with no new breach: the full tick runs again
  const r2 = await runTick(db, { config: cfg, now: T1 });
  assert.doesNotMatch(r2.report, /cost breach/);
  assert.ok(db.raw.prepare('SELECT COUNT(*) n FROM dispatches').get().n >= 1, 'dispatch resumed');
});

// CONNECTOR-HEALTH-1
test('connector health: last_ok and expires_at each tick; two failed refreshes raise one reconnect card that closes when the connector is ok', async () => {
  const { ensureSchema } = await import('../src/auth/store.js');
  const db = makeDb(); seed(db); await ensureSchema(db);
  const now = Date.parse('2026-11-20T12:00:00Z'), env = { PUBLIC_ORIGIN: 'https://example.test/' };
  await db.prepare("INSERT INTO credentials (tenant, provider, status, expires_at) VALUES ('t', 'google', 'ok', '2026-11-20T18:00:00Z'), ('t', 'github-app', 'failed', NULL)").run();
  await db.prepare("INSERT INTO credential_events (at, tenant, provider, event) VALUES ('2026-11-20T11:00:00Z', 't', 'google', 'refreshed'), ('2026-11-20T10:00:00Z', 't', 'github-app', 'minted'), ('2026-11-20T11:40:00Z', 't', 'github-app', 'failed')").run();
  const { STEPS } = await import('../src/tick.js');
  const ctx = () => ({ nowIso: new Date(now).toISOString(), env, config: { org_slug: 't' }, notes: [] });
  let c = ctx(); await STEPS.connector_health(db, c);
  assert.deepEqual(c.connectors.find(x => x.provider === 'google'), { provider: 'google', status: 'ok', last_ok: '2026-11-20T11:00:00Z', expires_at: '2026-11-20T18:00:00Z', expires_in_h: 6, failures: 0 });
  const cards = async () => (await db.prepare("SELECT id, status, prepared_by_fleet, closing_probe FROM gate_cards WHERE id LIKE 'GATE-RECONNECT-%'").all()).results;
  assert.equal((await cards()).length, 0, 'one failure is not a card');
  await db.prepare("INSERT INTO credential_events (at, tenant, provider, event) VALUES ('2026-11-20T11:50:00Z', 't', 'github-app', 'failed')").run();
  c = ctx(); await STEPS.connector_health(db, c); await STEPS.connector_health(db, ctx());
  const open = await cards();
  assert.equal(open.length, 1, 'one card, however many ticks see the failure');
  assert.equal(open[0].prepared_by_fleet, 'https://example.test/connect/github');
  assert.equal(c.connectors.find(x => x.provider === 'github-app').last_ok, '2026-11-20T10:00:00Z');
  c = ctx(); await STEPS.probe_gates(db, c);
  assert.equal((await cards())[0].status, 'open');
  await db.prepare("UPDATE credentials SET status = 'ok' WHERE provider = 'github-app'").run();
  await STEPS.probe_gates(db, ctx());
  assert.equal((await cards())[0].status, 'closed');
});
