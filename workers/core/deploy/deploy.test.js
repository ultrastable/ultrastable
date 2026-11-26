// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createHash } from 'node:crypto';
import { createDeploy, dbLock } from './index.js';
import { step as opsStep } from './agent.js';
import * as Trust from '../trust/index.js';
import * as Predict from '../predict/index.js';

const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
const SECRET = 'tok-very-secret-value';

function fakeDeployer(live = 'v1', opts = {}) {
  const s = { live, calls: [] };
  return Object.assign(s, {
    async liveVersion() { return s.live; },
    async publish(unit, artifact) { s.calls.push('publish'); s.live = artifact.version; return { version: artifact.version }; },
    async rollback(unit, to) { s.calls.push('rollback'); if (!opts.brokenRollback) s.live = to; },
  });
}
// healthy flag drives the health endpoint; body reports the version.
function fakeFetch(state) {
  return async (url) => new Response(state.healthy ? `{"ok":true,"version":"${state.version}"}` : 'down', { status: state.healthy ? 200 : 500 });
}
function setup(over = {}) {
  const db = makeDb([MIG]);
  const deployer = over.deployer || fakeDeployer();
  const web = { healthy: true, version: 'v2' };
  let t = Date.parse('2026-11-11T00:00:00Z');
  const clock = { now: () => t, sleep: async (ms) => { t += ms; } };
  const d = createDeploy({ db, deployer, fetch: fakeFetch(web), now: clock.now, sleep: clock.sleep, env: { DEPLOY_TOKEN: SECRET },
    config: { windowMs: 6000, intervalMs: 2000, ...(over.config || {}) },
    probes: { api: [{ kind: 'http', url: 'https://svc.example/health', contains: ['"ok":true'], version: true }] }, ...(over.extra || {}) });
  return { db, deployer, web, d, clock };
}
const art = (v, body = 'code-' + v) => ({ version: v, body });
const rows = async (db, sql) => (await db.prepare(sql).all()).results;

test('migration is idempotent and tables are deploy_ prefixed', async () => {
  const sql = readFileSync(MIG + '0001_deploy.sql', 'utf8');
  const { db } = setup();
  db.raw.exec(sql);
  const names = (await rows(db, `SELECT name FROM sqlite_master WHERE name LIKE 'deploy\\_%' ESCAPE '\\' AND type='table'`)).map(r => r.name);
  assert.ok(names.includes('deploy_ledger') && names.includes('deploy_lock'));
});

test('US-07-T05 / R12: passing probes keep the deploy', async () => {
  const { d, deployer, db } = setup();
  const r = await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1', actor: 'agent-a' });
  assert.equal(r.status, 'kept');
  assert.equal(deployer.live, 'v2');
  const [row] = await d.ledger('api');
  assert.equal(row.from_version, 'v1'); assert.equal(row.to_version, 'v2'); assert.equal(row.actor, 'agent-a');
  assert.match(row.artifact_sha256, /^[0-9a-f]{64}$/);
  assert.ok(row.finished_at);
  assert.equal((await rows(db, `SELECT * FROM deploy_lock`)).length, 0); // lock released
});

test('US-07-R12 / US-14-R08: failing probe rolls back automatically and records why', async () => {
  const { d, deployer, web } = setup();
  web.healthy = false;
  const r = await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1', actor: 'a' });
  assert.equal(r.status, 'reverted');
  assert.match(r.reason, /probe_failed/);
  assert.equal(deployer.live, 'v1');
  assert.deepEqual(deployer.calls, ['publish', 'rollback']);
});

