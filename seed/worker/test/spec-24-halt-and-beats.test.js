// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-24 requirements whose implementation is the platform's workflows and the seed's pulse, named by requirement id:
// R65 (every workflow job honours the halt), R66 (a beat before the body, judged against expected slots, a second route watching).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { beat, watch } from '../src/pulse.js';

// The kit's own workflows are always read; the platform's are read too when this kit sits inside the monorepo (SEED-SELFCONTAINED-1).
const KIT_WORKFLOWS = new URL('../../.github/workflows/', import.meta.url);
const PLATFORM_WORKFLOWS = new URL('../../../.github/workflows/', import.meta.url);
const T0 = Date.parse('2026-11-10T00:00:00Z'), MIN = 60e3;

// Jobs of a workflow file and how many of them skip when the repository variable HALT is 1 (the rule plan-limits.test.mjs holds at the root).
function haltCoverage(text) {
  const jobs = text.split(/^jobs:\s*$/m)[1] || '';
  const ids = [...jobs.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)].map(m => m[1]);
  // A job is guarded when its own if: condition carries the halt clause, alone or beside other conditions.
  const guarded = (jobs.match(/^    if: \$\{\{[^\n]*\bvars\.HALT != '1'/gm) || []).length;
  return { jobs: ids.length, guarded };
}

test('US-24-R65: every job of every workflow of the kit, and of the platform when present, skips when the repository variable HALT is 1, and a job without the guard is detected', () => {
  const bad = [];
  let files = 0;
  for (const dir of [KIT_WORKFLOWS, ...(existsSync(PLATFORM_WORKFLOWS) ? [PLATFORM_WORKFLOWS] : [])]) {
    for (const f of readdirSync(dir).filter(x => /\.ya?ml$/.test(x))) {
      files++;
      const c = haltCoverage(readFileSync(new URL(f, dir), 'utf8'));
      // SKIPPED-NOT-GREEN-1: the required status of the platform's checks.yml is the one job that never skips, because GitHub reads a skipped
      // required check as passed (#2661 merged red that way). It honours the halt by failing: nothing is green while halted.
      const text = readFileSync(new URL(f, dir), 'utf8');
      const gate = f === 'checks.yml' && /^  checks:\n    if: \$\{\{ always\(\) \}\}/m.test(text) && /if \[ "\$HALT" = 1 \]; then echo "::error::halted[^\n]*exit 1; fi/.test(text) ? 1 : 0;
      if (c.jobs !== c.guarded + gate) bad.push(`${f}: ${c.guarded} of ${c.jobs} jobs guarded`);
    }
  }
  assert.ok(files > 0, 'the workflows were read');
  assert.deepEqual(bad, []);
  const unguarded = "jobs:\n  a:\n    if: ${{ vars.HALT != '1' }}\n    runs-on: ubuntu-latest\n  b:\n    runs-on: ubuntu-latest\n";
  assert.deepEqual(haltCoverage(unguarded), { jobs: 2, guarded: 1 }, 'the check this test applies fails on a new unguarded job');
  const compound = "jobs:\n  a:\n    if: ${{ !github.event.repository.is_template && vars.HALT != '1' }}\n    runs-on: ubuntu-latest\n  b:\n    if: ${{ github.event_name == 'push' }}\n    runs-on: ubuntu-latest\n";
  assert.deepEqual(haltCoverage(compound), { jobs: 2, guarded: 1 }, 'a halt clause beside other conditions guards its job; a condition without it does not');
});

test('US-24-R66: a loop writes its beat before its body, so a run that never returns is visible, and the second route runs a tick when the newest is older than two intervals', async () => {
  const db = makeDb();
  let seen = null;
  await beat(db, 'lane', async () => { seen = await db.prepare(`SELECT loop, started_at, finished_at FROM loop_beats WHERE loop='lane'`).first(); return { status: 'ok' }; }, { now: () => T0 });
  assert.equal(seen.loop, 'lane');
  assert.equal(seen.finished_at, null, 'inside the body the beat exists and is not finished: a body that never returns leaves exactly this row');
  assert.ok((await db.prepare(`SELECT finished_at FROM loop_beats WHERE loop='lane'`).first()).finished_at, 'closed after the body');
  await db.prepare(`INSERT INTO tick_runs (started_at, steps_total) VALUES (?, 19)`).bind(new Date(T0).toISOString().replace('T', ' ').slice(0, 19)).run();
  let ran = 0;
  const cfg = { tick_every_min: 10 };
  const fresh = await watch(db, async () => { ran++; }, { now: () => T0 + 12 * MIN, config: cfg });
  const late = await watch(db, async () => { ran++; return { tickId: 1, completed: 19, total: 19 }; }, { now: () => T0 + 45 * MIN, config: cfg });
  assert.deepEqual([fresh.stale, late.stale, ran], [false, true, 1], 'a tick 12 minutes old is fresh; 45 minutes old is stale and the watch route ran one');
});
