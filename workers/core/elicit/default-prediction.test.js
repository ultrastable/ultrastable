// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-16 R19 in the composed organization: a default that held is graded a hit by the kernel scorer, on its own review time, and is never a failed prediction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { OUT_DIR } from '../../tools/build_migrations.mjs';
import { createOrg } from '../org/index.js';
import { buildConsole } from '../src/console.js';
import { runTick } from '../src/tick.js';
import { createElicit, elicitMetrics, DEFAULT_HOLDS_METRIC } from './index.js';
import { elicitDutiesStep } from './duties-step.js';

const T0 = Date.UTC(2026, 10, 20, 9, 0, 0); const HOUR = 3600e3;
const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const NEED = { id: 'a', label: 'Thing a', artifact: 'charter', question: 'Which a do you want?', why: 'This changes the a we build.', cue: 'Similar projects pick the first one.',
  options: ['first', 'second'], default: 'first', default_consequence: 'We rebuild one page; change it any time.', p_wrong: 0.5 };
const get = (db, sql, ...a) => db.raw.prepare(sql).get(...a);

async function org(extra = {}) {
  const db = makeDb([OUT_DIR]); const clock = { t: T0 };
  const o = createOrg({ db, env: { CONSOLE_TOKEN: 't' }, config: { org_slug: 'o', version: '1', runner: { enabled: false }, policy, elicit: { defer_below: 0, max_open: 9, daily_cap: 99 } },
    fetch: async () => { throw new Error('no network in this test'); }, now: () => clock.t, ...extra });
  const e = o.surfaces.elicit;
  await e.registerNeeds('demo', [NEED]); await e.nextAsks('demo');
  return { db, clock, o, e, tick: async ms => { clock.t += ms; return o.tick(); } };
}

test('US-16-R19 and T16-13: in the composed organization a default still standing at its review time is graded a hit by the kernel, counted right on Progress and never a lesson', async () => {
  const { db, tick } = await org({ metrics: elicitMetrics });
  await tick(80 * HOUR);
  assert.equal(get(db, `SELECT state FROM elicit_needs WHERE id='a'`).state, 'defaulted');
  const p0 = get(db, `SELECT metric, due_at, verdict FROM predictions WHERE id='ELICIT-demo-a'`);
  assert.equal(p0.metric, DEFAULT_HOLDS_METRIC); assert.equal(p0.verdict, null); assert.match(p0.due_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  const audits = get(db, `SELECT COUNT(DISTINCT run_id) AS n FROM elicit_audit`).n;
  const r = await tick(30 * 24 * HOUR + HOUR);
  assert.equal(r.completed, r.total, JSON.stringify(r.errors));
  const p = get(db, `SELECT verdict, observed FROM predictions WHERE id='ELICIT-demo-a'`);
  assert.deepEqual({ ...p }, { verdict: 'hit', observed: 1 });
  const report = get(db, `SELECT report FROM tick_runs WHERE id=?`, r.tickId).report;
  assert.match(report, /prediction ELICIT-demo-a: elicit_default_holds=1 hit/); assert.doesNotMatch(report, /ELICIT-demo-a: unknown metric/);
  await tick(10 * 60e3);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM elicit_audit WHERE finding LIKE 'failed prediction ELICIT-demo-a%'`).n, 0, 'a default that held is no lesson');
  assert.equal(get(db, `SELECT COUNT(DISTINCT run_id) AS n FROM elicit_audit`).n, audits, 'and starts no extra audit');
  assert.deepEqual((await buildConsole(db, {})).progress.predictions, { hit: 1, scored: 1 }, 'Progress counts it as a right prediction');
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM items WHERE id='ELICIT-DEFAULT-METRIC'`).n, 0, 'the reader is wired, so nothing is filed');
});

test('US-16-R19: a tick that has no reader for the default prediction files ELICIT-DEFAULT-METRIC before the prediction falls due, and closes it once the reader is there', async () => {
  const db = makeDb([fileURLToPath(new URL('./migrations/', import.meta.url)), fileURLToPath(new URL('./outcomes/migrations/', import.meta.url))]); const clock = { t: T0 };
  const e = createElicit({ db, now: () => clock.t, config: { defer_below: 0, max_open: 9, daily_cap: 99 } });
  await e.registerNeeds('demo', [NEED]); await e.nextAsks('demo');
  const steps = [elicitDutiesStep({ db, elicit: e, now: () => clock.t })];
  clock.t += 80 * HOUR; await runTick(db, { config: {}, now: clock.t, extraSteps: steps, metrics: {} });
  const it = () => get(db, `SELECT status, owner_role FROM items WHERE id='ELICIT-DEFAULT-METRIC'`);
  assert.ok(it(), 'the gap is filed on the tick that took the default'); assert.notEqual(it().status, 'done');
  assert.equal(get(db, `SELECT verdict FROM predictions WHERE id='ELICIT-demo-a'`).verdict, null, 'filed while the prediction is still unscored');
  clock.t += 10 * 60e3; await runTick(db, { config: {}, now: clock.t, extraSteps: steps, metrics: elicitMetrics });
  assert.equal(it().status, 'done', 'closed on the first tick that reads the metric');
  clock.t += 30 * 24 * HOUR; await runTick(db, { config: {}, now: clock.t, extraSteps: steps, metrics: elicitMetrics });
  assert.equal(get(db, `SELECT verdict FROM predictions WHERE id='ELICIT-demo-a'`).verdict, 'hit');
});

test('US-16-R19: the composed organization passes the default-holds reader to the kernel by itself, so a host that passes no metrics still grades a held default a hit and files no ELICIT-DEFAULT-METRIC', async () => {
  const { db, tick } = await org();
  await tick(80 * HOUR);
  assert.equal(get(db, `SELECT state FROM elicit_needs WHERE id='a'`).state, 'defaulted');
  const r = await tick(30 * 24 * HOUR + HOUR);
  assert.equal(r.completed, r.total, JSON.stringify(r.errors));
  assert.deepEqual({ ...get(db, `SELECT verdict, observed FROM predictions WHERE id='ELICIT-demo-a'`) }, { verdict: 'hit', observed: 1 });
  assert.doesNotMatch(get(db, `SELECT report FROM tick_runs WHERE id=?`, r.tickId).report, /ELICIT-demo-a: unknown metric/);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM items WHERE id='ELICIT-DEFAULT-METRIC'`).n, 0, 'the reader is wired by default, so nothing is filed');
  assert.deepEqual((await buildConsole(db, {})).progress.predictions, { hit: 1, scored: 1 });
});

test('US-16-R19: a metric of the same name the host passes wins over the default reader', async () => {
  const { db, tick } = await org({ metrics: { [DEFAULT_HOLDS_METRIC]: async () => 0 } });
  await tick(80 * HOUR);
  await tick(30 * 24 * HOUR + HOUR);
  assert.equal(get(db, `SELECT observed FROM predictions WHERE id='ELICIT-demo-a'`).observed, 0, 'the host reader was the one read');
});
