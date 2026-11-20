// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { progressStep, readProgress, PROGRESS_DDL, stalledSystems, _reset } from '../src/progress.js';
import { refreshFleetChanges, readLiveChanges } from '../src/livechanges.js';
import { ensureItem, METRICS } from '../src/tick.js';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const ago = h => new Date(NOW - h * 3600e3).toISOString();
const config = { progress: { expect_hours: 24, stall: 2, cooldown_hours: 6, systems: [
  { id: 'core', name: 'Core', repo: 'o/core', url: 'https://core', expect_hours: 24, heal: ['executor.yml'] },
  { id: 'tenant', name: 'Tenant', repo: 'o/tenant', expect_hours: 24, heal: ['agent.yml', 'discover.yml'] }] } };
const add = (db, repo, n, title, at) => db.prepare('INSERT OR REPLACE INTO live_changes (n, repo, title, by_origin, merged_at, url) VALUES (?,?,?,?,?,?)').bind(n, repo, title, 'agent session', at, 'https://gh/' + repo + '/' + n).run();
const withBatch = db => Object.assign(db, { batch: async ss => { for (const s of ss) await s.run(); } });

test('the Worker DDL equals the migration', () => {
  const sql = readFileSync(new URL('../migrations/0028_progress.sql', import.meta.url), 'utf8');
  for (const d of PROGRESS_DDL) assert.ok(sql.includes(d), 'migration carries: ' + d.slice(0, 60));
});

test('a moving system is left alone; a stalled one has its producers dispatched once per cooldown and files STALL-<id>', async () => {
  _reset(); const db = makeDb(), calls = [];
  await add(db, 'o/core', 1, 'Add the progress page', ago(3));
  await add(db, 'o/tenant', 5, 'New solution entries', ago(60));
  await add(db, 'o/tenant', 6, 'host-sync - record deployed tenant-web', ago(1));  // bookkeeping: happened, never counted as progress
  const fetchImpl = async (u, o) => { calls.push(u); return { status: 204 }; };
  const r = await progressStep({ db, config, token: 't', ensureItem, fetchImpl, now: NOW });
  assert.deepEqual(r.systems, { core: 'moving', tenant: 'stalled' });
  assert.deepEqual(calls, ['https://api.github.com/repos/o/tenant/actions/workflows/agent.yml/dispatches', 'https://api.github.com/repos/o/tenant/actions/workflows/discover.yml/dispatches']);
  assert.deepEqual(r.filed, ['STALL-tenant']);
  assert.equal((await db.prepare(`SELECT status, closing_probe FROM items WHERE id='STALL-tenant'`).first()).closing_probe, 'progress:tenant');
  assert.equal(await stalledSystems(db), 1);
  assert.equal(await METRICS.stalled_systems(db, NOW), 1);
  const again = await progressStep({ db, config, token: 't', ensureItem, fetchImpl, now: NOW + 3600e3 });
  assert.equal(calls.length, 2, 'inside the cooldown nothing is dispatched again');
  assert.deepEqual(again.healed, []);
  const later = await progressStep({ db, config, token: 't', ensureItem, fetchImpl, now: NOW + 7 * 3600e3 });
  assert.deepEqual(later.healed, ['tenant']);
  // the tenant ships: the same reading closes the item
  await add(db, 'o/tenant', 7, 'Release 2026.11.27', new Date(NOW + 8 * 3600e3).toISOString());
  const moved = await progressStep({ db, config, token: 't', ensureItem, fetchImpl, now: NOW + 9 * 3600e3 });
  assert.deepEqual(moved.closed, ['STALL-tenant']);
  assert.equal((await db.prepare(`SELECT status FROM items WHERE id='STALL-tenant'`).first()).status, 'done');
});

test('a system with no cached change is unmeasured, never moving, and is not healed blindly', async () => {
  _reset(); const db = makeDb(), calls = [];
  const r = await progressStep({ db, config, token: 't', ensureItem, fetchImpl: async u => { calls.push(u); return { status: 204 }; }, now: NOW });
  assert.deepEqual(r.systems, { core: 'unmeasured', tenant: 'unmeasured' });
  assert.equal(calls.length, 0);
  assert.equal((await progressStep({ db, config: {}, now: NOW })).status, 'no-config');
});

test('readProgress returns the judged systems and only real merged changes, newest first', async () => {
  _reset(); const db = makeDb();
  await add(db, 'o/core', 1, 'Older', new Date(Date.now() - 5 * 3600e3).toISOString());
  await add(db, 'o/core', 2, 'Newer', new Date(Date.now() - 1 * 3600e3).toISOString());
  await add(db, 'o/other', 9, 'Not a listed system', new Date().toISOString());
  await progressStep({ db, config, ensureItem });
  const p = await readProgress(db, config);
  assert.deepEqual(p.events.map(e => e.title), ['Newer', 'Older']);
  assert.equal(p.systems.find(s => s.id === 'core').state, 'moving');
  assert.equal(p.systems.find(s => s.id === 'tenant').state, 'unmeasured');
  assert.equal(p.events[0].id, 'core#2');
});

test('fleet repositories are read at most once per interval and /live keeps reading one repository', async () => {
  _reset(); const db = withBatch(makeDb()); let n = 0;
  const f = async () => { n++; return { ok: true, status: 200, text: async () => JSON.stringify([{ number: 3, title: 'x', merged_at: ago(2), html_url: 'u', head: { ref: 'agent/x' }, body: '' }]) }; };
  assert.deepEqual(await refreshFleetChanges({ db, token: 't', repos: ['o/tenant'], fetch: f, now: NOW }), { 'o/tenant': 1 });
  assert.deepEqual(await refreshFleetChanges({ db, token: 't', repos: ['o/tenant'], fetch: f, now: NOW + 600e3 }), { 'o/tenant': 'fresh' });
  assert.equal(n, 1);
  await add(db, 'o/core', 3, 'core change', ago(1));
  assert.deepEqual((await readLiveChanges(db, 'o/core')).changes.map(c => c.title), ['core change']);
  assert.equal((await readLiveChanges(db)).changes.length, 2);
});