test('a probe that passes only after a delay inside the window is kept', async () => {
  const { d, web, clock } = setup();
  web.healthy = false;
  const base = clock.sleep;
  let n = 0;
  const d2 = createDeploy({ db: setup().db, deployer: fakeDeployer(), fetch: async () => (++n >= 3 ? new Response('{"ok":true,"version":"v2"}') : new Response('x', { status: 500 })),
    now: clock.now, sleep: base, config: { windowMs: 10000, intervalMs: 1000 }, probes: { api: [{ kind: 'http', url: 'https://svc.example/h', contains: ['ok'] }] } });
  assert.equal((await d2.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' })).status, 'kept');
});

test('US-07-R19: a stale expectedVersion is refused, nothing is published and the refused ledger row carries the reason', async () => {
  const { d, deployer } = setup();
  const r = await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v0', actor: 'a' });
  assert.equal(r.status, 'refused');
  assert.match(r.reason, /stale_version/);
  assert.deepEqual(deployer.calls, []);
  assert.equal((await d.ledger('api'))[0].status, 'refused'); // refusals are ledgered
  assert.match((await d.ledger('api'))[0].reason, /stale_version/); // the refused row carries the reason text
});

test('US-07-R12: deploys of one unit are serialized by the lock; other units are not blocked', async () => {
  const { d, db } = setup();
  const lock = dbLock(db);
  const tok = await lock.acquire('api', 'other', 60000);
  assert.ok(tok);
  assert.equal((await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' })).reason, 'locked');
  assert.ok(await lock.acquire('worker2', 'x', 60000));
  await lock.release('api', tok);
  assert.equal((await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' })).status, 'kept');
});

test('an expired lock is taken over; an injected lock port is used instead of the built-in', async () => {
  const { db, clock } = setup();
  const lock = dbLock(db, clock.now);
  assert.ok(await lock.acquire('u', 'a', 1000));
  clock.sleep(2000);
  assert.ok(await lock.acquire('u', 'b', 1000));
  const calls = [];
  const port = { acquire: async (u) => { calls.push('acq:' + u); return 'T'; }, release: async (u, t) => { calls.push('rel:' + t); } };
  const s = setup({ extra: { lock: port } });
  await s.d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' });
  assert.deepEqual(calls, ['acq:api', 'rel:T']);
});

test('US-07-R19: loop breaker: N consecutive reverts trip a gate-style record and further deploys are refused until closed', async () => {
  const { d, web } = setup({ config: { breakerThreshold: 3 } });
  web.healthy = false;
  let last;
  for (const v of ['v2', 'v3', 'v4']) last = await d.deploy({ unit: 'api', artifact: art(v), expectedVersion: 'v1' });
  assert.equal(last.status, 'reverted');
  assert.ok(last.gate, 'gate record opened on third revert');
  web.healthy = true; web.version = 'v5';
  const blocked = await d.deploy({ unit: 'api', artifact: art('v5'), expectedVersion: 'v1' });
  assert.equal(blocked.reason, 'loop_breaker_open');
  await d.closeGate(last.gate);
  assert.equal((await d.deploy({ unit: 'api', artifact: art('v5'), expectedVersion: 'v1' })).status, 'kept');
});

test('US-07-R19: a kept deploy resets the breaker count', async () => {
  const { d, web } = setup({ config: { breakerThreshold: 2 } });
  web.healthy = false;
  assert.equal((await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' })).gate, undefined);
  web.healthy = true; web.version = 'v3';
  assert.equal((await d.deploy({ unit: 'api', artifact: art('v3'), expectedVersion: 'v1' })).status, 'kept');
  web.healthy = false;
  assert.equal((await d.deploy({ unit: 'api', artifact: art('v4'), expectedVersion: 'v3' })).gate, undefined);
});

test('US-07-R20: an unverifiable rollback opens a gate record and reports failed', async () => {
  const { d, web } = setup({ deployer: fakeDeployer('v1', { brokenRollback: true }) });
  web.healthy = false;
  const r = await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' });
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /rollback_unverified/);
  assert.ok(r.gate);
});

test('US-07-R21: unlogged mutation: reconcile files a record when live differs from the ledger', async () => {
  const { d, deployer, db } = setup();
  assert.equal((await d.reconcile('api')).status, 'no_baseline');
  await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' });
  assert.equal((await d.reconcile('api')).status, 'consistent');
  deployer.live = 'hotfix-by-hand';
  const r = await d.reconcile('api');
  assert.equal(r.status, 'unlogged');
  assert.equal(r.live, 'hotfix-by-hand');
  const rec = await rows(db, `SELECT * FROM deploy_records WHERE kind='unlogged'`);
  assert.equal(rec.length, 1);
  assert.match(rec[0].what, /UNLOGGED/);
  assert.equal((await d.ledger('api'))[0].status, 'unlogged');
  assert.equal((await d.reconcile('api')).status, 'consistent'); // baseline moved, no duplicate record
});

test('US-07-R21: after a revert, reconcile expects the prior version', async () => {
  const { d, web } = setup();
  web.healthy = false;
  await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' });
  assert.equal((await d.reconcile('api')).status, 'consistent');
});

test('ledger is complete: every attempt has a row, probes recorded before and after', async () => {
  const { d, db, web } = setup();
  await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'nope' });
  web.healthy = false;
  await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' });
  web.healthy = true;
  await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' });
  const l = (await d.ledger('api')).map(r => r.status).reverse();
  assert.deepEqual(l, ['refused', 'reverted', 'kept']);
  const phases = (await rows(db, `SELECT DISTINCT phase FROM deploy_probe_results`)).map(r => r.phase).sort();
  assert.deepEqual(phases, ['after', 'before']);
});

test('artifact digest mismatch is refused (US-07-R13)', async () => {
  const { d, deployer } = setup();
  const r = await d.deploy({ unit: 'api', artifact: { ...art('v2'), sha256: '0'.repeat(64) }, expectedVersion: 'v1' });
  assert.equal(r.reason, 'artifact_digest_mismatch');
  assert.deepEqual(deployer.calls, []);
});

test('US-07-R19, US-09-R02: the kill switch refuses deploys, via config row or injected port', async () => {
  const { d, db, deployer } = setup();
  db.raw.exec(`INSERT INTO deploy_config VALUES ('kill_switch','on')`);
  assert.equal((await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' })).reason, 'kill_switch');
  const s = setup({ extra: { killSwitch: async () => true } });
  assert.equal((await s.d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' })).reason, 'kill_switch');
  assert.deepEqual(deployer.calls, []);
});

test('db-row probes and observe mode', async () => {
  const s = setup();
  s.db.raw.exec(`INSERT INTO deploy_units VALUES ('svc2', '[{"kind":"db","sql":"SELECT COUNT(*) FROM org","expect":">0"}]', 'observe')`);
  s.deployer.live = 'a';
  const r = await s.d.deploy({ unit: 'svc2', artifact: art('b'), expectedVersion: 'a' });
  assert.equal(r.status, 'kept');
  assert.match(r.reason, /observe mode/);
  assert.equal(s.deployer.live, 'b'); // observe keeps without reverting
  s.db.raw.exec(`INSERT INTO org VALUES ('k','v')`);
  s.db.raw.exec(`UPDATE deploy_units SET mode='revert' WHERE unit='svc2'`);
  assert.equal((await s.d.deploy({ unit: 'svc2', artifact: art('c'), expectedVersion: 'b' })).status, 'kept');
});

test('US-06-R10, US-06-T06: no secret value is stored anywhere, even if an error message carries it; the presence of the binding is recorded, never its value', async () => {
  const deployer = fakeDeployer();
  deployer.publish = async () => { throw new Error('auth failed with ' + SECRET); };
  const { d, db } = setup({ deployer });
  const r = await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' });
  assert.equal(r.status, 'failed');
  // every deploy_* table and the items table, found from the schema so a table added later is covered too
  const tables = (await rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'deploy\\_%' ESCAPE '\\' OR name='items')`)).map(t => t.name);
  assert.ok(tables.includes('deploy_ledger') && tables.includes('items'));
  const all = [];
  for (const t of tables) all.push(await rows(db, `SELECT * FROM ${t}`));
  const dump = JSON.stringify(all);
  assert.ok(!dump.includes(SECRET));
  assert.ok(dump.includes('[redacted]'));
});

test('handle: auth required, POST /deploy, GET /ledger, 409 on refusal', async () => {
  const { d } = setup();
  const req = (method, path, body, tok = SECRET) => new Request('https://x.example' + path, { method, headers: { 'x-deploy-token': tok }, body: body && JSON.stringify(body) });
  assert.equal((await d.handle(req('GET', '/ledger', null, 'wrong'), {})).status, 401);
  assert.equal((await d.handle(req('POST', '/deploy', { unit: 'api', artifact: art('v2'), expectedVersion: 'bad' }))).status, 409);
  const ok = await d.handle(req('POST', '/deploy', { unit: 'api', artifact: art('v2'), expectedVersion: 'v1', actor: 'a' }));
  assert.equal(ok.status, 200);
  const led = await (await d.handle(req('GET', '/ledger?unit=api'))).json();
  assert.equal(led.rows.length, 2);
  assert.equal((await d.handle(req('GET', '/nope'))).status, 404);
  const none = createDeploy({ db: makeDb([MIG]), deployer: fakeDeployer(), fetch: fakeFetch({}), env: {} });
  assert.equal((await none.handle(req('GET', '/ledger', null, ''))).status, 401); // no token configured: refuse everyone
});

test('US-05-T04, US-07-T05: a version whose pre-passing probe fails is reverted to the prior version and a failure item is filed', async () => {
  const { db, deployer, web, d } = setup();
  web.version = 'v1';
  const before = await d.deploy({ unit: 'api', artifact: art('v1b'), expectedVersion: 'v1', actor: 'ops' }); // probe passes before: baseline row ok
  assert.equal(before.status, 'reverted'); // version not reported: reverted, and it proves the probe is live
  web.healthy = false;
  const res = await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1', actor: 'ops' });
  assert.equal(res.status, 'reverted');
  assert.equal(deployer.live, 'v1', 'prior version restored');
  const probes = await rows(db, `SELECT phase, ok FROM deploy_probe_results WHERE ledger_id = ${res.id} ORDER BY id`);
  assert.deepEqual(probes.map(p => p.phase), ['before', 'after']);
  const item = (await rows(db, `SELECT id, kind, status, priority, owner_role, closing_probe FROM items WHERE id = '${res.item}'`))[0];
  assert.equal(item.id, `DEPLOYFAIL-api-${res.id}`);
  assert.deepEqual([item.kind, item.status, item.priority, item.owner_role], ['fix', 'ready', 0, 'operations']);
  // the closing probe is a query the tick can run: it passes once a later deploy of the unit is kept
  const probeNow = Object.values((await rows(db, item.closing_probe))[0])[0];
  assert.equal(probeNow, 0);
  web.healthy = true; web.version = 'v3';
  assert.equal((await d.deploy({ unit: 'api', artifact: art('v3'), expectedVersion: 'v1', actor: 'ops' })).status, 'kept');
  assert.equal(Object.values((await rows(db, item.closing_probe))[0])[0], 1);
});

test('US-05-R09: a probe marked revert:false (shared resource under load) is recorded but does not revert; other probes still do', async () => {
  const shared = { kind: 'db', name: 'shared-queue-depth', sql: `SELECT COUNT(*) FROM deploy_config`, expect: '>0', revert: false };
  const health = { kind: 'http', url: 'https://svc.example/health', contains: ['"ok":true'] };
  const { db, deployer, web, d } = setup({ extra: { probes: { api: [health, shared] } } });
  const kept = await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1', actor: 'ops' });
  assert.deepEqual([kept.status, kept.reason], ['kept', 'excluded_probe_failed: shared-queue-depth']);
  assert.equal(deployer.live, 'v2');
  assert.equal((await rows(db, `SELECT ok FROM deploy_probe_results WHERE probe='shared-queue-depth' AND phase='after'`))[0].ok, 0);
  assert.equal((await rows(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'DEPLOYFAIL-%'`))[0].n, 0);
  web.healthy = false;
  const rev = await d.deploy({ unit: 'api', artifact: art('v3'), expectedVersion: 'v2', actor: 'ops' });
  assert.equal(rev.status, 'reverted');
  assert.equal(deployer.live, 'v2');
});

// ---- US-06-R21, US-05-R13: the deploy path asks the authorizer and the confidence gate before it acts ----
const POLICY = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
function governed({ required_rung = 'assisted', threshold, limits, authorizeOverride } = {}) {
  const db = makeDb([MIG, fileURLToPath(Trust.MIGRATIONS_DIR), fileURLToPath(Predict.MIGRATIONS_DIR)]);
  const deployer = fakeDeployer();
  const web = { healthy: true, version: 'v2' };
  let t = Date.parse('2026-11-11T00:00:00Z');
  const now = () => t, sleep = async (ms) => { t += ms; };
  const authorize = authorizeOverride || Trust.deployAuthorizer({ db, policy: POLICY, required_rung, now, limits });
  const confidence = threshold === undefined ? undefined : Predict.confidenceGate({ db, decision_type: 'merge', threshold });
  const d = createDeploy({ db, deployer, fetch: fakeFetch(web), now, sleep, env: { DEPLOY_TOKEN: SECRET }, config: { windowMs: 6000, intervalMs: 2000 },
    probes: { api: [{ kind: 'http', url: 'https://svc.example/health', contains: ['"ok":true'], version: true }] }, authorize, confidence });
  return { db, deployer, web, d, now };
}
const ask = (d, over = {}) => d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1', actor: 'agent-a', ...over });

test('US-06-R21: a deploy is refused with the reason and a ledger row when the rung is below the one required, and published when it is at or above', async () => {
  const low = governed({ required_rung: 'delegated' });
  const r = await ask(low.d);
  assert.deepEqual([r.status, r.reason], ['refused', 'unauthorized: effective rung assisted is below delegated']);
  assert.deepEqual(low.deployer.calls, [], 'nothing is published');
  assert.deepEqual((await low.d.ledger('api')).map(x => [x.status, x.reason]), [['refused', 'unauthorized: effective rung assisted is below delegated']]);
  low.db.raw.prepare(`INSERT INTO trust_ledger (surface, action_class, rung, reliability, outcomes) VALUES ('runtime','deploy_production','delegated',0.9,12)`).run();
  assert.equal((await ask(low.d)).status, 'kept');
  assert.deepEqual(low.deployer.calls, ['publish']);
  const ok = governed(); // the policy starts runtime at assisted, which is what the default asks for
  assert.equal((await ask(ok.d)).status, 'kept');
});

test('US-06-R21: an authorizer that throws or answers anything but allowed refuses: unknown is not allowed', async () => {
  const boom = governed({ authorizeOverride: async () => { throw new Error('policy store down'); } });
  assert.equal((await ask(boom.d)).reason, 'unauthorized: the authorizer failed: policy store down');
  const none = governed({ authorizeOverride: async () => undefined });
  assert.equal((await ask(none.d)).reason, 'unauthorized: not allowed');
  const truthy = governed({ authorizeOverride: async () => ({ allowed: 'yes' }) });
  assert.equal((await ask(truthy.d)).status, 'refused', 'only the boolean true allows');
  for (const g of [boom, none, truthy]) assert.deepEqual(g.deployer.calls, []);
});

test('US-06-R21, US-06-R08: an irreversible, identity-bound class yields a gate card and publishes nothing', async () => {
  const g = governed();
  const r = await ask(g.d, { action_class: 'delete_database_or_bucket' });
  assert.equal(r.status, 'refused'); assert.match(r.reason, /^unauthorized: interrupt_gate|^unauthorized: irreversible and identity-bound/);
  assert.match(r.gate_card, /^GATE-runtime-delete_database_or_bucket-api$/);
  assert.equal((await rows(g.db, `SELECT status FROM gate_cards WHERE id='${r.gate_card}'`))[0].status, 'open');
  assert.deepEqual(g.deployer.calls, []);
});

test('US-06-R13, US-06-R21: a standing-limit refusal is recorded and the same deploy is not resubmitted', async () => {
  const g = governed({ limits: { harness: { refused: true, reason: 'the permission check refused this change' } } });
  const first = await ask(g.d);
  assert.deepEqual([first.status, first.reason, first.next], ['refused', 'unauthorized: the permission check refused this change', 'correct_condition_and_retry_once']);
  const again = await ask(g.d);
  assert.equal(again.next, 'take_next_path', 'the same action under the same condition is told to take the next path');
  assert.deepEqual(g.deployer.calls, []);
  const rec = await rows(g.db, `SELECT check_name, attempts FROM trust_refusals`);
  assert.deepEqual(rec.map(x => [x.check_name, x.attempts]), [['harness', 2]]);
});

test('US-05-R13, US-06-R21: a stated confidence that clears the threshold uncorrected but not after the stored correction refuses the deploy', async () => {
  const g = governed({ threshold: 0.8 });
  const st = g.db.raw.prepare(`INSERT INTO predict_predictions (id, form, subject, op, value, due_at, confidence, decision_type, matched) VALUES (?, 'metric','m','>=',1,'2026-11-11 00:00:00',0.85,'merge',?)`);
  for (let i = 0; i < 40; i++) st.run(`c-${i}`, i < 28 ? 1 : 0);
  await Predict.calibrate(g.db, { now: Date.parse('2026-11-11T00:00:00Z') });
  const r = await ask(g.d, { confidence: 0.85 });
  assert.equal(r.status, 'refused'); assert.match(r.reason, /^confidence_below_gate: stated 0\.85, corrected 0\.7/);
  assert.deepEqual(g.deployer.calls, []);
  assert.equal((await ask(g.d, { confidence: 0.95, expectedVersion: 'v1' })).status, 'kept', 'a confidence that survives the correction deploys');
  const none = await ask(governed({ threshold: 0.8 }).d); // no stated confidence at all
  assert.match(none.reason, /^confidence_below_gate: stated null/);
});

test('US-06-R21: the ops agent passes the item\'s surface and action class to the deploy path, so an unauthorized item stays open with the reason as its blocker', async () => {
  const g = governed();
  g.db.raw.prepare(`INSERT INTO items (id, title, owner_role, done_check, status, surface, action_class) VALUES ('I1','drop','operations','deploy-unit: api; version: v2','ready','runtime','delete_database_or_bucket')`).run();
  const out = await opsStep({ db: g.db, deploy: g.d, liveVersion: async () => 'v1', sources: [{ name: 's', fetch: async () => art('v2') }] });
  assert.deepEqual([out[0].item, out[0].status], ['I1', 'refused']);
  const it = (await rows(g.db, `SELECT status, blocker FROM items WHERE id='I1'`))[0];
  assert.equal(it.status, 'ready'); assert.match(it.blocker, /^refused: unauthorized: /);
});

// ---- US-07-R13: the published artifact is compared with what the platform serves ----
const sha = (b) => createHash('sha256').update(b).digest('hex');
function withDigest(live, over = {}) {
  const deployer = fakeDeployer();
  if (live !== undefined) deployer.liveDigest = typeof live === 'function' ? live : async () => live;
  return { ...setup({ deployer, ...over }), deployer };
}
const digestRow = async (db) => (await rows(db, `SELECT state, detail FROM deploy_digest_checks`))[0];

test('US-07-R13: a live digest that equals the published digest keeps the deploy and is recorded as a match', async () => {
  const body = 'code-v2';
  const { d, db } = withDigest(sha(body));
  const r = await d.deploy({ unit: 'api', artifact: art('v2', body), expectedVersion: 'v1' });
  assert.equal(r.status, 'kept');
  assert.equal((await digestRow(db)).state, 'match');
  assert.equal((await rows(db, `SELECT ok FROM deploy_probe_results WHERE probe='artifact:digest' AND phase='after'`))[0].ok, 1);
});

test('US-07-R13: a live digest that differs from the published digest reverts the deploy and records artifact:digest failed', async () => {
  const { d, db, deployer } = withDigest('0'.repeat(64));
  const r = await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' });
  assert.equal(r.status, 'reverted'); assert.match(r.reason, /probe_failed: artifact:digest/);
  assert.deepEqual(deployer.calls, ['publish', 'rollback']); assert.equal(deployer.live, 'v1');
  assert.equal((await digestRow(db)).state, 'mismatch');
  assert.equal((await rows(db, `SELECT ok FROM deploy_probe_results WHERE probe='artifact:digest' AND phase='after'`))[0].ok, 0);
  assert.match(r.item, /^DEPLOYFAIL-api-/);
});

test('US-07-R13: a deployer with no liveDigest keeps working and records the comparison as skipped, never as a match', async () => {
  const { d, db } = withDigest(undefined);
  assert.equal((await d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' })).status, 'kept');
  const row = await digestRow(db);
  assert.equal(row.state, 'skipped'); assert.match(row.detail, /no liveDigest/);
  assert.equal((await rows(db, `SELECT COUNT(*) AS n FROM deploy_probe_results WHERE probe='artifact:digest'`))[0].n, 0);
  // an artifact that carries neither a digest nor a body has nothing to compare: no row at all
  const bare = withDigest('x'.repeat(64));
  assert.equal((await bare.d.deploy({ unit: 'api', artifact: { version: 'v2' }, expectedVersion: 'v1' })).status, 'kept');
  assert.equal((await rows(bare.db, `SELECT COUNT(*) AS n FROM deploy_digest_checks`))[0].n, 0);
});

test('US-07-R13: a per-file digest map is compared file by file (the platform deploy script\'s rule); a different shape is skipped, an unreadable digest is retried inside the window', async () => {
  const files = { 'index.js': sha('a'), 'util.js': sha('b') };
  const good = withDigest({ ...files });
  assert.equal((await good.d.deploy({ unit: 'api', artifact: { version: 'v2', files }, expectedVersion: 'v1' })).status, 'kept');
  assert.match((await digestRow(good.db)).detail, /2 file digest\(s\) equal/);
  const bad = withDigest({ 'index.js': sha('a'), 'util.js': sha('changed') });
  const r = await bad.d.deploy({ unit: 'api', artifact: { version: 'v2', files }, expectedVersion: 'v1' });
  assert.equal(r.status, 'reverted'); assert.match((await digestRow(bad.db)).detail, /file digest differs: util\.js/);
  const shape = withDigest(files);
  assert.equal((await shape.d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' })).status, 'kept');
  assert.equal((await digestRow(shape.db)).state, 'skipped');
  let n = 0; // the platform serves the old script for the first two reads, then the new one
  const lag = withDigest(async () => (++n >= 3 ? sha('code-v2') : sha('code-v1')));
  assert.equal((await lag.d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' })).status, 'kept');
  assert.equal((await digestRow(lag.db)).state, 'match');
  const gone = withDigest(async () => { throw new Error('platform 503'); });
  const g = await gone.d.deploy({ unit: 'api', artifact: art('v2'), expectedVersion: 'v1' });
  assert.equal(g.status, 'reverted'); assert.match((await digestRow(gone.db)).detail, /error: platform 503/);
});
