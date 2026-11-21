// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick, STEPS, isSchemaError } from '../src/tick.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };

test('SCHEMA-HEAL-1: a step that throws on a missing table re-runs migrate, retries, and files no TICKFAIL', async () => {
  const db = makeDb();
  const orig = { measure: STEPS.measure, migrate: STEPS.migrate };
  let calls = 0, migrates = 0;
  STEPS.migrate = async () => { migrates++; };
  STEPS.measure = async () => { calls++; if (calls === 1) throw new Error('D1_ERROR: no such table: metrics'); };
  try {
    const r = await runTick(db, { config, now: Date.parse('2026-11-21T00:00:00Z') });
    assert.equal(calls, 2, 'retried once');
    assert.ok(migrates >= 2, 'migrate ran again');
    assert.ok(!r.errors.some(e => e.startsWith('measure')), r.errors.join('|'));
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'TICKFAIL-measure-%'").get().n, 0);
  } finally { Object.assign(STEPS, orig); }
});

test('SCHEMA-HEAL-1: other errors still file TICKFAIL', async () => {
  const db = makeDb();
  const orig = STEPS.measure;
  STEPS.measure = async () => { throw new Error('boom'); };
  try {
    await runTick(db, { config, now: Date.parse('2026-11-21T00:00:00Z') });
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'TICKFAIL-measure-%'").get().n, 1);
  } finally { STEPS.measure = orig; }
  assert.ok(isSchemaError(new Error('table x has no column named y')));
  assert.ok(!isSchemaError(new Error('boom')));
});
