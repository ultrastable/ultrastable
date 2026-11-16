// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// PLAN-LIMITS-1 (2026-11-16): lessons from the QNFO/Quniverse fleet, frozen that day because its Cloudflare bill became unaffordable, held as checks.
//  - Cron proliferation: 37 workers fired every 2 to 30 minutes, so work (and AI spend) scaled with the clock, not with value. Here the whole
//    account's cron triggers fit the plan (the Workers free plan allows 5 per account) and none fires more often than every 10 minutes.
//  - Trigger cascades: one qnfo-audit table carried 67 AFTER INSERT triggers; a single insert read ~860k rows. Ultrastable schemas declare no
//    D1 triggers: derived state is computed by the code that writes it, where its cost is visible and testable.
//  - Budget: the instance manifest states the monthly budget (the owner's one number); the tick governor (seed/worker/src/budget.js) enforces it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const topo = JSON.parse(read('doctrine/topology.json'));
const manifest = JSON.parse(read('instances/ultrastable/instance.json'));
const plan = (manifest.budget && manifest.budget.plan) || 'free';
const FREE_PLAN_CRON_TRIGGERS = 5;
const live = topo.workers.filter((w) => w.state === 'live' && !w.retire_candidate);
const crons = live.flatMap((w) => (w.crons || []).map((c) => ({ worker: w.id, cron: c })));

// Smallest gap in minutes between two firings within an hour, from the minute field (enough for every cron shape used here).
function minGapMinutes(expr) {
  const minute = expr.trim().split(/\s+/)[0];
  if (minute === '*') return 1;
  const step = minute.match(/^\*\/(\d+)$/); if (step) return Number(step[1]);
  const list = minute.split(',').map(Number).sort((a, b) => a - b);
  if (list.some((n) => !Number.isFinite(n))) return 1;
  if (list.length === 1) return 60;
  let gap = 60 - list[list.length - 1] + list[0];
  for (let i = 1; i < list.length; i++) gap = Math.min(gap, list[i] - list[i - 1]);
  return gap;
}

test('the manifest states a monthly budget the governor can enforce', () => {
  assert.ok(manifest.budget && Number.isFinite(Number(manifest.budget.usd_per_month)) && Number(manifest.budget.usd_per_month) >= 0);
  assert.match(read('seed/worker/src/budget.js'), /export async function governedAI/);
});

test('cron triggers fit the plan, and none fires more often than every 10 minutes', () => {
  if (plan === 'free') assert.ok(crons.length <= FREE_PLAN_CRON_TRIGGERS, `${crons.length} cron triggers on a free-plan account (limit ${FREE_PLAN_CRON_TRIGGERS}): ${crons.map((c) => c.worker + ' ' + c.cron).join('; ')}`);
  for (const c of crons) assert.ok(minGapMinutes(c.cron) >= 10, `${c.worker} "${c.cron}" fires more often than every 10 minutes`);
  assert.equal(minGapMinutes('*/10 * * * *'), 10); assert.equal(minGapMinutes('7 * * * *'), 60); assert.equal(minGapMinutes('5,15 * * * *'), 10);
});

test('the dashboard deploy config matches the declared topology', () => {
  const dash = live.find((w) => w.id === 'ultrastable-dashboard');
  const toml = read('dashboard/wrangler.toml').match(/^crons\s*=\s*(\[[^\]]*\])/m);
  assert.ok(toml, 'dashboard/wrangler.toml declares crons');
  assert.deepEqual(JSON.parse(toml[1]).sort(), (dash.crons || []).slice().sort());
});

test('schemas declare no D1 triggers', () => {
  const files = [...readdirSync(new URL('../seed/worker/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).map((f) => 'seed/worker/migrations/' + f),
    'dashboard/schema.sql', 'seed/analytics/schema.sql'];
  for (const f of files) assert.ok(!/CREATE\s+TRIGGER/i.test(read(f)), `${f} creates a D1 trigger`);
});
