import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick } from '../src/tick.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const T0 = Date.parse('2026-11-10T00:00:00Z');
const H = 3600e3;

test('OBJECTIVES-1: a metric outside its healthy condition files its own remedy and closes it on recovery', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m');
    INSERT INTO metrics (id,name,kind,source,spec,op,threshold,grace_hours,owner_role,remedy)
    VALUES ('M-x','open items','target','sql','SELECT COUNT(*) FROM items WHERE kind=''work'' AND status<>''done''','<=',0,0,'operations','Close them.');
    INSERT INTO items (id,title,kind,owner_role,done_check,status) VALUES ('W','w','work','operations','x','blocked');`);
  await runTick(db, { config, now: T0 });
  assert.equal(db.raw.prepare("SELECT breached FROM metrics WHERE id='M-x'").get().breached, 1);
  const it = db.raw.prepare("SELECT owner_role, priority, closing_probe FROM items WHERE id='BREACH-M-x'").get();
  assert.equal(it.owner_role, 'operations'); assert.equal(it.closing_probe, 'metric:M-x');
  db.raw.exec("UPDATE items SET status='done', disposition='fixed' WHERE id='W'");
  await runTick(db, { config, now: T0 + 600e3 });
  assert.equal(db.raw.prepare("SELECT breached FROM metrics WHERE id='M-x'").get().breached, 0);
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='BREACH-M-x'").get().status, 'done');
});

test('OBJECTIVES-1: liveness gets grace, then a silent clock breaches; a declared measure with no probe always breaches', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO objectives (id,statement,owner_role) VALUES ('OBJ-1','Keep controls current','product-manager-1');
    INSERT INTO metrics (id,objective_id,name,kind,source,spec,op,threshold,grace_hours,owner_role,remedy)
    VALUES ('M-acting',NULL,'dispatches','liveness','builtin','dispatches_24h','>=',1,2,'operations','Check the executor.'),
           ('M-decl','OBJ-1','controls out of date','target','declared','controls out of date, target 0','>=',0,0,'product-manager-1','Build a probe.'),
           ('M-inst',NULL,'instrumented','liveness','builtin','objectives_without_probe','<=',0,0,'product-manager','Add a probe.');`);
  await runTick(db, { config, now: T0 });                       // first tick: age 0, inside grace
  assert.equal(db.raw.prepare("SELECT breached FROM metrics WHERE id='M-acting'").get().breached, 0, 'grace');
  assert.equal(db.raw.prepare("SELECT breached FROM metrics WHERE id='M-decl'").get().breached, 1, 'declared is a breach');
  assert.equal(db.raw.prepare("SELECT breached FROM metrics WHERE id='M-inst'").get().breached, 1, 'objective has no probe-backed target');
  await runTick(db, { config, now: T0 + 3 * H });               // past grace, nothing was dispatched
  assert.equal(db.raw.prepare("SELECT breached FROM metrics WHERE id='M-acting'").get().breached, 1, 'silent clock breaches');
  db.raw.exec("INSERT INTO metrics (id,objective_id,name,kind,source,spec,op,threshold,owner_role,remedy) VALUES ('M-real','OBJ-1','t','target','sql','SELECT 0','<=',0,'product-manager-1','r')");
  await runTick(db, { config, now: T0 + 3 * H + 600e3 });
  assert.equal(db.raw.prepare("SELECT breached FROM metrics WHERE id='M-inst'").get().breached, 0, 'a probe-backed target instruments the objective');
});

