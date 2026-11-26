// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-26 (the build-loop reading of the reference implementation): each test is named by the requirement it proves.
// A frozen clock and an in-memory database stand in for a deployment; nothing here reaches a network or a code host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from '../_shared/testdb.js';
import { OUT_DIR } from '../../tools/build_migrations.mjs';
import { create, steps, SPEC_FORMAT } from './index.js';

const T0 = Date.parse('2026-11-15T10:00:00Z');
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const put = (db, id, o = {}) => db.raw.prepare('INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, status, blocker, priority) VALUES (?,?,?,?,?,?,?,?,?)')
  .run(id, o.title || `Outcome: ${id} thing`, o.kind || 'work', 'operations', o.done || 'x', o.probe || 'manual', o.status || 'ready', o.blocker || null, o.priority ?? 10);
const q = (db, sql, ...a) => db.raw.prepare(sql).all(...a);
const mk = (db, over = {}) => { const c = { t: T0 }; const k = create({ db, now: () => c.t, ...over }); return { k, c }; };

test('US-26-R73: the build-loop reading gives a doer-less item a specification to write, once, and never one that a probe or a target already settles', async () => {
  const db = makeDb([OUT_DIR]);
  put(db, 'A', { title: 'Outcome: A booking prototype that ten neighbours try' }); put(db, 'B', { probe: 'env:SOME_NAME' }); put(db, 'C', { done: 'x; target: app/c.js' });
  put(db, 'D', { kind: 'ladder' }); put(db, 'E', { status: 'done' });
  put(db, 'F'); db.raw.exec("INSERT INTO claims (item_id, agent) VALUES ('F', 'op-1')");
  const evalProbe = async it => (/^env:/.test(it.closing_probe) ? { ok: false } : null);
  const { k } = mk(db, { evalProbe });
  assert.deepEqual(await k.specify(), { specified: 1, released: 0, retried: 0 });
  assert.deepEqual(await k.specify(), { specified: 0, released: 0, retried: 0 }, 'an item is specified once');
  const a = q(db, "SELECT done_check, closing_probe FROM items WHERE id = 'A'")[0];
  assert.match(a.done_check, /^x; first step: write the specification for this item as a markdown file: a title line "# US-SPEC-01 <name>", numbered requirements with MUST\/SHOULD and stable ids/);
  assert.match(a.done_check, /; spec: US-SPEC-01; target: specs\/US-SPEC-01-booking-prototype-ten-neighbours\.md$/);
  assert.equal(a.closing_probe, "SELECT COUNT(*) FROM specloop_lines WHERE spec = 'US-SPEC-01'");
  assert.ok(SPEC_FORMAT.includes('PLANNED') && SPEC_FORMAT.includes('Reference implementation status'));
  for (const id of ['B', 'C', 'D', 'E', 'F']) assert.equal(q(db, 'SELECT done_check FROM items WHERE id = ?', id)[0].done_check.includes('first step'), false, id);
  assert.deepEqual(q(db, 'SELECT item_id, spec, path FROM criticality_specs').map(r => ({ ...r })), [{ item_id: 'A', spec: 'US-SPEC-01', path: 'specs/US-SPEC-01-booking-prototype-ten-neighbours.md' }]);
  // numbers are never reused: the next is the lowest one no specification or spec line holds, and at most max_per_tick items are taken
  put(db, 'G'); db.raw.exec("INSERT INTO specloop_lines (id, spec, capability, label, first_seen, last_seen) VALUES ('US-SPEC-02-1', 'US-SPEC-02', 'c', 'PLANNED', 'a', 'a')");
  const second = mk(db, { evalProbe, config: { max_per_tick: 1, first_spec: 1 } });
  assert.equal((await second.k.specify()).specified, 1);
  assert.equal(q(db, "SELECT spec FROM criticality_specs WHERE item_id = 'G'")[0].spec, 'US-SPEC-03');
});

test('US-26-R73: a run the runner refused for a fault of the attempt is put back after the wait, at most twice, and one it parked for want of a target is released', async () => {
  const db = makeDb([OUT_DIR]);
  put(db, 'P', { status: 'blocked', blocker: 'runner no_target: no file named', done: 'x; target: a.js' });
  put(db, 'R', { status: 'blocked', blocker: 'runner invalid_output: bad json decision card card-1', done: 'x; target: b.js' });
  db.raw.exec("INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe) VALUES ('card-1','w','y','d','manual')");
  const { k, c } = mk(db);
  assert.deepEqual(await k.specify(), { specified: 0, released: 1, retried: 0 }, 'the first sight of a refused run starts the clock');
  assert.equal(q(db, "SELECT status FROM items WHERE id = 'P'")[0].status, 'ready');
  assert.equal(q(db, "SELECT n, last_reason FROM criticality_retries WHERE item_id = 'R'")[0].n, 0);
  c.t += 59 * 60e3; assert.equal((await k.specify()).retried, 0, 'not before retry_after_minutes');
  c.t += 2 * 60e3; assert.equal((await k.specify()).retried, 1);
  assert.deepEqual([q(db, "SELECT status, blocker FROM items WHERE id = 'R'")[0].status, q(db, "SELECT status FROM gate_cards WHERE id = 'card-1'")[0].status], ['ready', 'closed']);
  for (let i = 0; i < 2; i++) { db.raw.exec("UPDATE items SET status = 'blocked', blocker = 'runner invalid_output: again' WHERE id = 'R'"); c.t += 61 * 60e3; await k.specify(); }
  assert.equal(q(db, "SELECT n FROM criticality_retries WHERE item_id = 'R'")[0].n, 2);
  db.raw.exec("UPDATE items SET status = 'blocked', blocker = 'runner invalid_output: again' WHERE id = 'R'"); c.t += 61 * 60e3;
  assert.equal((await k.specify()).retried, 0, 'past max_retries it stays parked');
  assert.equal(q(db, "SELECT status FROM items WHERE id = 'R'")[0].status, 'blocked');
});

