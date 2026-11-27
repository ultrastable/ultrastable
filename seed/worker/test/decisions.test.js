// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensure as ensureRouter } from '../src/airouter.js';
import { makeDb } from './d1shim.js';
import { recordRoute, recordGovernor, readDecisions, logDecision, safely, stats } from '../src/decisions.js';

const H = 3600e3, t0 = Date.parse('2026-11-18T00:00:00Z');
test('US-05-R19: a route decision logs its prediction and is scored at once', async () => {
  const db = makeDb(); await ensureRouter(db);
  await db.prepare('INSERT INTO airouter_stats (kind,model,calls,passes,usd) VALUES (?1,?2,11,9,0)').bind('k', 'm').run();
  await recordRoute(db, { kind: 'k', model: 'm', ok: true, now: t0 });
  const r = await readDecisions(db, t0 + H);
  assert.equal(r.points['ai-router'].decisions, 1); assert.equal(r.points['ai-router'].hit_rate, 1);
  assert.equal(r.points['ai-router'].mean_abs_error, 0.2);  // learned (9-1)/10 = 0.8 vs measured 1
});
test('the governor logs a level, keeps it, then scores it an hour later', async () => {
  const db = makeDb(), ft = { level: 'ok', resources: { a: { frac: 0.4 }, b: { frac: 0.2 } } };
  assert.equal((await recordGovernor(db, ft, t0)).status, 'logged');
  assert.equal((await recordGovernor(db, ft, t0 + 600e3)).status, 'kept');
  const r2 = await recordGovernor(db, { level: 'degrade', resources: { a: { frac: 0.5 } } }, t0 + 2 * H);
  assert.equal(r2.settled, 1);
  const p = (await readDecisions(db, t0 + 3 * H)).points['free-tier-governor'];
  assert.equal(p.decisions, 2); assert.equal(p.scored, 1); assert.equal(p.hits, 1);
  assert.equal((await recordGovernor(db, { level: 'ok', resources: {} }, t0)).status, 'unmeasured');
});
test('US-05-R19, US-05-T08: an unregistered point is refused and a logging failure is counted, never silent', async () => {
  await assert.rejects(() => logDecision(makeDb(), { point: 'nope', chosen: 'x' }));
  const before = stats.errors;
  assert.equal(await safely(async () => { throw new Error('boom'); }), null);
  assert.equal(stats.errors, before + 1);
  assert.equal((await readDecisions(makeDb())).logging_errors, stats.errors);
});
test('trend says improving when the newer half scores higher', async () => {
  const db = makeDb();
  for (const [i, m] of [0, 0, 1, 1].entries()) await logDecision(db, { point: 'ai-router', chosen: 'm', predicted: 0.5, measured: m, now: t0 + i * H });
  assert.equal((await readDecisions(db, t0 + 5 * H)).points['ai-router'].trend.verdict, 'improving');
});