test('OBJECTIVES-1: an sql probe that is not one SELECT is refused and counts as a breach', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO metrics (id,name,kind,source,spec,op,threshold,owner_role,remedy)
    VALUES ('M-bad','bad','target','sql','DELETE FROM items','>=',0,'operations','r');`);
  const r = await runTick(db, { config, now: T0 });
  assert.equal(db.raw.prepare("SELECT breached FROM metrics WHERE id='M-bad'").get().breached, 1);
  assert.match(r.report, /must be one SELECT/);
});

test('OBJECTIVES-1: an http probe reads 1 on a 2xx answer and 0 on an error or a thrown request', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO metrics (id,name,kind,source,spec,op,threshold,owner_role,remedy)
    VALUES ('M-up','site up','target','http','https://example.test/health','>=',1,'operations','Roll back the deploy.');`);
  const up = { fetch: async () => ({ ok: true }) }, down = { fetch: async () => ({ ok: false }) }, boom = { fetch: async () => { throw new Error('dns'); } };
  await runTick(db, { config, env: up, now: T0 });
  assert.equal(db.raw.prepare("SELECT last_value, breached FROM metrics WHERE id='M-up'").get().last_value, 1);
  assert.equal(db.raw.prepare("SELECT breached FROM metrics WHERE id='M-up'").get().breached, 0);
  await runTick(db, { config, env: down, now: T0 + 600e3 });
  assert.equal(db.raw.prepare("SELECT breached FROM metrics WHERE id='M-up'").get().breached, 1, '5xx breaches');
  assert.ok(db.raw.prepare("SELECT 1 FROM items WHERE id='BREACH-M-up' AND status<>'done'").get());
  await runTick(db, { config, env: boom, now: T0 + 1200e3 });
  assert.equal(db.raw.prepare("SELECT last_value FROM metrics WHERE id='M-up'").get().last_value, 0, 'a thrown request reads 0');
  await runTick(db, { config, env: up, now: T0 + 1800e3 });
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='BREACH-M-up'").get().status, 'done', 'recovery closes the remedy');
});

test('TENANT-1: a runtime measures only its own tenant; another tenant\'s metric is never read, never breaches, never files an item here', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO metrics (id,tenant_id,name,kind,source,spec,op,threshold,owner_role,remedy)
    VALUES ('M-own',NULL,'own','target','sql','SELECT 0','<=',0,'operations','r'),
           ('M-mine','t','mine tenant','target','sql','SELECT 1','<=',0,'operations','r'),
           ('M-foreign','customer-b','foreign','target','sql','SELECT 1','<=',0,'operations','r');`);
  await runTick(db, { config, now: T0 });                      // config.org_slug is 't'
  assert.equal(db.raw.prepare("SELECT breached FROM metrics WHERE id='M-own'").get().breached, 0);
  assert.equal(db.raw.prepare("SELECT breached FROM metrics WHERE id='M-mine'").get().breached, 1, 'its own tenant breaches');
  const f = db.raw.prepare("SELECT breached, last_at FROM metrics WHERE id='M-foreign'").get();
  assert.equal(f.breached, 0); assert.equal(f.last_at, null, 'a foreign tenant metric is never even read');
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id='BREACH-M-foreign'").get().n, 0, 'and files nothing in this runtime');
});

test('LIVE-1: PUBLIC_HEALTH_ONLY exposes GET /health and the signed webhook and nothing else', async () => {
  const { hiddenByHealthOnly: hidden } = await import('../src/visibility.js');
  const on = { PUBLIC_HEALTH_ONLY: '1' };
  assert.equal(hidden(on, 'GET', '/health'), false);
  assert.equal(hidden(on, 'POST', '/hook/github'), false);
  for (const [m, p] of [['GET', '/'], ['GET', '/api/analytics'], ['GET', '/mcp'], ['GET', '/llms.txt'], ['POST', '/mcp'], ['POST', '/health'], ['GET', '/hook/github']]) assert.equal(hidden(on, m, p), true, m + ' ' + p);
  assert.equal(hidden({}, 'GET', '/'), false, 'off by default: customers keep their full surface');
});

test('LIVENESS-SEED-1: a runtime with no metrics seeds the six liveness metrics itself, equal to the bootstrap set, and never overwrites a row', async () => {
  const { LIVENESS } = await import('../src/tick.js');
  const py = readFileSync(new URL('../../bootstrap/bootstrap.py', import.meta.url), 'utf8');
  for (const [id, , spec, op, threshold] of LIVENESS) assert.ok(py.includes(`"${spec}", "${op}", ${threshold},`), `bootstrap.py differs for ${id}`);
  const db = makeDb();
  db.raw.exec(`INSERT INTO metrics (id, tenant_id, name, kind, source, spec, op, threshold, grace_hours, owner_role, remedy) VALUES ('M-acting', NULL, 'owner row', 'liveness', 'builtin', 'dispatches_24h', '>=', 9, 0, 'operations', 'x')`);
  await runTick(db, { config, now: Date.parse('2026-11-10T00:00:00Z') });
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM metrics WHERE kind='liveness'`).get().n, LIVENESS.length);
  assert.equal(db.raw.prepare(`SELECT threshold FROM metrics WHERE id='M-acting'`).get().threshold, 9);
});
