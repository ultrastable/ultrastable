// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-14-T03 at the HTTP level: Cloud Scheduler may deliver one firing twice; the Cloud Run /tick route runs one tick per slot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../sqlite/d1-sqlite.js';
import { createServer, loadConfig } from '../server.js';
import { SLOT_MS } from '../../shared/slot.js';

const MIG = fileURLToPath(new URL('../../../core/migrations', import.meta.url));
const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);

async function boot() {
  const db = openDb(':memory:', MIG);
  const clock = { t: T0 };
  const srv = createServer({ db, config: loadConfig({}), env: { TICK_TOKEN: 's3cret' }, now: () => clock.t });
  await new Promise(r => srv.listen(0, r));
  const post = () => fetch(`http://127.0.0.1:${srv.address().port}/tick`, { method: 'POST', headers: { 'x-tick-token': 's3cret' } });
  const close = () => { srv.closeAllConnections?.(); srv.close(); db.close(); };
  return { db, clock, post, close };
}
const ticks = db => db.raw.prepare('SELECT COUNT(*) AS n FROM tick_runs').get().n;

test('US-14-T03: the Cloud Run /tick request sent twice in one slot leaves one tick row; the next slot runs', async () => {
  const { db, clock, post, close } = await boot();
  try {
    const first = await post(); assert.equal(first.status, 200);
    const again = await (await post()).json();
    assert.deepEqual({ ran: again.ran, duplicate: again.duplicate }, { ran: false, duplicate: true });
    assert.equal(ticks(db), 1);
    clock.t += SLOT_MS;
    assert.equal((await post()).status, 200);
    assert.equal(ticks(db), 2);
    const slots = db.raw.prepare('SELECT outcome FROM sched_slots ORDER BY slot').all().map(r => r.outcome);
    assert.equal(slots.length, 2); assert.ok(slots.every(o => o === 'completed' || o === 'incomplete'));
  } finally { close(); }
});
