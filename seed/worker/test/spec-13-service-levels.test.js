// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-13 (dashboard, service levels, report cards): US-13-R14, US-13-T06 (the change-request ladder of doctrine/sla.json, src/sla.js and
// src/sweeper.js) and US-13-R16, US-13-T07 (the tick step age_sla), proved against the seed runtime that implements them. Clocks are frozen,
// the database is in memory, GitHub is a recording fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick } from '../src/tick.js';
import { SLA, prTier, portItemId } from '../src/sla.js';
import { sweepOpenLoops, alarmStalls } from '../src/sweeper.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const SLA_TABLE = new URL('../../../doctrine/sla.json', import.meta.url);   // the written table; only the monorepo holds it, so a seed checkout reads the defaults alone
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const MIN = 60e3;

function github(state) {
  const calls = [];
  const f = async (url, o = {}) => {
    const m = o.method || 'GET', path = url.replace('https://api.github.com', ''); calls.push(m + ' ' + path);
    const R = (j, ok = true, status = 200) => ({ ok, status, text: async () => JSON.stringify(j) });
    if (m === 'GET' && path.startsWith('/repos/o/r/pulls?')) return R(state.prs);
    if (m === 'GET' && /pulls\/\d+$/.test(path)) return R(state.detail);
    if (m === 'GET' && path.includes('/files')) return R([]);
    if (m === 'POST' && path.endsWith('/merges')) return R({}, false, 409);   // main cannot be merged in: the conflict stays
    if (m === 'GET' && path.includes('labels=')) return R([]);
    if (m === 'POST' && path.endsWith('/issues')) return R({ number: 9 });
    if (m === 'GET' && path.includes('/check-runs')) return R({ total_count: 1 });
    // PR-NEVER-LOSE-1: GitHub refuses to update a branch that really conflicts, the head is not in main, and a pin under refs/archive reads back
    if (m === 'PUT' && path.endsWith('/update-branch')) return R({ message: 'merge conflict between base and head' }, false, 422);
    if (m === 'GET' && path.includes('/compare/')) return R({ ahead_by: 2 });
    if (m === 'POST' && path.endsWith('/git/refs')) { const b = JSON.parse(o.body); (state.pins ||= {})[b.ref.replace('refs/', '')] = b.sha; return R({}, true, 201); }
    if (m === 'GET' && path.includes('/git/ref/archive/')) return R({ object: { sha: (state.pins || {})['archive/' + path.split('/git/ref/archive/')[1]] } });
    return R({});
  };
  return { f, calls };
}

test('US-13-T06 and US-13-R14: an agent branch request open 70 minutes and idle 40 that is not merge-ready is tier supersede; merge-ready it is ok', () => {
  if (existsSync(SLA_TABLE)) {
    const { pr } = JSON.parse(readFileSync(SLA_TABLE, 'utf8'));
    assert.deepEqual(SLA.pr, { green_merge_min: pr.green_merge_min, act_min: pr.act_min, hard_min: pr.hard_min, idle_min: pr.idle_min }, 'the minutes the tick enforces are the written table');
  }
  for (const state of ['dirty', 'blocked', 'unstable']) {
    assert.equal(prTier({ ageMin: 70, idleMin: 40, state, branch: 'agent/item-slug' }), 'supersede', state);
  }
  // PR-NEVER-LOSE-1: a branch that is only behind, or a state GitHub has not computed yet, is never closed on this clock
  for (const state of ['behind', 'unknown', '', undefined]) {
    assert.equal(prTier({ ageMin: 70, idleMin: 40, state, branch: 'agent/item-slug' }), 'ok', String(state));
  }
  assert.equal(prTier({ ageMin: 70, idleMin: 40, state: 'clean', branch: 'agent/item-slug' }), 'ok', 'a merge-ready request is never superseded');
  assert.equal(prTier({ ageMin: 20, idleMin: 20, state: 'dirty', branch: 'agent/item-slug' }), 'act', 'past the first limit it is acted on');
  assert.equal(prTier({ ageMin: 70, idleMin: 10, state: 'dirty', branch: 'agent/item-slug' }), 'act', 'past the hard limit but not idle: acted on, not superseded');
  assert.equal(prTier({ ageMin: 10, idleMin: 10, state: 'dirty', branch: 'agent/item-slug' }), 'ok');
});

test('US-13-R14: the sweeper supersedes such a request on its pass, keeps its branch and files one item that carries the work', async () => {
  const NOW = Date.parse('2026-11-13T12:00:00Z');
  const p = { number: 31, state: 'open', head: { ref: 'claude/q-1-slug', sha: 's1abcdef' }, created_at: new Date(NOW - 70 * MIN).toISOString(), updated_at: new Date(NOW - 40 * MIN).toISOString() };
  const gh = { prs: [p], detail: { ...p, mergeable: false, mergeable_state: 'dirty' } };
  const { f, calls } = github(gh);
  const r = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: f, now: NOW });
  assert.deepEqual(r.superseded, ['o/r#31']);
  assert.ok(calls.includes('PATCH /repos/o/r/pulls/31'), 'the request is closed');
  assert.equal(gh.pins['archive/pr-31-s1abcde'], 's1abcdef', 'its head is pinned under refs/archive before the close');
  assert.ok(calls.indexOf('POST /repos/o/r/git/refs') < calls.indexOf('PATCH /repos/o/r/pulls/31'), 'pinned first, closed after');
  assert.ok(!calls.some(c => c.startsWith('DELETE') && c.includes('/git/refs/')), 'its branch is kept');
  const filed = []; const ensureItem = async (_db, it) => { if (filed.some(x => x.id === it.id)) return false; filed.push(it); return true; };
  await alarmStalls(null, r, ensureItem); await alarmStalls(null, r, ensureItem);
  const carriers = filed.filter(x => x.id.startsWith('PORT-BRANCH-'));   // the stall alarm files its own item beside it
  assert.deepEqual(carriers.map(x => x.id), [portItemId('claude/q-1-slug')], 'one item carries the branch onto main, filed once');
  assert.match(carriers[0].done_check, /claude\/q-1-slug/);
  const ready = { ...p, number: 32 };
  const g = github({ prs: [ready], detail: { ...ready, mergeable_state: 'clean' } });
  const r2 = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: g.f, now: NOW });
  assert.ok(!(r2.superseded || []).includes('o/r#32'), 'a merge-ready request of the same age is not superseded');
});

test('US-13-T07 and US-13-R16: an item created 4 hours ago at priority 40 is raised to priority 5 with one cause item for the day; a second tick files no second one', async () => {
  const T0 = Date.parse('2026-11-10T00:00:00Z');
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status,created_at) VALUES ('AGED','four hours old','nobody','x',40,'open','2026-11-09 20:00:00');`);
  const r = await runTick(db, { config, now: T0 });
  assert.deepEqual(r.errors, []);
  assert.equal(db.raw.prepare(`SELECT priority FROM items WHERE id='AGED'`).get().priority, 5);
  const causes = () => db.raw.prepare(`SELECT id FROM items WHERE id LIKE 'AGE-120M-%'`).all().map(x => x.id);
  assert.deepEqual(causes(), ['AGE-120M-2026-11-10']);
  await runTick(db, { config, now: T0 + 10 * MIN });
  assert.deepEqual(causes(), ['AGE-120M-2026-11-10'], 'the cause is filed at most once a day');
});
