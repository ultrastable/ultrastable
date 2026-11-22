// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onCloudflareAlert, settleCloudflareAlerts, POLICIES } from '../src/cfalerts.js';
import { hiddenByHealthOnly } from '../src/visibility.js';

const d1 = () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT, kind TEXT, owner_role TEXT, done_check TEXT, closing_probe TEXT, priority INTEGER, status TEXT, disposition TEXT, updated_at TEXT)");
  const w = s => ({ bind: (...a) => ({ run: async () => { db.prepare(s).run(...a); return {}; }, first: async () => db.prepare(s).get(...a) || null, all: async () => ({ results: db.prepare(s).all(...a) }) }), run: async () => { db.exec(s); return {}; }, first: async () => db.prepare(s).get() || null, all: async () => ({ results: db.prepare(s).all() }) });
  return { raw: db, prepare: w };
};
const file = (db) => async (it) => { db.raw.prepare("INSERT OR IGNORE INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status) VALUES (?,?,?,?,?,?,?, 'ready')").run(it.id, it.title, it.kind, it.owner_role, it.done_check, it.closing_probe, it.priority); return true; };
const post = (body, auth) => new Request('https://t.example/hook/cloudflare', { method: 'POST', headers: auth ? { 'cf-webhook-auth': auth } : {}, body: JSON.stringify(body) });

test('a verified alert is stored and filed as one item per type per day', async () => {
  const db = d1(), now = Date.parse('2026-11-22T03:00:00Z');
  const r = await onCloudflareAlert(post({ alert_type: 'workers_observability_alert', name: 'Error rate', text: 'ultrastable-site 5xx above 5%' }, 's3cret'), { db, secret: 's3cret', fileItem: file(db), now });
  assert.equal(r.status, 202);
  assert.equal((await r.json()).item, 'CF-ALERT-workers-observability-alert-2026-11-22');
  const it = db.raw.prepare('SELECT * FROM items').get();
  assert.equal(it.closing_probe, 'cfalert:workers_observability_alert');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM cf_alerts').get().n, 1);
});

test('a wrong or missing secret is refused, and no destination secret is a stated 503', async () => {
  const db = d1();
  assert.equal((await onCloudflareAlert(post({ alert_type: 'incident_alert' }, 'nope'), { db, secret: 's3cret' })).status, 401);
  assert.equal((await onCloudflareAlert(post({ alert_type: 'incident_alert' }), { db, secret: 's3cret' })).status, 401);
  assert.equal((await onCloudflareAlert(post({ alert_type: 'incident_alert' }, 'x'), { db, secret: '' })).status, 503);
});

test("the destination's delivery test answers 200 and files nothing", async () => {
  const db = d1();
  const r = await onCloudflareAlert(post({ text: 'Hello World! This is a test message sent from https://cloudflare.com' }, 's'), { db, secret: 's', fileItem: file(db) });
  assert.equal(r.status, 200);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM items').get().n, 0);
});

test('an item closes itself once its alert type is quiet for a day, not before', async () => {
  const db = d1(), t0 = Date.parse('2026-11-22T03:00:00Z');
  await onCloudflareAlert(post({ alert_type: 'incident_alert', name: 'Major incident' }, 's'), { db, secret: 's', fileItem: file(db), now: t0 });
  assert.deepEqual((await settleCloudflareAlerts(db, { now: t0 + 3600e3 })).closed, []);
  assert.deepEqual((await settleCloudflareAlerts(db, { now: t0 + 25 * 3600e3 })).closed, ['CF-ALERT-incident-alert-2026-11-22']);
  assert.equal(db.raw.prepare('SELECT status FROM items').get().status, 'done');
});

test('the alert hook stays reachable when the worker shows only /health', () => {
  assert.equal(hiddenByHealthOnly({ PUBLIC_HEALTH_ONLY: '1' }, 'POST', '/hook/cloudflare'), false);
  assert.ok(POLICIES.length >= 4 && POLICIES.every(p => p.alert_type && p.name));
});
