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

test('US-06-R07, US-06-T07: a severe outcome older than the stated window no longer demotes, and one inside it does', async () => {
  const days = policy.ladder.promote_when.no_hidden_failure_days;
  const at = (d) => new Date(T0 - d * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  const db = makeDb(); seed(db);
  db.raw.exec("INSERT INTO trust_ledger (surface,action_class,rung,reliability) VALUES ('repo','merge_pr_green','autonomous',0.9)");
  for (let i = 0; i < 12; i++) db.raw.exec("INSERT INTO outcomes (surface,action_class,result) VALUES ('repo','merge_pr_green','verified')");
  db.raw.prepare("INSERT INTO outcomes (surface,action_class,result,at) VALUES ('repo','merge_pr_green','hidden_failure',?)").run(at(days + 1));
  await runTick(db, { config, now: T0 });
  assert.equal(db.raw.prepare("SELECT id FROM items WHERE id LIKE 'LADDER-repo-merge_pr_green-delegated%'").get(), undefined);
  db.raw.prepare("INSERT INTO outcomes (surface,action_class,result,at) VALUES ('repo','merge_pr_green','silent_drop',?)").run(at(days - 1));
  await runTick(db, { config, now: T0 + 600e3 });
  assert.ok(db.raw.prepare("SELECT id FROM items WHERE id = 'LADDER-repo-merge_pr_green-delegated'").get());
  // a policy that states no window counts all time, as before
  const allTime = structuredClone(policy); delete allTime.ladder.promote_when.no_hidden_failure_days;
  const db2 = makeDb(); seed(db2);
  db2.raw.exec("INSERT INTO trust_ledger (surface,action_class,rung,reliability) VALUES ('repo','merge_pr_green','autonomous',0.9)");
  for (let i = 0; i < 12; i++) db2.raw.exec("INSERT INTO outcomes (surface,action_class,result) VALUES ('repo','merge_pr_green','verified')");
  db2.raw.prepare("INSERT INTO outcomes (surface,action_class,result,at) VALUES ('repo','merge_pr_green','hidden_failure',?)").run(at(400));
  await runTick(db2, { config: { ...config, policy: allTime }, now: T0 });
  assert.ok(db2.raw.prepare("SELECT id FROM items WHERE id = 'LADDER-repo-merge_pr_green-delegated'").get());
});

test('US-06-R05, US-06-R20, US-06-T08: a crossing that repeats after its ladder item closed opens a new dated item; the rung is still not changed by the tick', async () => {
  const db = makeDb(); seed(db);
  db.raw.exec("INSERT INTO trust_ledger (surface,action_class,rung,reliability) VALUES ('repo','merge_pr_green','autonomous',0.9)");
  db.raw.exec("INSERT INTO items (id,title,kind,owner_role,done_check,status,disposition) VALUES ('LADDER-repo-merge_pr_green-delegated','old','ladder','operations','x','done','fixed: earlier demotion merged')");
  db.raw.prepare("INSERT INTO outcomes (surface,action_class,result,at) VALUES ('repo','merge_pr_green','hidden_failure',?)").run(new Date(T0 - 3600e3).toISOString().slice(0, 19).replace('T', ' '));
  await runTick(db, { config, now: T0 });
  assert.ok(db.raw.prepare("SELECT id FROM items WHERE id = 'LADDER-repo-merge_pr_green-delegated-2026-11-10' AND status <> 'done'").get());
  assert.equal(db.raw.prepare("SELECT rung FROM trust_ledger WHERE surface='repo' AND action_class='merge_pr_green'").get().rung, 'autonomous');
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
  const r = await runTick(db, { config: cfg, now: T0 + 15 * 60e3 });  // SPEND-SOFT-1: off the three-hour boundary, so the deferred steps wait
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
test('US-06-R22: connector health: last_ok and expires_at each tick; two failed refreshes raise one reconnect card that closes when the connector is ok', async () => {
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

test('SPEND-SOFT-1: no step is skipped for good; lean defers to every 3 h, spend crawl keeps the queue moving', async () => {
  const { stepPlan } = await import('../src/tick.js');
  const off = Date.parse('2026-11-10T01:15:00Z'), on = Date.parse('2026-11-10T03:05:00Z');
  assert.equal(stepPlan('pulse', { lean: true, now: off }), 'defer');
  assert.equal(stepPlan('pulse', { lean: true, now: on }), 'run');
  const crawl = { level: 'crawl', knobs: { wide_every_h: 6, extra_every_h: 3 } };
  for (const s of ['dispatch', 'execute', 'reap_claims', 'measure']) assert.equal(stepPlan(s, { spend: crawl, now: off }), 'run', s);
  assert.equal(stepPlan('unknowns', { spend: crawl, now: off }), 'defer');
  assert.equal(stepPlan('unknowns', { spend: crawl, now: on }), 'run');
  assert.equal(stepPlan('pulse', { spend: { level: 'throttle', knobs: { wide_every_h: 1 } }, now: off }), 'defer');
  assert.equal(stepPlan('pulse', { spend: { level: 'throttle', knobs: { wide_every_h: 1 } }, now: on }), 'run');
  assert.equal(stepPlan('pulse', { spend: { level: 'ease', knobs: {} }, now: off }), 'run');
});

// US-SPEC-04 section 3 (plus share check) on the seed tick: US-04-T01 and US-04-T02.
function doneItems(db, n, plus) {
  const ins = db.raw.prepare(`INSERT INTO items (id,title,kind,owner_role,done_check,status,disposition,updated_at) VALUES (?,?,?,?,?,'done','done: probe passed',?)`);
  for (let i = 0; i < n; i++) ins.run(`D${String(i).padStart(2, '0')}`, 'd', i < plus ? 'plus' : 'fix', 'staff', 'x', `2026-11-09 ${String(i).padStart(2, '0')}:00:00`);
}

test('US-04-T01: 1 plus in the last 20 done items is under half the target, so one REBALANCE item opens for the portfolio manager at priority 5', async () => {
  const db = makeDb(); doneItems(db, 20, 1);
  const r = await runTick(db, { config, now: T0 });
  assert.deepEqual(r.errors, []);
  const rows = db.raw.prepare("SELECT id, kind, owner_role, priority, status FROM items WHERE id LIKE 'REBALANCE-%'").all();
  assert.deepEqual(rows.map(x => ({ ...x })), [{ id: 'REBALANCE-2026-11-10', kind: 'fix', owner_role: 'portfolio-manager', priority: 5, status: 'ready' }]);
  await runTick(db, { config, now: T0 + 600e3 });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'REBALANCE-%'").get().n, 1, 'one per day, deduplicated by identifier');
});

test('US-04-T02: fewer than 10 done items is too few to judge, and a share at the target opens nothing', async () => {
  const few = makeDb(); doneItems(few, 9, 0);
  await runTick(few, { config, now: T0 });
  assert.equal(few.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'REBALANCE-%'").get().n, 0);
  const ok = makeDb(); doneItems(ok, 20, 4);
  await runTick(ok, { config, now: T0 });
  assert.equal(ok.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'REBALANCE-%'").get().n, 0);
  const edge = makeDb(); doneItems(edge, 20, 2);  // 0.10 is half of 0.2: not below it
  await runTick(edge, { config, now: T0 });
  assert.equal(edge.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'REBALANCE-%'").get().n, 0);
});

test('US-04-R02 window: only the 20 most recently closed items are read, and another tenant\'s done items are not counted', async () => {
  const db = makeDb(); doneItems(db, 20, 0);
  const old = db.raw.prepare(`INSERT INTO items (id,title,kind,owner_role,done_check,status,disposition,updated_at) VALUES (?,?,'plus','staff','x','done','done: old','2026-10-01 00:00:00')`);
  for (let i = 0; i < 10; i++) old.run(`OLD${i}`, 'old plus');
  const other = db.raw.prepare(`INSERT INTO items (id,title,kind,owner_role,done_check,status,disposition,updated_at,tenant_id) VALUES (?,?,'plus','staff','x','done','done: theirs','2026-11-09 23:59:00','other')`);
  for (let i = 0; i < 10; i++) other.run(`FOREIGN${i}`, 'their plus');
  await runTick(db, { config, now: T0 });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'REBALANCE-%'").get().n, 1);
});

// US-SPEC-08 (US-08-R17): nothing ages silently in the seed tick.
test('US-08-R17, US-08-T08: an item open or ready past 120 minutes is raised to priority 5 and one AGE-120M item a day names the cause to find; a younger or more urgent item is left alone', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,priority,status,created_at) VALUES
    ('OLD','old','nobody','x',40,'ready','2026-11-09 21:00:00'), ('URGENT','urgent','nobody','x',1,'ready','2026-11-09 21:00:00'),
    ('YOUNG','young','nobody','x',40,'ready','2026-11-09 23:30:00'), ('PARKED','parked','nobody','x',40,'blocked','2026-11-09 21:00:00')`);
  const r = await runTick(db, { config, now: T0 });
  assert.deepEqual(r.errors, []);
  const p = id => db.raw.prepare('SELECT priority FROM items WHERE id=?').get(id).priority;
  assert.deepEqual([p('OLD'), p('URGENT'), p('YOUNG'), p('PARKED')], [5, 1, 40, 40]);
  const cause = db.raw.prepare("SELECT owner_role, priority, title FROM items WHERE id='AGE-120M-2026-11-10'").get();
  assert.equal(cause.owner_role, 'operations'); assert.equal(cause.priority, 5); assert.match(cause.title, /^2 item\(s\) open past 120 minutes/);
  assert.match(r.report, /over_120m: 2 item\(s\) raised, cause item filed/);
  await runTick(db, { config, now: T0 + 600e3 });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'AGE-120M-%'").get().n, 1);
});

test('US-08-R17: with nothing past 120 minutes no cause item is filed', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,priority,status,created_at) VALUES ('YOUNG','young','nobody','x',40,'ready','2026-11-09 23:30:00')`);
  await runTick(db, { config, now: T0 });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'AGE-120M-%'").get().n, 0);
});

// US-SPEC-02 (US-02-R15): an event wakes its role out of turn; the role's own items and its work-in-progress cap still rule.
test('US-02-R15: a role that is not due is dispatched when an event wakes it, takes only its own item, and stays under its cap', async () => {
  const setup = () => { const db = makeDb(); db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('pm-1','portfolio-manager',6,'m'), ('staff-1','staff',6,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('P1','p','portfolio-manager','x',10,'ready'), ('S1','s','staff','x',1,'ready');`); return db; };
  const claimed = db => db.raw.prepare('SELECT item_id, agent FROM claims ORDER BY item_id').all().map(x => ({ ...x }));
  const quiet = setup();
  await runTick(quiet, { config, now: T0 });
  assert.deepEqual(claimed(quiet), [], 'tick 1 of a role that ticks every 6: not due, nothing dispatched');
  const woken = setup();
  await runTick(woken, { config, now: T0, wake: 'portfolio-manager' });
  assert.deepEqual(claimed(woken), [{ item_id: 'P1', agent: 'pm-1' }], 'the woken role takes its own item; the staff item waits for staff');
  const full = setup();
  full.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('W1','w','portfolio-manager','x','claimed'), ('W2','w','portfolio-manager','x','claimed'), ('W3','w','portfolio-manager','x','claimed');
    INSERT INTO claims (item_id, agent, claimed_at, heartbeat_at) VALUES ('W1','pm-1','2026-11-09 23:59:00','2026-11-09 23:59:00'), ('W2','pm-1','2026-11-09 23:59:00','2026-11-09 23:59:00'), ('W3','pm-1','2026-11-09 23:59:00','2026-11-09 23:59:00')`);
  await runTick(full, { config: { ...config, doer_max_items: 0 }, now: T0, wake: 'portfolio-manager' });
  assert.equal(full.raw.prepare("SELECT status FROM items WHERE id='P1'").get().status, 'ready', 'at the cap a woken role takes nothing more');
});

test('age_sla (SLA-120M): an item open past 120 minutes is raised to priority 5 and the cause is filed once a day; a newer item is left alone', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status,disposition,created_at) VALUES
      ('OLD','old','nobody','x',40,'open',NULL,'2026-11-09 20:00:00'), ('OLDTOP','old and already first','nobody','x',2,'ready',NULL,'2026-11-09 20:00:00'),
      ('NEW','new','nobody','x',40,'open',NULL,'2026-11-09 23:00:00'), ('CLOSED','closed with its disposition','nobody','x',40,'done','fixed','2026-11-09 20:00:00');`);
  const r = await runTick(db, { config, now: T0 });
  assert.deepEqual(r.errors, []);
  const pri = id => db.raw.prepare('SELECT priority FROM items WHERE id = ?').get(id).priority;
  assert.deepEqual([pri('OLD'), pri('OLDTOP'), pri('NEW'), pri('CLOSED')], [5, 2, 40, 40]);
  const cause = db.raw.prepare(`SELECT title, owner_role, priority, kind FROM items WHERE id = 'AGE-120M-2026-11-10'`).get();
  assert.deepEqual([cause.owner_role, cause.priority, cause.kind], ['operations', 5, 'fix']);
  assert.match(cause.title, /^2 item\(s\) open past 120 minutes/);
  assert.match(r.report, /over_120m: 2 item\(s\) raised, cause item filed/);
  await runTick(db, { config, now: T0 + 10 * 60e3 });
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM items WHERE id LIKE 'AGE-120M-%'`).get().n, 1);   // once a day, not once a tick
});
