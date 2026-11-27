// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Q-LESSON-METRIC-FRESH: every metric names a producer, and a metric whose last good reading is older than twice the tick cadence files a
// liveness breach (STALE-<id>) through ensureItem, closed once a reading is fresh again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick, LIVENESS, METRICS } from '../src/tick.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy, tick_every_min: 10 };
const T0 = Date.parse('2026-11-10T00:00:00Z');
const MIN = 60e3;

test('Q-LESSON-METRIC-FRESH: every seeded metric row names a producer that exists', async () => {
  for (const [id, , spec] of LIVENESS) assert.equal(typeof METRICS[spec], 'function', `${id} names builtin ${spec}, which must exist`);
  const db = makeDb();
  await runTick(db, { config, now: T0 });
  const rows = db.raw.prepare('SELECT id, source, spec FROM metrics').all();
  assert.ok(rows.length >= LIVENESS.length);
  for (const r of rows) {
    assert.ok(['builtin', 'sql', 'http'].includes(r.source), `${r.id} has a probe source`);
    assert.ok(r.spec && r.spec.trim(), `${r.id} names its producer`);
  }
});

test('US-17-R17, US-05-R17, US-05-T07, Q-LESSON-METRIC-FRESH: a reading older than twice the cadence files STALE-<id>; a fresh reading closes it', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO metrics (id,name,kind,source,spec,op,threshold,owner_role,remedy)
    VALUES ('M-x','x','target','sql','SELECT 0','<=',0,'operations','r');`);
  await runTick(db, { config, now: T0 });
  await runTick(db, { config, now: T0 + 10 * MIN });
  assert.equal(db.raw.prepare("SELECT 1 AS x FROM items WHERE id='STALE-M-x'").get(), undefined, 'a reading within the cadence is fresh');
  const r = await runTick(db, { config, now: T0 + 60 * MIN });   // 50 minutes since the last reading, cadence 10
  const it = db.raw.prepare("SELECT status, priority, owner_role, title FROM items WHERE id='STALE-M-x'").get();
  assert.ok(it, 'stale metric filed'); assert.equal(it.priority, 0); assert.equal(it.owner_role, 'operations');
  assert.match(it.title, /stale_metric/); assert.match(r.report, /stale/);
  await runTick(db, { config, now: T0 + 70 * MIN });
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='STALE-M-x'").get().status, 'done', 'closed once the reading is fresh');
});

test('US-17-R17, US-05-R17, Q-LESSON-METRIC-FRESH: a probe that keeps failing keeps its old reading time and goes stale', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO metrics (id,name,kind,source,spec,op,threshold,owner_role,remedy)
    VALUES ('M-y','y','target','sql','SELECT 0','<=',0,'operations','r');`);
  await runTick(db, { config, now: T0 });
  const before = db.raw.prepare("SELECT last_at FROM metrics WHERE id='M-y'").get().last_at;
  db.raw.exec("UPDATE metrics SET spec='DELETE FROM items' WHERE id='M-y'");
  await runTick(db, { config, now: T0 + 10 * MIN });
  assert.equal(db.raw.prepare("SELECT last_at FROM metrics WHERE id='M-y'").get().last_at, before, 'a failed read is not a reading');
  await runTick(db, { config, now: T0 + 30 * MIN });
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='STALE-M-y'").get().status, 'ready');
});
