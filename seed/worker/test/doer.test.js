// DOER-1 (workers#173): every dispatched item ends done, parked with a reason, or waiting; the reaper never releases an unworked claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { runTick } from '../src/tick.js';
import { OWNER_ONLY, claimsReleasedUnworked24h } from '../src/doer.js';
import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const T0 = Date.parse('2026-11-14T00:00:00Z');
const status = (db, id) => db.raw.prepare('SELECT status, blocker, disposition FROM items WHERE id=?').get(id);

// A fake Workers AI binding: answers every call with `answer` and counts calls.
const fakeAi = answer => { const ai = { calls: 0, async run() { ai.calls++; return { response: JSON.stringify(answer) }; } }; return ai; };

function seed(db, items) {
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m'), ('op-1','operations',1,'m'), ('pm-1','portfolio-manager',1,'m')");
  const ins = db.raw.prepare("INSERT INTO items (id,title,owner_role,done_check,closing_probe,priority,status,created_at) VALUES (?,?,?,?,?,?,'ready',?)");
  for (const i of items) ins.run(i.id, i.title, i.owner_role || 'staff', i.done_check || 'x', i.closing_probe || null, i.priority ?? 10, i.created_at || '2026-11-13 00:00:00');
}

test('owner-only items are parked behind one gate card and never re-dispatched', async () => {
  const db = makeDb();
  seed(db, [{ id: 'FN-2', title: 'FN-2: Google for Startups Cloud Program application', done_check: 'Submission confirmation' }]);
  await runTick(db, { config, now: T0 });
  const s = status(db, 'FN-2');
  assert.equal(s.status, 'blocked'); assert.match(s.blocker, /^owner-only:/);
  assert.equal(db.raw.prepare("SELECT status FROM gate_cards WHERE id='GATE-OWNER-ITEMS'").get().status, 'open');
  assert.equal(db.raw.prepare("SELECT result FROM outcomes WHERE item_id='FN-2'").get().result, 'parked');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM claims').get().n, 0);
  await runTick(db, { config, now: T0 + 600e3 });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM dispatches WHERE item_id='FN-2'").get().n, 1, 'not dispatched again');
});

test('the owner gate closes itself when no owner-only item is left', async () => {
  const db = makeDb();
  seed(db, [{ id: 'FN-3', title: 'FN-3: Cloudflare for Startups application', done_check: 'Submission confirmation' }]);
  await runTick(db, { config, now: T0 });
  db.raw.exec("UPDATE items SET status='done', disposition='owner submitted' WHERE id='FN-3'");
  await runTick(db, { config, now: T0 + 600e3 });
  assert.equal(db.raw.prepare("SELECT status FROM gate_cards WHERE id='GATE-OWNER-ITEMS'").get().status, 'closed');
});

test('a TICKFAIL item closes when a later tick completed the step', async () => {
  const db = makeDb();
  seed(db, [{ id: 'TICKFAIL-measure-2026-11-13T08', title: 'Tick step measure failed', owner_role: 'operations', done_check: 'next tick completes step measure', priority: 0 }]);
  db.raw.exec("INSERT INTO tick_runs (started_at, finished_at, steps_total, steps_completed) VALUES ('2026-11-13 09:00:00','2026-11-13 09:00:05',10,10)");
  await runTick(db, { config, now: T0 });
  const s = status(db, 'TICKFAIL-measure-2026-11-13T08');
  assert.equal(s.status, 'done'); assert.match(s.disposition, /completed step measure/);
  assert.equal(db.raw.prepare("SELECT result FROM outcomes WHERE item_id='TICKFAIL-measure-2026-11-13T08'").get().result, 'verified');
});

test('a LOOPBREAK item unblocks its target and closes; the target then reaches the doer', async () => {
  const db = makeDb();
  seed(db, [{ id: 'LOOPBREAK-BIZ-1', title: 'Dispatch of BIZ-1 failed', owner_role: 'operations', done_check: 'item BIZ-1 has an outcome', priority: 0 }]);
  db.raw.exec("INSERT INTO items (id,title,owner_role,done_check,priority,status,blocker) VALUES ('BIZ-1','BIZ-1: Choose owning entity','staff','Entity named',10,'blocked','loop-breaker: dispatched 28 times with no outcome')");
  await runTick(db, { config, now: T0 });
  assert.equal(status(db, 'LOOPBREAK-BIZ-1').status, 'done');
  assert.equal(status(db, 'BIZ-1').status, 'ready');
  await runTick(db, { config, now: T0 + 600e3 });
  assert.match(status(db, 'BIZ-1').blocker, /^owner-only:/, 'the target is now parked with a reason instead of looping');
});

test('probe-gated selfaudit items are parked, not looped', async () => {
  const db = makeDb();
  seed(db, [{ id: 'FM-x', title: 'Failure mode x is red', owner_role: 'operations', closing_probe: 'selfaudit:x', priority: -1 }]);
  await runTick(db, { config, now: T0 });
  assert.match(status(db, 'FM-x').blocker, /^probe-gated:/);
});

