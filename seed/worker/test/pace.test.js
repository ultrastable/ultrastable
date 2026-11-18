// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { beat } from '../src/pulse.js';
import { isIdle, strideFor, paced, rankRows, PACE_DEFAULTS } from '../src/pace.js';
import { pickForRole } from '../src/critloop.js';
import { METRICS, LIVENESS } from '../src/tick.js';

const T0 = Date.parse('2026-11-10T00:00:00Z');
const cfg = { pace: JSON.parse(readFileSync(new URL('../../autonomy/pace.json', import.meta.url), 'utf8')) };

test('PACE-2: the shipped pace.json carries every key the code reads', () => {
  for (const k of Object.keys(PACE_DEFAULTS)) assert.ok(k in cfg.pace, k);
});

test('PACE-2: isIdle reads a recorded result', () => {
  for (const d of [null, 'null', '{}', '[]', '{"status":"ok","merged":[],"n":0}', '{"closed":[],"filed":[]}']) assert.equal(isIdle(d), true, String(d));
  for (const d of ['{"merged":[12]}', '{"status":"ok","n":2}', '{"status":"error x"}', '{"merged":[1,2', '[{"ok":true}]']) assert.equal(isIdle(d), false, d);
});

test('PACE-2: an idle loop backs off to stride 2 then 4, a run with work resets it, never_pace loops always run', async () => {
  const db = makeDb(); let t = T0;
  const run = (loop, out) => beat(db, loop, async () => out, { now: () => (t += 60e3) });
  assert.equal(await strideFor(db, 'sweeper', cfg), 1);
  for (let i = 0; i < 4; i++) await run('sweeper', { status: 'ok', closed: [] });
  assert.equal(await strideFor(db, 'sweeper', cfg), 2);
  assert.deepEqual(await paced(db, 'sweeper', 3, cfg), { paced: true, stride: 2 });
  assert.equal(await paced(db, 'sweeper', 4, cfg), null);
  await run('sweeper', { paced: true, stride: 2 });  // a paced beat is not a real run and does not count either way
  for (let i = 0; i < 4; i++) await run('sweeper', {});
  assert.equal(await strideFor(db, 'sweeper', cfg), 4);
  for (let i = 0; i < 8; i++) await run('sweeper', {});
  assert.equal(await strideFor(db, 'sweeper', cfg), 4);  // max_stride
  await run('sweeper', { closed: ['Q-1'] });
  assert.equal(await strideFor(db, 'sweeper', cfg), 1);
  for (let i = 0; i < 9; i++) await run('lane', {});
  assert.equal(await strideFor(db, 'lane', cfg), 1);
  await run('gate', { status: 'error boom' });  // a failing loop is not idle: it keeps running so its failure stays visible
  assert.equal(await strideFor(db, 'gate', cfg), 1);
});

test('PACE-2: paced beats are not progress in beats_productive_share_24h', async () => {
  const db = makeDb(); const t = T0;
  await beat(db, 'a', async () => ({ done: ['x'] }), { now: () => t });
  await beat(db, 'b', async () => ({ paced: true, stride: 2 }), { now: () => t });
  assert.equal(await METRICS.beats_productive_share_24h(db, T0 + 60e3), 0.5);
});

test('PACE-2: rank orders by reach per cost inside one priority; priority still wins', async () => {
  const rows = [{ id: 'Q-UNK-1', priority: 30 }, { id: 'Q-PROMO-1', priority: 30 }, { id: 'X-1', priority: 30 }, { id: 'Q-UNK-0', priority: 10 }];
  assert.deepEqual(rankRows(rows, cfg.pace.rank).map(r => r.id), ['Q-UNK-0', 'Q-PROMO-1', 'X-1', 'Q-UNK-1']);
  assert.deepEqual(rankRows(rows).map(r => r.id), ['Q-UNK-0', 'Q-UNK-1', 'Q-PROMO-1', 'X-1']);
  const db = makeDb();
  for (const [id, at] of [['Q-UNK-1', '2026-11-01'], ['Q-PROMO-1', '2026-11-02']])
    db.raw.prepare(`INSERT INTO items (id, title, owner_role, done_check, priority, status, created_at) VALUES (?, 't', 'operations', 'd', 30, 'ready', ?)`).run(id, at);
  assert.equal((await pickForRole(db, { role: 'operations', project: null }, null, cfg.pace.rank)).id, 'Q-PROMO-1');
  assert.equal((await pickForRole(db, { role: 'operations', project: null }, null)).id, 'Q-UNK-1');
});

test('PACE-2: free_tier_peak_share is the largest free-limit share of the latest samples, 0 with none; M-cost is seeded from it', async () => {
  const db = makeDb(); const now = Date.parse('2026-11-10T12:00:00Z');
  assert.equal(await METRICS.free_tier_peak_share(db, now), 0);
  const at = new Date(now - 600e3).toISOString().replace('T', ' ').slice(0, 19);
  db.raw.exec(`CREATE TABLE IF NOT EXISTS free_tier_samples (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, resource TEXT, used_today REAL, error TEXT)`);
  db.raw.prepare(`INSERT INTO free_tier_samples (at, resource, used_today) VALUES (?,?,?)`).run(at, 'workers_requests', 25000);
  db.raw.prepare(`INSERT INTO free_tier_samples (at, resource, used_today) VALUES (?,?,?)`).run(at, 'ai_neurons', 4000);
  assert.equal(await METRICS.free_tier_peak_share(db, now), 0.4);
  assert.ok(LIVENESS.some(l => l[0] === 'M-cost' && l[2] === 'free_tier_peak_share'));
});

test('PACE-2: the sweeper\'s real result (a gauge that moves between runs) is idle; a deferred run is skipped when counting', async () => {
  const sweeper = g => ({ status: 'ok', merged: [], refreshed: [], filed: [], lane_owned: [], released: [], errors: [], open_loop_age_hours: g });
  assert.equal(isIdle(JSON.stringify(sweeper(1.4))), true);
  assert.equal(isIdle(JSON.stringify({ ...sweeper(0), merged: ['#1'] })), false);
  const db = makeDb(); let t = T0;
  const run = (loop, out) => beat(db, loop, async () => out, { now: () => (t += 60e3) });
  for (const g of [0.3, 0, 0.7, 1.4]) await run('sweeper', sweeper(g));
  await run('sweeper', { status: 'deferred', reason: 'needs 8 subrequests, 3 left', used: 43, limit: 46, refused: 0 });
  assert.equal(await strideFor(db, 'sweeper', cfg), 2);
});
