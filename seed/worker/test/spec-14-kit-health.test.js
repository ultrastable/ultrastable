// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-14 (portability seams): US-14-R05, the health port of the kit's own Cloudflare reference (src/index.js `/health`), proved through the
// Worker's router. The route runs from a private copy of the seed with a stub config, so nothing is written into the checkout; the database is in memory.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeDb } from './d1shim.js';
import { runTick, STEP_ORDER } from '../src/tick.js';

const SEED = fileURLToPath(new URL('../../', import.meta.url));
const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 'spec14', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const MIN = 60e3;
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

let APP = null;
async function app() {
  if (APP) return APP;
  const dir = mkdtempSync(path.join(tmpdir(), 'spec14-'));
  cpSync(SEED, path.join(dir, 'seed'), { recursive: true, filter: s => !/(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(path.relative(SEED, s)) });
  writeFileSync(path.join(dir, 'seed/worker/src/config.js'), 'export default ' + JSON.stringify({ org_slug: 'spec14', budget: { usd_per_month: 0 } }) + ';\n');
  const mod = await import(pathToFileURL(path.join(dir, 'seed/worker/src/index.js')).href);
  APP = { dir, worker: mod.default };
  return APP;
}
after(() => { if (APP) rmSync(APP.dir, { recursive: true, force: true }); });
const health = async db => {
  const r = await (await app()).worker.fetch(new Request('https://spec14.example/health'), { DB: db }, { waitUntil() {} });
  return { status: r.status, body: await r.json() };
};

test('US-14-R05: the kit\'s /health answers 503 until a tick has completed every step, then 200 with that tick as the latest', async () => {
  const db = makeDb();
  const before = await health(db);
  assert.equal(before.status, 503, 'no tick yet');
  assert.equal(before.body.ok, false);
  assert.equal(before.body.last_tick, null);
  const r = await runTick(db, { config, now: Date.now() - 20 * MIN });
  assert.equal(r.completed, STEP_ORDER.length, 'the tick completed every step');
  const after = await health(db);
  assert.equal(after.status, 200);
  assert.equal(after.body.ok, true);
  assert.equal(after.body.last_tick.steps_completed, after.body.last_tick.steps_total, 'the latest tick is reported');
});

test('US-14-R05: a tick that did not complete every step is reported and /health answers 503; a tick still in flight does not count yet', async () => {
  const db = makeDb();
  await runTick(db, { config, now: Date.now() - 20 * MIN });
  db.raw.prepare('INSERT INTO tick_runs (started_at, steps_total) VALUES (?, ?)').run(iso(Date.now() - MIN), STEP_ORDER.length);
  assert.equal((await health(db)).status, 200, 'a tick started a minute ago is in flight: the finished one is the latest');
  db.raw.prepare('INSERT INTO tick_runs (started_at, steps_total) VALUES (?, ?)').run(iso(Date.now() - 6 * MIN), STEP_ORDER.length);
  const stuck = await health(db);
  assert.equal(stuck.status, 503, 'a tick unfinished after five minutes fails health');
  assert.equal(stuck.body.ok, false);
  assert.notEqual(stuck.body.last_tick.steps_completed, stuck.body.last_tick.steps_total);
});
