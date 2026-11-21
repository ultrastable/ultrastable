import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick, ensureItem } from '../src/tick.js';
import { selfAuditStep, loopBreak, ingestDeploys, probeMode } from '../src/selfaudit.js';

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const platformModes = () => { try { return read('../../../instances/ultrastable/failure-modes.json').modes; } catch (e) { if (e.code === 'ENOENT') return []; throw e; } };  // SEED-ADMIT-1: a generated system has no platform instance directory; its probe must pass on the seed's own register
const policy = read('../../autonomy/policy.json'), crit = read('../../autonomy/criticality.json'), reg0 = read('../../autonomy/failure-modes.json'), reg = { ...reg0, modes: [...reg0.modes, ...platformModes()] };
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy, criticality: crit, failure_modes: reg };
const ctx = () => ({ nowIso: '2026-11-13 21:00:00', notes: [] });

test('every probe in the register is one SELECT that runs on the real schema', async () => {
  const db = makeDb();
  for (const m of reg.modes) { const r = await probeMode(db, m); assert.notEqual(r.healthy, null, `${m.id}: ${r.error}`); for (const k of ['failure', 'root_cause', 'owner_role', 'trigger', 'remedy']) assert.ok(m[k], `${m.id} lacks ${k}`); }
});

test('a red probe files FM-<id>; green closes it with evidence; a closed item with a red probe is reopened', async () => {
  const db = makeDb();
  const one = { modes: [{ id: 'x', failure: 'f', root_cause: 'r', owner_role: 'operations', remedy: 'm', probe: "SELECT CASE WHEN (SELECT COUNT(*) FROM org WHERE key='ok')>0 THEN 1 ELSE 0 END" }] };
  let r = await selfAuditStep(db, ctx(), one, ensureItem);
  assert.deepEqual(r.red, ['x']);
  const it = db.raw.prepare(`SELECT status, closing_probe FROM items WHERE id='FM-x'`).get();
  assert.equal(it.status, 'ready'); assert.equal(it.closing_probe, 'selfaudit:x');
  db.raw.exec(`UPDATE items SET status='done', disposition='said so' WHERE id='FM-x'`); // closed by a message, probe still red
  r = await selfAuditStep(db, ctx(), one, ensureItem);
  assert.deepEqual(r.reopened, ['FM-x']);
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id='FM-x'`).get().status, 'ready');
  db.raw.exec(`INSERT INTO org (key, value) VALUES ('ok','1')`);
  r = await selfAuditStep(db, ctx(), one, ensureItem);
  assert.deepEqual(r.closed, ['FM-x']);
  const o = db.raw.prepare(`SELECT result, evidence FROM outcomes WHERE item_id='FM-x' AND result='verified'`).get();
  assert.match(o.evidence, /selfaudit:x green/);
  assert.ok(db.raw.prepare(`SELECT COUNT(*) n FROM failure_probe_runs WHERE mode_id='x'`).get().n === 3);
});

test('loop-breaker blocks an item dispatched 3 times with no outcome and files a LOOPBREAK item', async () => {
  const db = makeDb();
  await ensureItem(db, { id: 'KIT-0', owner_role: 'operations', title: 't', done_check: 'd' });
  for (let i = 0; i < 3; i++) db.raw.prepare(`INSERT INTO dispatches (tick_id, role_id, item_id, model) VALUES (?, 'r', 'KIT-0', 'm')`).run(i);
  const blocked = await loopBreak(db, ctx(), 3, ensureItem);
  assert.deepEqual(blocked, ['KIT-0']);
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id='KIT-0'`).get().status, 'blocked');
  assert.ok(db.raw.prepare(`SELECT 1 x FROM items WHERE id='LOOPBREAK-KIT-0'`).get());
});

test('deploy evidence from ops/deploys.jsonl becomes verified deploy outcomes once, and lifts k_eff', async () => {
  const db = makeDb();
  const body = [{ at: '2026-11-13T18:33:33Z', worker: 'ultrastable-tick', uploaded: true, live_matches_commit: true, sha: 'a'.repeat(40) },
    { at: '2026-11-13T18:34:00Z', worker: 'ultrastable-dashboard', uploaded: true, live_matches_commit: false, sha: 'a'.repeat(40) }].map(x => JSON.stringify(x)).join('\n');
  const f = async () => ({ ok: true, status: 200, text: async () => body });
  assert.equal((await ingestDeploys(db, { token: 't', repo: 'o/ultrastable', fetch: f })).ingested, 2);
  assert.equal((await ingestDeploys(db, { token: 't', repo: 'o/ultrastable', fetch: f })).ingested, 0);
  const NOW = Date.parse('2026-11-13T21:00:00Z');
  await runTick(db, { config, now: NOW });
  const c = JSON.parse(db.raw.prepare(`SELECT value FROM org WHERE key='criticality'`).get().value);
  assert.equal(c.raw_deploys, 1); assert.ok(c.fail_rate > 0);
  assert.equal(c.self_deploys, 0, 'a deploy row with no origin is not the system shipping on itself');
});

