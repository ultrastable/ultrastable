// BOOTSTRAP-TO-CRITICALITY-1: the whole worker path on an empty database: all migrations -> scheduled() -> a tick that completes EVERY step,
// a measured k_eff, and a persisted sweeper run, served on /live. Fails if any migration is missing from the harness or any step errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const criticality = JSON.parse(readFileSync(new URL('../../autonomy/criticality.json', import.meta.url), 'utf8'));
// config.js is generated per tenant (not in git); the test stubs the same shape deploy-workers.mjs writes.
import { writeFileSync, existsSync, rmSync } from 'node:fs';
const cfgUrl = new URL('../src/config.js', import.meta.url);
const hadCfg = existsSync(cfgUrl);
if (!hadCfg) writeFileSync(cfgUrl, 'export default ' + JSON.stringify({ org_slug: 'e2e', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, github_repos: ['o/r'], policy: { trust: policy.trust, ladder: policy.ladder, surfaces: policy.surfaces }, criticality }) + ';\n');

test('empty DB -> scheduled tick -> all steps complete, k_eff measured, sweeper persisted, /live serves both', async () => {
  const { default: worker } = await import('../src/index.js');
  const db = makeDb();
  const pending = [];
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Headers(), text: async () => '[]', json: async () => [] });
  const env = { DB: db, GITHUB_TOKEN: 'x', GITHUB_REPOS: 'o/r' };
  await worker.scheduled({ scheduledTime: 3 * 600e3 }, env, { waitUntil: p => pending.push(p) });
  await Promise.all(pending);
  const res = await worker.fetch(new Request('https://org.example/live'), env, { waitUntil() {} });
  const live = await res.json();
  assert.equal(typeof live.k_eff, 'number', 'k_eff must be measured on a fresh database');
  assert.ok(live.sweeper && live.sweeper.status === 'ok', 'sweeper run must be persisted: ' + JSON.stringify(live.sweeper));
  const t = db.raw.prepare('SELECT steps_completed, steps_total, errors FROM tick_runs ORDER BY id DESC LIMIT 1').get();
  assert.equal(t.steps_completed, t.steps_total, 'every tick step must complete: ' + t.errors);
  if (!hadCfg) rmSync(cfgUrl);
});