test('successor items are filed through Workers AI and the NEXT item is done', async () => {
  const db = makeDb();
  seed(db, [{ id: 'NEXT-SG-3', title: 'Successor of SG-3', owner_role: 'operations', closing_probe: 'successor:SG-3', done_check: 'a new item is filed', priority: 20 }]);
  const ai = fakeAi({ title: 'Add a forge health probe', owner_role: 'operations', done_check: 'probe returns 200', closing_probe: 'GET /forge/health' });
  await runTick(db, { config, now: T0, ai });
  assert.equal(status(db, 'NEXT-SG-3').status, 'done');
  const filed = db.raw.prepare("SELECT owner_role, kind, title FROM items WHERE id='PLUS-SG-3'").get();
  assert.equal(filed.owner_role, 'operations'); assert.equal(filed.kind, 'plus');
  assert.equal(ai.calls, 1);
});

test('an invalid model answer parks the item with the reason', async () => {
  const db = makeDb();
  seed(db, [{ id: 'NEXT-SG-6', title: 'Successor of SG-6', owner_role: 'operations', closing_probe: 'successor:SG-6', priority: 20 }]);
  await runTick(db, { config, now: T0, ai: fakeAi({ title: 'x', owner_role: 'nobody', done_check: 'y' }) });
  assert.match(status(db, 'NEXT-SG-6').blocker, /model answer invalid/);
});

test('generic items are triaged by the model and parked with verdict and first step', async () => {
  const db = makeDb();
  seed(db, [{ id: 'PR-4', title: 'PR-4: Pricing hypotheses', done_check: 'see roadmap' }]);
  await runTick(db, { config, now: T0, ai: fakeAi({ verdict: 'needs_research', reason: 'needs market data', first_step: 'list three comparable platforms' }) });
  const s = status(db, 'PR-4');
  assert.equal(s.status, 'blocked'); assert.match(s.blocker, /^needs-research: needs market data/);
});

test('without the AI binding a generic item waits with its claim kept (loop-breaker still applies)', async () => {
  const db = makeDb();
  seed(db, [{ id: 'PR-1', title: 'PR-1: Positioning', done_check: 'see roadmap' }]);
  await runTick(db, { config, now: T0 });
  assert.equal(status(db, 'PR-1').status, 'claimed');
  assert.equal(db.raw.prepare("SELECT status FROM dispatches WHERE item_id='PR-1'").get().status, 'queued');
});

test('model calls per tick are capped', async () => {
  const db = makeDb();
  seed(db, ['A', 'B', 'C'].map(id => ({ id: `W-${id}`, title: `work ${id}`, owner_role: ['staff', 'operations', 'portfolio-manager'][id.charCodeAt(0) - 65] })));
  const ai = fakeAi({ verdict: 'needs_code', reason: 'r', first_step: 's' });
  await runTick(db, { config: { ...config, doer_max_ai: 2 }, now: T0, ai });
  assert.equal(ai.calls, 2);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE status='claimed'").get().n, 1);
});

test('claims_released_unworked_24h counts reaper releases of unworked claims', async () => {
  const db = makeDb();
  seed(db, [{ id: 'PR-3', title: 'PR-3: case study', done_check: 'Page on the site' }]);
  await runTick(db, { config, now: T0 });
  await runTick(db, { config, now: T0 + 3 * 3600e3 });
  assert.equal(await claimsReleasedUnworked24h(db, T0 + 3 * 3600e3), 1);
});

test('owner-only matcher: identity-bound work yes, research and code no', () => {
  for (const t of ['FUND-3: OC-3 owner card: form entity and assign IP', 'FN-2: Google for Startups Cloud Program application Submission confirmation', 'FUND-1: OC-1 owner card: filing']) assert.ok(OWNER_ONLY.test(t), t);
  for (const t of ['FN-4: Other credit programs Ranked list with eligibility', 'WEB-4: robots, sitemap, OG tags, analytics', 'SG-1: stop depending on github']) assert.ok(!OWNER_ONLY.test(t), t);
});

// MODEL-TRUTH-1: a dispatch row names the model that really ran (or that a rule settled it), never the role's configured tier label.
test('dispatch rows record the model that answered, or rules when no model ran', async () => {
  const db = makeDb();
  seed(db, [{ id: 'W-M', title: 'work m' }, { id: 'FN-9', title: 'FN-9: Cloudflare for Startups application', done_check: 'Submission confirmation', owner_role: 'operations' }]);
  const ai = fakeAi({ verdict: 'needs_code', reason: 'r', first_step: 's' });
  await runTick(db, { config, now: T0, ai });
  const m = id => db.raw.prepare('SELECT model FROM dispatches WHERE item_id=?').get(id).model;
  assert.match(m('W-M'), /^@cf\//, 'the Workers AI model that answered');
  assert.equal(m('FN-9'), 'rules (no model)');
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM dispatches WHERE model='m'").get().n, 0, 'the roles.model label never reaches a dispatch row');
});

// MODEL-REPLY-1 + PLAN-SKIP-1: an object `response` is accepted, and a model the plan lacks is skipped without blocking the next one.
test('object replies and plan-blocked models do not stop the doer', async () => {
  const db = makeDb();
  seed(db, [{ id: 'PR-5', title: 'PR-5: Pricing hypotheses', done_check: 'see roadmap' }]);
  const ai = { calls: [], async run(model) { ai.calls.push(model); if (/glm/.test(model)) throw new Error('5035: Model is not available on the Workers Free plan.'); return { response: { verdict: 'needs_research', reason: 'needs data', first_step: 'list three' } }; } };
  await runTick(db, { config, now: T0, ai });
  const s = status(db, 'PR-5');
  assert.equal(s.status, 'blocked'); assert.match(s.blocker, /^needs-research: needs data/);
});
