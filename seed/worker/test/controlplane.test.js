import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { runTick } from '../src/tick.js';
import { runRoleWork, evaluate } from '../src/work.js';
import { controlPlane, INTEGRATIONS } from '../src/controlplane.js';
import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const T0 = Date.parse('2026-11-10T00:00:00Z');

function seed(db) {
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m'), ('op-1','operations',1,'m'), ('pm-1','product-manager',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,closing_probe,priority,status) VALUES
      ('F1','file present','staff','x','file:seed/worker/src/executor.js',10,'ready'),
      ('F2','file absent','staff','x','file:nope.js',20,'ready'),
      ('S1','successor','operations','x','successor:F1',10,'ready'),
      ('TICKFAIL-measure-2026-11-09T00','tick step measure failed','operations','x',NULL,5,'ready');`);
}
const get = (db, path, env = {}) => controlPlane(new Request('https://ultrastable.io' + path), { DB: db, ...env }, { org: 't', now: T0 + 3600e3 });

test('roles consume their dispatches: a passing probe closes the item with a verified outcome; a failing one waits for the executor once', async () => {
  const db = makeDb(); seed(db);
  await runTick(db, { config, now: T0 });
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM dispatches WHERE status='queued'").get().n > 0, true);
  const exists = async p => p === 'seed/worker/src/executor.js';
  const r = await runRoleWork(db, { now: T0 + 60e3, fileExists: exists });
  await runTick(db, { config, now: T0 + 600e3 });  // one item per role per tick: the successor is dispatched on the next tick
  await runRoleWork(db, { now: T0 + 660e3, fileExists: exists });
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='F1'").get().status, 'done');
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='S1'").get().status, 'done');
  assert.equal(db.raw.prepare("SELECT kind, closing_probe FROM items WHERE id='PLUS-F1'").get().kind, 'plus');  // successor filed, no runaway chain
  assert.equal(db.raw.prepare("SELECT closing_probe FROM items WHERE id='PLUS-F1'").get().closing_probe, null);
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='TICKFAIL-measure-2026-11-09T00'").get().status, 'done');  // stale tick failure closes
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM dispatches WHERE status='queued'").get().n, 0);
  assert.ok(r.done >= 2);
  // a second run records no duplicate needs_executor outcome for the same waiting dispatch
  const before = db.raw.prepare("SELECT COUNT(*) n FROM outcomes WHERE result='needs_executor'").get().n;
  await runRoleWork(db, { now: T0 + 720e3, fileExists: exists });
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM outcomes WHERE result='needs_executor'").get().n, before);
  // disposition is always recorded (no silent drop)
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM items WHERE status='done' AND (disposition IS NULL OR disposition='')").get().n, 0);
});

test('an unreadable repository is unknown, never a pass or a fail', async () => {
  const db = makeDb();
  assert.equal((await evaluate(db, { id: 'X', closing_probe: 'file:a.js' }, { fileExists: async () => null })).state, 'unknown');
});

test('the control plane serves status, agents, backlog with totals, activity, OpenAPI and the dashboard', async () => {
  const db = makeDb(); seed(db);
  await runTick(db, { config, now: T0 });
  const st = await (await get(db, '/api/v1/status')).json();
  assert.equal(st.roles, 3); assert.ok(st.heartbeat.last_tick); assert.ok(Array.isArray(st.findings));
  const ag = await (await get(db, '/api/v1/agents')).json();
  assert.ok(ag.agents.find(a => a.id === 'staff-1').working_on.length >= 1);
  const bl = await (await get(db, '/api/v1/backlog?status=ready,claimed&limit=1')).json();
  assert.equal(bl.returned, 1); assert.ok(bl.total >= 2); assert.equal(bl.omitted, bl.total - 1);
  assert.equal((await get(db, '/api/v1/backlog?status=bogus')).status, 400);
  const oa = await (await get(db, '/api/v1/openapi.json')).json();
  const ids = Object.values(oa.paths).flatMap(p => Object.values(p).map(o => o.operationId));
  assert.ok(ids.includes('getStatus') && ids.includes('postEvent'));
  assert.ok((await (await get(db, '/api/v1/activity')).json()).ticks.length >= 1);
  const html = await (await get(db, '/ops')).text();
  assert.match(html, /operations/); assert.match(html, /staff-1/);
  assert.equal((await get(db, '/api/v1/nope')).status, 404);
  assert.equal(await controlPlane(new Request('https://x/other'), { DB: db }), null);
});

test('events: refused without the secret, accepted once for a registered integration, idempotent', async () => {
  const db = makeDb(); seed(db);
  const post = (body, auth, env = { INTEGRATION_TOKEN: 'k' }) => controlPlane(new Request('https://ultrastable.io/api/v1/events', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(body) }), { DB: db, ...env }, { now: T0 });
  assert.equal((await post({}, 'k', {})).status, 503);
  assert.equal((await post({ source: 'personal-companion', title: 'hello there' }, 'wrong')).status, 401);
  assert.equal((await post({ source: 'stranger', title: 'hello there' }, 'k')).status, 422);
  const ok = await post({ source: 'personal-companion', type: 'idea', title: 'Remind me of the weekly review', id: 'r1' }, 'k');
  assert.equal(ok.status, 202);
  const j = await ok.json(); assert.equal(j.id, 'EV-personal-companion-r1'); assert.equal(j.owner_role, 'product-manager');
  assert.equal((await post({ source: 'personal-companion', title: 'Remind me of the weekly review', id: 'r1' }, 'k')).status, 200);
  assert.ok(INTEGRATIONS.find(i => i.id === 'personal-companion'));
});