test('US-26-R73: the loop is measured once a tick: idle with no work, building, stalled with its root cause named after no movement, self-sustaining on a merge', async () => {
  const db = makeDb([OUT_DIR]);
  const { k, c } = mk(db, { config: { stall_ticks: 3 }, needs: async () => ['GITHUB_TOKEN', 'ANTHROPIC_API_KEY'] });
  let m = await k.measure();
  assert.equal(m.regime, 'idle'); assert.equal(m.active, 0);
  put(db, 'W', { done: 'x; target: app/w.js' });
  const regimes = [];
  for (let i = 0; i < 5; i++) { c.t += 600e3; regimes.push((await k.measure()).regime); }
  assert.deepEqual(regimes, ['building', 'building', 'stalled', 'stalled', 'stalled'], 'stalled once stall_ticks ticks in a row, this one included, moved nothing while work was active');
  const stall = q(db, "SELECT title, status, priority, owner_role FROM items WHERE id = 'CRIT-STALL'")[0];
  assert.equal(stall.status, 'ready'); assert.equal(stall.priority, 0); assert.equal(stall.owner_role, 'operations');
  assert.equal(stall.title, 'The build loop has not moved for 3 ticks: no doer: missing GITHUB_TOKEN, ANTHROPIC_API_KEY');
  assert.equal(q(db, "SELECT COUNT(*) n FROM items WHERE id = 'CRIT-STALL'")[0].n, 1, 'one item, however long it stalls');
  assert.equal(q(db, 'SELECT cause FROM criticality_log ORDER BY id DESC LIMIT 1')[0].cause, 'no doer: missing GITHUB_TOKEN, ANTHROPIC_API_KEY');
  db.raw.exec("UPDATE items SET status = 'done', disposition = 'fixed' WHERE id = 'W'"); put(db, 'W2', { done: 'x; target: app/w2.js' });
  c.t += 600e3; m = await k.measure();
  assert.equal(m.regime, 'building', 'a closed item is movement');
  assert.deepEqual({ ...q(db, "SELECT status, disposition FROM items WHERE id = 'CRIT-STALL'")[0] }, { status: 'done', disposition: 'loop building again (criticality_log)' });
  db.raw.prepare("INSERT INTO outcomes (item_id, surface, action_class, result, evidence, at) VALUES ('W2','repo','merge','verified','probe:x', ?)").run(iso(c.t));
  c.t += 600e3; assert.equal((await k.measure()).regime, 'self-sustaining', 'a verified merge since the last tick');
  const org = JSON.parse(q(db, "SELECT value FROM org WHERE key = 'criticality'")[0].value);
  assert.deepEqual([org.regime, org.active, org.merged_total], ['self-sustaining', 1, 1]);
  const cols = q(db, 'SELECT moved, regime FROM criticality_log ORDER BY id').map(r => r.regime);
  assert.equal(cols.length, 8, 'one row per tick');
});

test('US-26-R73: the stall names the first cause the state shows, and the two tick steps are on unless config.enabled is false', async () => {
  const cause = async (setup, needs = async () => []) => {
    const db = makeDb([OUT_DIR]); put(db, 'W', { done: 'x; target: app/w.js' }); setup(db);
    const { k, c } = mk(db, { config: { stall_ticks: 2 }, needs });
    let m; for (let i = 0; i < 4; i++) { c.t += 600e3; m = await k.measure(); }
    assert.equal(m.regime, 'stalled'); return m.cause;
  };
  assert.equal(await cause(() => {}), 'takeable work exists and nothing started it');
  assert.equal(await cause(() => {}, async () => ['X']), 'no doer: missing X', 'a missing credential is named before anything else');
  assert.equal(await cause(db => db.raw.exec("UPDATE items SET status = 'blocked', blocker = 'parked for a reason', done_check = 'x'")), 'nothing takeable: every active item is blocked or waits on a probe');
  assert.equal(await cause(db => db.raw.exec("INSERT INTO runner_runs (item_id, state, reason, created_at, updated_at) VALUES ('W', 'refused', 'no_target', '2026-11-15 09:00:00', '2026-11-15 09:00:00')")), 'runs are refused: no_target (1)');
  assert.match(await cause(db => { put(db, 'S', { status: 'blocked', blocker: 'runner invalid_output: bad', done: 'x; target: s.js' }); db.raw.exec("INSERT INTO criticality_retries (item_id, n, last_at) VALUES ('S', 2, '2026-11-15 00:00:00')"); }),
    /^1 item\(s\) still refused after 2 retries: the doer's output is not accepted/);
  const db = makeDb([OUT_DIR]); put(db, 'P', { status: 'blocked', blocker: 'waiting on probe: env:X' });
  const { k, c } = mk(db, { config: { stall_ticks: 2 } });
  for (let i = 0; i < 4; i++) { c.t += 600e3; assert.equal((await k.measure()).regime, 'idle', 'an item parked on a probe the world answers is not work the loop owes'); }
  const ports = { db: makeDb([OUT_DIR]), now: () => T0, config: {} };
  const on = steps(ports); assert.deepEqual([on.before.map(s => s.name), on.after.map(s => s.name)], [['criticality_specify'], ['criticality']]);
  assert.deepEqual(steps({ ...ports, config: { enabled: false } }), { before: [], after: [] });
  const ctx = { notes: [] }; await on.after[0].run(null, ctx);
  assert.equal(ctx.notes[0], 'criticality: idle; 0 active, 0 takeable, 0 done, 0 merged');
});
