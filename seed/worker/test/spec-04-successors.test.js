// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-04 (the plus loop): US-04-R03, every closed item proposes one plus, and US-04-R15, R16, the successors bounded and closed only
// on a valid item, proved against the seed runtime that implements them (worker/src/criticality.js emitSuccessors, worker/src/doer.js). Clocks are frozen, the database is in memory, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { ensureItem, runTick } from '../src/tick.js';
import { emitSuccessors, addSample, readCriticality } from '../src/criticality.js';

const crit = JSON.parse(readFileSync(new URL('../../autonomy/criticality.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-10T00:00:00Z');
const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const ctx = () => ({ now: NOW, nowIso: iso(NOW), tickId: 1, errors: [], notes: [], config: { org_slug: 'mine' } });
const done = (db, id, owner, priority, updated) => db.raw.prepare('INSERT INTO items (id, title, kind, owner_role, done_check, status, priority, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
  .run(id, 't', 'work', owner, 'd', 'done', priority, iso(NOW - 864e5), updated);

test('US-04-R03: every closed item proposes one plus, a kind plus item for the same owner with a closing probe, and never two for the same item', async () => {
  const db = makeDb();
  done(db, 'A', 'program-manager', 7, '2026-11-09 10:00:00');
  done(db, 'B', 'operations', 12, '2026-11-09 11:00:00');
  assert.equal(await emitSuccessors(db, crit, ctx(), ensureItem), 2);
  const rows = db.raw.prepare("SELECT id, kind, owner_role, priority, closing_probe, done_check FROM items WHERE id LIKE 'NEXT-%' ORDER BY id").all();
  assert.deepEqual(rows.map((r) => [r.id, r.kind, r.owner_role, r.priority, r.closing_probe]),
    [['NEXT-A', 'plus', 'program-manager', 7, 'successor:A'], ['NEXT-B', 'plus', 'operations', 12, 'successor:B']]);
  assert.ok(rows.every((r) => r.done_check), 'each carries a done check');
  assert.equal(await emitSuccessors(db, crit, ctx(), ensureItem), 0, 'a second pass proposes nothing for an item that already has its plus');
});

test('US-04-R03: an item that is itself a successor or an idle repair proposes no plus of its own', async () => {
  const db = makeDb();
  done(db, 'NEXT-Z', 'operations', 5, '2026-11-09 10:00:00');
  done(db, 'IDLE-1', 'operations', 5, '2026-11-09 10:00:00');
  assert.equal(await emitSuccessors(db, crit, ctx(), ensureItem), 0);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'NEXT-NEXT-%' OR id = 'NEXT-IDLE-1'").get().n, 0);
});

// US-04-R15, R16 (successors): emission is bounded per closed item and per tick and stops above k_max; a successor closes only when the
// model named an item with a role that exists, a done check and a closing probe.
const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const tickConfig = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const fakeAi = (answer) => { const ai = { calls: 0, async run() { ai.calls++; return { response: JSON.stringify(answer) }; } }; return ai; };

test('US-04-R15, US-04-T05: a closed item has at most one NEXT successor, one pass emits no more than the batch, and above k_max none is emitted', async () => {
  const db = makeDb();
  for (let i = 1; i <= 5; i++) done(db, `D${i}`, 'operations', 10, `2026-11-09 0${i}:00:00`);
  assert.equal(crit.successor.batch, 3);
  assert.equal(await emitSuccessors(db, crit, ctx(), ensureItem), 3, 'the batch bounds one pass');
  assert.equal(await emitSuccessors(db, crit, ctx(), ensureItem), 2, 'the rest come on the next pass');
  assert.equal(await emitSuccessors(db, crit, ctx(), ensureItem), 0, 'never a second successor for the same item');
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'NEXT-D%'").get().n, 5);
  // The control rod needs the thresholds in the tick config: without them the criticality step returns before it reaches emission at all,
  // so a missing successor would prove nothing. Each run is checked to have measured k_eff against k_max before its count is read.
  const critConfig = { ...tickConfig, criticality: crit };
  const closedX = () => { const db = makeDb(); db.raw.exec("INSERT INTO items (id,title,owner_role,done_check,status,disposition) VALUES ('X','x','operations','x','done','fixed')"); return db; };
  const nextX = (db) => db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id = 'NEXT-X'").get().n;
  const cool = closedX();
  await runTick(cool, { config: critConfig, now: NOW });
  const coolSnap = await readCriticality(cool);
  assert.ok(coolSnap && Number.isFinite(coolSnap.k_eff) && coolSnap.k_eff <= crit.k_max, `positive control: k_eff ${coolSnap && coolSnap.k_eff} is at or below k_max ${crit.k_max}`);
  assert.equal(nextX(cool), 1, 'positive control: at or below k_max the same closed item emits its NEXT successor');
  const hot = closedX();
  await addSample(hot, { source: 'github-runs', deploys_ok: 500, spend_units: 1 }, '2026-11-09 00:00:00');
  await runTick(hot, { config: critConfig, now: NOW });
  const hotSnap = await readCriticality(hot);
  assert.ok(hotSnap && hotSnap.k_eff > crit.k_max, `the sample drives k_eff ${hotSnap && hotSnap.k_eff} above k_max ${crit.k_max}`);
  assert.equal(hotSnap.emitted_successors, 0, 'the criticality step ran and emitted nothing');
  assert.equal(nextX(hot), 0, 'k_eff above k_max: the control rod is down');
});

test('US-04-R16, US-04-T06: a NEXT item answered with a valid item files PLUS-<id> and is done; an answer without a done check, a known role or a closing probe parks it and files nothing', async () => {
  const seedNext = (db, id) => {
    db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m')");
    db.raw.prepare("INSERT INTO items (id,title,owner_role,done_check,closing_probe,priority,status,created_at) VALUES (?,?,?,?,?,?,'ready',?)")
      .run(`NEXT-${id}`, `Successor of ${id}`, 'operations', 'a new item is filed', `successor:${id}`, 20, '2026-11-09 00:00:00');
  };
  const good = makeDb(); seedNext(good, 'G');
  await runTick(good, { config: tickConfig, now: NOW, ai: fakeAi({ title: 'Add a health probe', owner_role: 'operations', done_check: 'probe returns 200', closing_probe: 'GET /health' }) });
  assert.equal(good.raw.prepare("SELECT status FROM items WHERE id = 'NEXT-G'").get().status, 'done');
  assert.deepEqual({ ...good.raw.prepare("SELECT kind, owner_role, done_check, closing_probe FROM items WHERE id = 'PLUS-G'").get() },
    { kind: 'plus', owner_role: 'operations', done_check: 'probe returns 200', closing_probe: 'GET /health' });
  for (const [id, answer] of [['NODONE', { title: 'x', owner_role: 'operations', closing_probe: 'GET /x' }], ['NOROLE', { title: 'x', owner_role: 'nobody', done_check: 'y', closing_probe: 'GET /x' }],
    ['NOPROBE', { title: 'x', owner_role: 'operations', done_check: 'y' }]]) {
    const db = makeDb(); seedNext(db, id);
    await runTick(db, { config: tickConfig, now: NOW, ai: fakeAi(answer) });
    const s = db.raw.prepare('SELECT status, blocker FROM items WHERE id = ?').get(`NEXT-${id}`);
    assert.equal(s.status, 'blocked', `${id}: parked`); assert.match(s.blocker, /model answer invalid/, id);
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM items WHERE id = ?').get(`PLUS-${id}`).n, 0, `${id}: nothing filed`);
  }
});
