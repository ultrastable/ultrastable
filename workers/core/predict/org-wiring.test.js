// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-05, US-SPEC-06, US-SPEC-07: the composition root runs predict, trust and governance in one organization, in process,
// over the migrated in-memory SQLite database and with no model port and no network. Only the act of running this on a deployed
// account is left out (the spec status sections keep it PLANNED).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from '../_shared/testdb.js';
import { OUT_DIR } from '../../tools/build_migrations.mjs';
import { createOrg } from '../org/index.js';
import * as P from './index.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const T0 = Date.UTC(2026, 10, 11, 10, 0, 0);
const HOUR = 3600e3;
const rows = (db, sql, ...a) => db.raw.prepare(sql).all(...a);
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
// The whole policy file, standing limits included: a policy with no standing limits fails the validator (US-06-R11) and the trust step is skipped.
const cfg = (over = {}) => ({ org_slug: 'wiring', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy, ...over });
function boot(config = cfg()) {
  const db = makeDb([OUT_DIR]);
  const clock = { t: T0 };
  const org = createOrg({ db, env: {}, config, fetch: async () => { throw new Error('no network in this test'); }, now: () => clock.t });
  return { db, org, clock };
}

test('US-05-R02, US-05-R15, US-06-R20: one organization tick scores a due decision, writes the outcome the trust step reads, and proposes the ladder item', async () => {
  const { db, org, clock } = boot();
  await P.registerMetric(db, { name: 'q', read_sql: 'SELECT 3' });
  for (let i = 0; i < 12; i++) {
    await P.recordDecision(db, { id: `D${i}`, decision: 'draft an outreach note', predicted_outcome: 'q <= 5 within 1 h', revert_path: 'delete the draft', surface: 'outreach', action_class: 'draft' }, { now: T0 - 3 * HOUR });
  }
  clock.t = T0;
  const r = await org.tick();
  assert.deepEqual(r.errors || [], [], 'no step of the composition root failed');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM predict_outcomes`).n, 12, 'every due prediction is scored (US-05-R02)');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM outcomes WHERE surface = 'outreach' AND action_class = 'draft'`).n, 12, 'the scored outcomes land where the trust step reads them');
  assert.ok(one(db, `SELECT COUNT(*) AS n FROM trust_scores`).n > 0, 'the trust step recomputed the ledger');
  const ladder = rows(db, `SELECT id FROM items WHERE id LIKE 'LADDER-%'`);
  assert.ok(ladder.some(x => /outreach/.test(x.id)), 'a 12-outcome pair crossing its threshold opens a ladder item');
  assert.equal(one(db, `SELECT rung FROM trust_ledger WHERE surface = 'outreach' AND action_class = 'draft'`)?.rung ?? 'observed', 'observed', 'the tick never changes a rung (US-06-R05)');
});

test('US-07-R22: the same tick runs the governance step with no model port: the register is seeded and the rates are reported as unmeasured, not filed', async () => {
  const { db, org } = boot();
  const r = await org.tick();
  assert.deepEqual(r.errors || [], []);
  assert.ok(one(db, `SELECT COUNT(*) AS n FROM governance_false_stop_register`).n > 0, 'the governance step seeded its register (US-07-R22 reads it)');
  const g = r.steps.find(x => x.name === 'governance');
  assert.ok(g && g.ok, 'the governance step ran');
  assert.match(g.evidence, /"false_stop_rate":null/, 'a rate measured over fewer than min_scans scans is unmeasured, never 0');
  assert.equal(rows(db, `SELECT id FROM items WHERE id LIKE 'GOV-%'`).length, 0, 'fewer than min_scans scans: nothing is filed');
});

test('US-06-R11: an invalid policy leaves the trust step skipped with its reason while predict and governance still run', async () => {
  const bad = JSON.parse(JSON.stringify(policy));
  bad.surfaces.money.start_rung = 'autonomous';
  const { db, org } = boot(cfg({ policy: bad }));
  await P.registerMetric(db, { name: 'q', read_sql: 'SELECT 3' });
  await P.recordDecision(db, { id: 'D1', decision: 'x', predicted_outcome: 'q <= 5 within 1 h', revert_path: 'undo', surface: 'outreach', action_class: 'draft' }, { now: T0 - 3 * HOUR });
  const r = await org.tick();
  assert.deepEqual(r.errors || [], []);
  const t = r.steps.find(x => x.name === 'trust');
  assert.match(t.evidence, /skipped, config\.policy is invalid: invalid policy: money: start rung autonomous is above its ceiling/);
  assert.equal(r.steps.find(x => x.name === 'governance').ok, 1);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM predict_outcomes`).n, 1, 'predict still scores');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM trust_scores`).n, 0, 'the trust step did not run under an invalid policy');
});
