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

test('every table the tick worker creates has a retention rule (RETENTION-1)', () => {
  const rules = JSON.parse(read('seed/autonomy/retention.json')).tables;
  const dir = new URL('../seed/worker/', import.meta.url);
  const sources = [...readdirSync(new URL('migrations/', dir)).filter((f) => f.endsWith('.sql')).map((f) => 'seed/worker/migrations/' + f),
    ...readdirSync(new URL('src/', dir)).filter((f) => f.endsWith('.js')).map((f) => 'seed/worker/src/' + f)];
  const created = new Set();
  for (const f of sources) for (const m of read(f).matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/gi)) created.add(m[1]);
  const missing = [...created].filter((t) => !rules[t]);
  assert.deepEqual(missing, [], 'tables with no retention rule in seed/autonomy/retention.json');
});

test('HALT-1: every workflow job honours the repository variable HALT, and every worker cron honours the worker variable', () => {
  const dir = new URL('../.github/workflows/', import.meta.url);
  const bad = [];
  for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
    const text = read('.github/workflows/' + f);
    const jobs = text.split(/^jobs:\s*$/m)[1] || '';
    const ids = [...jobs.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)].map((m) => m[1]);
    const guarded = (jobs.match(/^    if: \$\{\{ vars\.HALT != '1'/gm) || []).length;
    // SKIPPED-NOT-GREEN-1: the required status of checks.yml is the one job that is never skipped; it fails when halted instead
    const gate = f === 'checks.yml' && /^  checks:\n    if: \$\{\{ always\(\) \}\}/m.test(jobs) && /if \[ "\$HALT" = 1 \]; then echo "::error::halted[^\n]*exit 1; fi/.test(jobs) ? 1 : 0;
    if (ids.length !== guarded + gate) bad.push(`${f}: ${guarded} of ${ids.length} jobs guarded`);
  }
  assert.deepEqual(bad, []);
  assert.match(read('seed/worker/src/index.js'), /async scheduled\(_event, env, ctx\) \{\n    if \(halted\(config, env\)\)/);
  assert.match(read('dashboard/worker.js'), /async scheduled\(ev, env, ctx\) \{ if \(halted\(null, env\)\) return;/);
  assert.match(read('site/worker.js'), /async scheduled\(event, env, ctx\) \{ if \(env && env\.UPSTREAM_ORIGIN\) return; if \(halted\(null, env\)\) return;/);
  assert.equal(typeof JSON.parse(read('ops/halt.json')).halted, 'boolean');
});

// SILENT-CATCH (Q-LESSON-SILENT-CATCH, LESSONS-1): 35 fleet failure modes were silent drops, empty catches and 'ok' answers that hid failures.
// A catch block in seed/worker/src whose body is empty or only console.* calls fails, unless the block carries `allow-silent: <reason>`.
// Shrink-only baseline: the count of such blocks per file when the rule landed. A new one fails; removing one fails until the baseline is lowered.
const SILENT_CATCH_BASELINE = { 'pulse.js': 2, 'tick.js': 1 };
function silentCatches(src) {
  const lines = [];
  for (const m of src.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/g)) {
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
    const body = src.slice(m.index + m[0].length, i - 1);
    if (/allow-silent:\s*\S/.test(body)) continue;
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim();
    const stmts = code.split(/;\s*|\n/).map((s) => s.trim()).filter(Boolean);
    if (stmts.every((s) => /^console\.\w+\(/.test(s))) lines.push(src.slice(0, m.index).split('\n').length);
  }
  return lines;
}

test('SILENT-CATCH: no new catch block in seed/worker/src drops its error (empty or console-only) without an allow-silent reason', () => {
  assert.deepEqual(silentCatches('try { a(); } catch (e) {}'), [1]);
  assert.deepEqual(silentCatches('try { a(); } catch {\n  console.error(e); // gone\n}'), [1]);
  assert.deepEqual(silentCatches('try { a(); } catch (e) { /* allow-silent: best-effort cache warm */ }'), []);
  assert.deepEqual(silentCatches('try { a(); } catch (e) { notes.push(e.message); }'), []);
  const found = {};
  for (const f of readdirSync(new URL('../seed/worker/src/', import.meta.url)).filter((x) => x.endsWith('.js'))) {
    const n = silentCatches(read('seed/worker/src/' + f)).length;
    if (n) found[f] = n;
  }
  const over = Object.entries(found).filter(([f, n]) => n > (SILENT_CATCH_BASELINE[f] || 0)).map(([f, n]) => `${f}: ${n} (baseline ${SILENT_CATCH_BASELINE[f] || 0})`);
  assert.deepEqual(over, [], 'new silent catch blocks: record the error where a caller or loop reads it, or add `allow-silent: <reason>`');
  const stale = Object.entries(SILENT_CATCH_BASELINE).filter(([f, n]) => (found[f] || 0) < n).map(([f, n]) => `${f}: ${found[f] || 0} (baseline ${n})`);
  assert.deepEqual(stale, [], 'silent catches were removed: lower SILENT_CATCH_BASELINE to match (shrink-only)');
});