test('SELF-REFERENCE-1: only a deploy the system originated counts toward k_self', async () => {
  const db = makeDb();
  const row = (worker, origin) => JSON.stringify({ at: '2026-11-13T18:33:33Z', worker, uploaded: true, live_matches_commit: true, sha: 'b'.repeat(40), origin });
  const body = [row('ultrastable-tick', 'executor'), row('ultrastable-site', 'outside'), row('ultrastable-dashboard', 'self-agent')].join('\n');
  assert.equal((await ingestDeploys(db, { token: 't', repo: 'o/ultrastable', fetch: async () => ({ ok: true, status: 200, text: async () => body }) })).ingested, 3);
  await runTick(db, { config, now: Date.parse('2026-11-13T21:00:00Z') });
  const c = JSON.parse(db.raw.prepare(`SELECT value FROM org WHERE key='criticality'`).get().value);
  assert.equal(c.raw_deploys, 3); assert.equal(c.self_deploys, 2); assert.ok(c.k_self <= c.k_eff);
});

test('the tick runs the selfaudit step and files FM items for red probes', async () => {
  const db = makeDb();
  const r = await runTick(db, { config, now: Date.parse('2026-11-13T21:00:00Z') });
  assert.ok(!r.errors.some(e => e.startsWith('selfaudit')), r.errors.join('|'));
  assert.ok(db.raw.prepare(`SELECT COUNT(*) n FROM items WHERE id LIKE 'FM-%'`).get().n >= 1);
});

test('COSTGUARD-1: a red budget probe files the next fix, an over-budget sample stays red, a green sample closes fix and mode', async () => {
  const { sampleCosts } = await import('../src/costsample.js');
  const db = makeDb();
  const m = {"id": "ext-db-d1-budget", "failure": "An external D1 reads more than 15M rows per hour (or the sampler cannot measure it).", "root_cause": "Full-table scans.", "spof": false, "owner_role": "operations", "trigger": "every tick (hourly sample)", "probe": "SELECT CASE WHEN (SELECT rows_read_1h FROM cost_samples WHERE target='ext-db' AND rows_read_1h IS NOT NULL AND at >= datetime('now','-3 hours') ORDER BY id DESC LIMIT 1) < 15000000 THEN 1 ELSE 0 END", "remedy": "index or LIMIT the heaviest scans.", "fixes": [{"id": "ext-db-fix-top-scan", "title": "Find the heaviest queries and add indexes or LIMITs to them."}, {"id": "ext-db-fix-debounce", "title": "Widen the debounce on the readers."}, {"id": "ext-db-fix-sampler", "title": "Bind CF_ANALYTICS_TOKEN to the tick Worker and set database_id, so the sampler can measure."}]};
  const one = { modes: [m] };
  // no token: the sampler records an error sample, the probe is red, the first fix is filed
  await sampleCosts(db, { token: '', budgets: [{ id: 'ext-db', account_id: 'a', database_id: 'd' }] });
  let r = await selfAuditStep(db, ctx(), one, ensureItem);
  assert.deepEqual(r.red, ['ext-db-d1-budget']);
  assert.ok(db.raw.prepare(`SELECT 1 FROM items WHERE id='FIX-ext-db-fix-top-scan'`).get());
  // over budget (20M rows in the last hour) stays red
  const fetch20 = async () => ({ ok: true, status: 200, json: async () => ({ data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 20000000 } }] }] } } }) });
  await sampleCosts(db, { token: 't0k', budgets: [{ id: 'ext-db', account_id: 'a', database_id: 'd' }], fetch: fetch20, now: new Date(Date.now() + 1000) });
  r = await selfAuditStep(db, ctx(), one, ensureItem); assert.equal(r.red.length, 1);
  // under budget closes the mode item and its fix
  const fetch5 = async () => ({ ok: true, status: 200, json: async () => ({ data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 5000000 } }] }] } } }) });
  await sampleCosts(db, { token: 't0k', budgets: [{ id: 'ext-db', account_id: 'a', database_id: 'd' }], fetch: fetch5, now: new Date(Date.now() + 2000) });
  r = await selfAuditStep(db, ctx(), one, ensureItem);
  assert.ok(r.closed.includes('FM-ext-db-d1-budget') && r.closed.includes('FIX-ext-db-fix-top-scan'), JSON.stringify(r));
});

test('github-app-org-access probe follows repo_access', async () => {
  const db = makeDb(); const m = reg.modes.find(x => x.id === 'github-app-org-access');
  assert.equal((await probeMode(db, m)).healthy, 0);
  db.raw.exec(`INSERT INTO org (key,value) VALUES ('repo_access','{"ok":true}')`);
  assert.equal((await probeMode(db, m)).healthy, 1);
});
