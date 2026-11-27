// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-27: the loops `knowledge-graph` and `graph-ai` are recorded as beats beside the tick (R14), and the pulse step (seed/worker/src/pulse.js) judges
// a loop that is not in its declared list from its own beats. The three R14 tests declare their list in config.pulse.loops (the lane loops without the two
// graph loops), so they hold whether or not LANE_LOOPS lists the two loops. Defect 3 of section 7 (LANE_LOOPS does not list them, so under the default list
// a loop that never ran is not judged) has one test that pins it as it stands and one `todo` test that passes once the two loops are added to LANE_LOOPS;
// that change deletes the first and removes the `todo` option of the second.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick } from '../src/tick.js';
import { beat, readPulse, LANE_LOOPS } from '../src/pulse.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const crit = JSON.parse(readFileSync(new URL('../../autonomy/criticality.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy, criticality: crit, tick_every_min: 10 };
const T0 = Date.parse('2026-11-10T00:00:00Z'), MIN = 60e3, KG = ['knowledge-graph', 'graph-ai'];
const LANE = LANE_LOOPS.filter(l => !KG.includes(l));          // the lane loops other than the two graph loops: they beat in every slot
const undeclared = { ...config, pulse: { loops: LANE } };      // a declared list that leaves the two graph loops out, whatever LANE_LOOPS holds

// One tick slot every ten minutes; the loops in LANE always beat, the loops in `which` beat while `ran(l, i)` holds.
async function drive(db, n, { start = T0, which = KG, ran = () => true, cfg = undeclared } = {}) {
  let last;
  for (let i = 0; i < n; i++) {
    const now = start + i * 10 * MIN;
    for (const l of LANE) await beat(db, l, async () => ({ status: 'ok' }), { now: () => now + 2000 });
    for (const l of which) if (ran(l, i)) await beat(db, l, async () => ({ status: 'ok' }), { now: () => now + 2000 });
    last = await runTick(db, { config: cfg, now });
  }
  return last;
}
const item = (db, id) => db.prepare(`SELECT status, closing_probe FROM items WHERE id=?`).bind(id).first();
const clock = (db, l) => db.prepare(`SELECT declared, state, checked_at FROM loop_clock WHERE loop=?`).bind(l).first();

test('US-27-R14: a graph loop that is not declared is judged from its own beats and files MISSED-<loop> when it stops', async () => {
  const db = makeDb();
  await drive(db, 12);
  let p = await readPulse(db);
  assert.deepEqual(p.not_ticking.filter(x => KG.includes(x.loop)), [], 'while they beat they are ticking');
  for (const l of KG) { const row = await clock(db, l); assert.ok(row && row.declared === 0 && row.state === 'ticking', `${l} is judged, and as an undeclared loop`); }
  await drive(db, 8, { start: T0 + 120 * MIN, ran: () => false });
  p = await readPulse(db);
  assert.deepEqual(p.not_ticking.filter(x => KG.includes(x.loop)).map(x => [x.loop, x.state]).sort(), [['graph-ai', 'stopped'], ['knowledge-graph', 'stopped']]);
  for (const l of KG) { const it = await item(db, `MISSED-${l}`); assert.equal(it.closing_probe, `pulse:${l}`); assert.notEqual(it.status, 'done'); }
  await drive(db, 4, { start: T0 + 200 * MIN });
  for (const l of KG) assert.equal((await item(db, `MISSED-${l}`)).status, 'done', 'closed when the loop runs again');
});

test('US-27-R14: a loop that never ran is not filed unless it is declared in pulse.loops', async () => {
  let db = makeDb();
  await drive(db, 14, { which: [] });
  assert.equal(await item(db, 'MISSED-knowledge-graph'), null, 'no beat, no declaration: nothing to judge');
  assert.ok(!(await readPulse(db)).clock.some(c => c.loop === 'knowledge-graph'));
  db = makeDb();
  await drive(db, 14, { which: [], cfg: { ...config, pulse: { loops: [...LANE, ...KG] } } });
  assert.ok(await item(db, 'MISSED-knowledge-graph'), 'declared in pulse.loops, a loop that never ran files MISSED');
  assert.ok(await item(db, 'MISSED-graph-ai'));
});

test('US-27-R14: an undeclared loop first seen more than eight days ago and silent for the last day is no longer judged', async () => {
  const db = makeDb();
  await drive(db, 6);
  assert.equal(await item(db, 'MISSED-knowledge-graph'), null);
  const before = (await clock(db, 'knowledge-graph')).checked_at;
  for (const at of [T0 + 10 * 864e5, T0 + 10 * 864e5 + 10 * MIN]) await runTick(db, { config: undeclared, now: at });
  assert.equal(await item(db, 'MISSED-knowledge-graph'), null, 'first seen 10 days ago and silent for 10 days: outside both the 24 h read and the 8-day first-seen window');
  assert.equal(await item(db, 'MISSED-graph-ai'), null);
  assert.equal((await clock(db, 'knowledge-graph')).checked_at, before, 'two later ticks did not judge it at all');
});

// Defect 3 as it stands. Delete this test in the change that adds the two loops to LANE_LOOPS.
test('US-SPEC-27 defect 3 as it stands: LANE_LOOPS does not list the graph loops, so under the default list they are undeclared and one that never ran is not filed', async () => {
  assert.ok(!LANE_LOOPS.includes('knowledge-graph') && !LANE_LOOPS.includes('graph-ai'));
  let db = makeDb();
  await drive(db, 6, { cfg: config });
  for (const l of KG) assert.equal((await clock(db, l)).declared, 0, `${l} is judged as an undeclared loop`);
  db = makeDb();
  await drive(db, 14, { which: [], cfg: config });
  assert.equal(await item(db, 'MISSED-knowledge-graph'), null); assert.equal(await item(db, 'MISSED-graph-ai'), null);
});

// The closing probe of defect 3: it fails today and passes once `knowledge-graph` and `graph-ai` are in LANE_LOOPS. Remove the `todo` option then.
test('US-SPEC-27 defect 3: under the default list the graph loops are declared, so a loop that never ran files MISSED-<loop>', { todo: 'defect 3: LANE_LOOPS does not list knowledge-graph and graph-ai' }, async () => {
  let db = makeDb();
  await drive(db, 6, { cfg: config });
  for (const l of KG) assert.equal((await clock(db, l)).declared, 1, `${l} is judged as a declared loop`);
  db = makeDb();
  await drive(db, 14, { which: [], cfg: config });
  for (const l of KG) { const it = await item(db, `MISSED-${l}`); assert.ok(it, `MISSED-${l} is filed`); assert.equal(it.closing_probe, `pulse:${l}`); }
});
