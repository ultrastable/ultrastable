// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-24 additions: budget schemas, billing samples and shape probe (R22), organization and repository settings (R30 to R34),
// the dead-man route (R51), the one-way Projects view (R03). Ports are fakes; no network and no real account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { runTick } from '../src/tick.js';
import { normalizeBudget, decide, minutesByRepo, watchdog, handle, census, settingsProbe, settingsApply, shapeProbe, sanitize, recordSample, parseRecorded, projectMirror, DOCUMENTED_FIELDS } from './index.js';

const dirs = ['./migrations/', '../deploy/migrations/'].map(d => fileURLToPath(new URL(d, import.meta.url)));
const T0 = Date.parse('2026-11-15T12:00:00Z');
const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const TICK = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const mk = (github, cfgExtra = {}, at = T0) => { const t = { at }; return { db: makeDb(dirs), t, now: () => t.at, github, config: { ghcost: { enabled: true, org: 'example-org', repos: ['code'], budget: { monthly_minutes_total: 500, default_per_repo: 100, per_repo: { code: 500 }, thresholds: [0.5, 0.8], non_essential_workflows: [], essential_workflows: [] }, ...cfgExtra } } }; };
const row = (repo, quantity, extra = {}) => ({ date: '2026-11-10T00:00:00Z', product: 'actions', sku: 'Actions Linux', quantity, unitType: 'Minutes', pricePerUnit: 0.006, grossAmount: 0, discountAmount: 0, netAmount: 0, organizationName: 'example-org', repositoryName: repo, ...extra });
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const rows = (db, sql, ...a) => db.raw.prepare(sql).all(...a);

// ---- US-24-R21, R24, R52: the two budget schemas and the shipped roster ----

test('US-24-R21 normalizeBudget accepts the platform actions-budget.json keys unchanged', () => {
  const platform = { paused: true, paused_workflows: ['x.yml'], essential: ['checks', 'lane'], monthly_free_minutes: 2000, warn_at_pct: 60, pause_at_pct: 85 };
  const b = normalizeBudget(platform);
  assert.equal(b.monthly_minutes_total, 2000);
  assert.deepEqual(b.thresholds, [0.6, 0.85]);
  assert.deepEqual(b.essential_workflows, ['checks', 'lane']);
  assert.deepEqual(b.non_essential_workflows, ['x.yml']);
  assert.equal(b.paused, true);
  const d = decide(minutesByRepo({ usageItems: [row('any', 1300)] }, '2026-11', b), b);
  assert.deepEqual([d.decision, d.exit_code], ['warn50', 1]); // 65 percent of 2000 is past the 60 percent warning, below 85
  assert.throws(() => normalizeBudget({}), /monthly_minutes_total is required/);
});

test('US-24-R21 paused: true in the budget is the kill switch: every non-essential workflow is disabled and read back', async () => {
  const state = new Map(), host = { state, async workflowState({ repo, workflow }) { return state.get(repo + '/' + workflow) || 'enabled'; }, async setWorkflow({ repo, workflow, enabled }) { state.set(repo + '/' + workflow, enabled ? 'enabled' : 'disabled'); }, async usage() { return { usageItems: [row('code', 5)] }; }, async budgets() { throw new Error('http 403'); } };
  const ctx = mk(host, { budget: { monthly_free_minutes: 500, paused: true, paused_workflows: ['loops.yml'], essential: ['ci.yml:test'] } });
  const d = await watchdog(ctx);
  assert.equal(d.decision, 'ok');
  assert.equal(state.get('code/loops.yml'), 'disabled');
});

test('US-24-R52 the shipped budget file leaves no active workers workflow unrostered', () => {
  const budget = JSON.parse(readFileSync(new URL('../../ops/actions-budget.json', import.meta.url), 'utf8'));
  const files = readdirSync(new URL('../../.github/workflows/', import.meta.url)).filter(f => f.endsWith('.yml'));
  assert.ok(files.length >= 6);
  const roster = [...budget.essential_workflows, ...budget.non_essential_workflows];
  const r = census({ workflows: files.map(file => ({ repo: 'workers', file, state: 'active' })), runs: files.map(workflow => ({ repo: 'workers', workflow, at: '2026-11-14T00:00:00Z', runner: 'hosted' })), roster, now: T0 });
  assert.deepEqual(r.unrostered_active, []);
});

// ---- US-24-R22: sanitized sample, shape probe, replay ----

test('US-24-R22 a sample keeps keys and types and hashes organization and repository names', () => {
  const s = sanitize({ usageItems: [row('secret-repo', 12), row('other', 3)] });
  assert.equal(s.items, 2);
  assert.equal(s.fields.quantity, 'number');
  assert.equal(s.fields.repositoryName, 'string');
  const text = JSON.stringify(s);
  assert.doesNotMatch(text, /secret-repo|example-org|other"/);
  assert.match(s.sample[0].repositoryName, /^h:[0-9a-f]+$/);
  assert.equal(sanitize({ usageItems: [row('secret-repo', 1)] }).sample[0].repositoryName, s.sample[0].repositoryName, 'the same name hashes the same');
  assert.deepEqual(DOCUMENTED_FIELDS.filter(f => !(f in s.sample[0])), []);
});

test('US-24-T11 US-24-R22 a renamed usage field is shape drift, files an item and keeps the last decision', async () => {
  const host = { name: 'github', items: [row('code', 250)], async usage() { return { usageItems: host.items }; }, async workflowState() { return 'enabled'; }, async setWorkflow() {}, async budgets() { throw new Error('http 403'); } };
  const ctx = mk(host);
  const good = await watchdog(ctx);
  assert.equal(good.decision, 'warn50');
  assert.equal(one(ctx.db, `SELECT source, shape FROM ghcost_samples ORDER BY id DESC LIMIT 1`).source, 'live');
  host.items = [{ ...row('code', 0), quantity: undefined, qty: 0 }].map(({ quantity, ...rest }) => rest); // `quantity` renamed to `qty`: every repository would read zero
  const bad = await watchdog(ctx);
  assert.deepEqual([bad.decision, bad.exit_code, bad.previous_decision], ['unmeasured', 1, 'warn50']);
  assert.equal(one(ctx.db, `SELECT status FROM items WHERE id='GHCOST-SHAPE-DRIFT'`).status, 'open');
  assert.equal(one(ctx.db, `SELECT decision FROM ghcost_ledger WHERE repo='(total)'`).decision, 'warn50', 'the ledger keeps its previous decision, never a silent zero');
  host.items = [row('code', 250)];
  assert.equal((await watchdog(ctx)).decision, 'warn50');
  assert.equal(one(ctx.db, `SELECT status FROM items WHERE id='GHCOST-SHAPE-DRIFT'`).status, 'done', 'a clean read closes the item');
});

test('US-24-R22 a unit type that is no longer Minutes is blocking drift; an added field is only reported', () => {
  assert.equal(shapeProbe({ usageItems: [row('code', 5, { unitType: 'Hours' })] }).blocking, true);
  const added = shapeProbe({ usageItems: [row('code', 5, { newField: 1 })] });
  assert.deepEqual([added.result, added.blocking, added.added], ['drift', false, ['newField']]);
  assert.equal(shapeProbe({ usageItems: [] }).result, 'unmeasured');
  assert.equal(shapeProbe(null).result, 'unmeasured');
});

test('US-24-R22 a stored sample replays to the same decision', async () => {
  const report = { usageItems: [row('code', 500), row('spec', 20)] };
  const text = JSON.stringify(report); // what a live read saved
  const host = { name: 'fixture', async usage() { return parseRecorded(text); }, async workflowState() { return 'enabled'; }, async setWorkflow() {}, async budgets() { throw new Error('http 403'); } };
  const a = await watchdog(mk(host)), b = await watchdog(mk(host));
  assert.deepEqual([a.decision, a.exit_code, a.total_used], [b.decision, b.exit_code, b.total_used]);
  assert.equal(a.decision, 'over');
  assert.throws(() => parseRecorded('{"nope":1}'), /no usageItems/);
  assert.throws(() => parseRecorded('not json'), /not JSON/);
  const ctx = mk(host);
  await recordSample(ctx.db, 'usage', report, '2026-11-15 12:00:00', { source: 'fixture' });
  assert.equal(rows(ctx.db, `SELECT * FROM ghcost_samples`).length, 1);
});

// ---- US-24-R30 to R34: settings ----

function settingsHost(over = {}) {
  const h = { calls: [], wf: { default_workflow_permissions: 'write', can_approve_pull_request_reviews: true }, fork: { approval_policy: 'first_time_contributors' }, repos: { code: { allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true, delete_branch_on_merge: false, has_discussions: true } }, refuse: null, ...over };
  Object.assign(h, {
    async orgWorkflowPermissions() { return h.wf; },
    async setOrgWorkflowPermissions(b) { h.calls.push('wf'); if (h.refuse === 'wf') throw Object.assign(new Error('ghcost: PUT -> http 403'), { final: true }); Object.assign(h.wf, b); },
    async forkApproval() { return h.fork; },
    async setForkApproval(p) { h.calls.push('fork'); h.fork.approval_policy = p; },
    async repo(r) { return h.repos[r]; },
    async patchRepo(r, b) { h.calls.push('repo:' + r); Object.assign(h.repos[r], b); },
  });
  return h;
}

test('US-24-R30 the probe fails when the default token is write and passes on read with approvals off', async () => {
  const host = settingsHost(), ctx = mk(host);
  let r = await settingsProbe(ctx);
  assert.ok(r.failing.includes('default_workflow_permissions') && r.failing.includes('can_approve_pull_request_reviews'));
  assert.equal(one(ctx.db, `SELECT status FROM items WHERE id='GHCOST-SETTINGS-default_workflow_permissions'`).status, 'open');
  host.wf = { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false };
  r = await settingsProbe(ctx);
  assert.ok(!r.failing.includes('default_workflow_permissions'));
  assert.equal(one(ctx.db, `SELECT status FROM items WHERE id='GHCOST-SETTINGS-default_workflow_permissions'`).status, 'done');
});

test('US-24-R31 the probe reads the fork approval policy', async () => {
  const host = settingsHost(), ctx = mk(host);
  assert.ok((await settingsProbe(ctx)).failing.includes('fork_approval'));
  host.fork.approval_policy = 'all_external_contributors';
  assert.ok(!(await settingsProbe(ctx)).failing.includes('fork_approval'));
});

test('US-24-R32 the probe fails on a repository that allows merge commits and names the fields', async () => {
  const ctx = mk(settingsHost());
  const r = await settingsProbe(ctx);
  assert.ok(r.failing.includes('merge:code'));
  assert.match(one(ctx.db, `SELECT evidence FROM ghcost_probes WHERE probe='settings:merge:code' ORDER BY id DESC LIMIT 1`).evidence, /allow_merge_commit.*allow_rebase_merge.*delete_branch_on_merge/);
});

test('US-24-R33 discussions are judged only when the configuration states a wish (a MAY)', async () => {
  const host = settingsHost();
  assert.ok(!(await settingsProbe(mk(host))).rows.some(r => r.key.startsWith('discussions:')));
  const withWish = await settingsProbe(mk(host, { settings: { discussions: false } }));
  assert.equal(withWish.rows.find(r => r.key === 'discussions:code').result, 'fail');
});

test('US-24-R34 settingsApply changes nothing without apply and reads every change back with it', async () => {
  const host = settingsHost(), ctx = mk(host);
  const dry = await settingsApply(ctx);
  assert.equal(dry.applied, false);
  assert.deepEqual(host.calls, [], 'no write call was made');
  assert.deepEqual(dry.planned.map(p => p.call).sort(), ['patchRepo', 'setForkApproval', 'setOrgWorkflowPermissions']);
  const done = await settingsApply(ctx, { apply: true });
  assert.deepEqual([done.applied, done.refused, done.unverified], [true, [], []]);
  assert.deepEqual(host.calls.sort(), ['fork', 'repo:code', 'wf']);
  assert.deepEqual((await settingsProbe(ctx)).failing, []);
});

test('US-24-R30 an unreadable settings endpoint is unknown and a refused write is recorded, left as a gate card and not retried', async () => {
  const broken = settingsHost(); broken.orgWorkflowPermissions = async () => { throw new Error('ghcost: GET -> http 500'); };
  const r = await settingsProbe(mk(broken));
  assert.ok(r.unknown.includes('default_workflow_permissions') && !r.failing.includes('default_workflow_permissions'));
  const host = settingsHost({ refuse: 'wf' }), ctx = mk(host);
  const done = await settingsApply(ctx, { apply: true });
  assert.equal(done.refused.length, 1);
  assert.equal(host.calls.filter(c => c === 'wf').length, 1, 'tried once, no second route');
  assert.ok(done.unverified.includes('default_workflow_permissions'));
  const card = one(ctx.db, `SELECT default_in_effect FROM gate_cards WHERE id='GATE-GHCOST-SETTINGS-WRITE'`);
  assert.match(card.default_in_effect, /Settings stay as they are/);
});

test('US-24-R30 the settings probe rides the watchdog step on its interval and adds no tick step', async () => {
  const { ghcostSteps } = await import('./index.js');
  const host = settingsHost({ async usage() { return { usageItems: [row('code', 1)] }; }, async budgets() { throw new Error('http 403'); } });
  assert.deepEqual(ghcostSteps().map(s => s.name), ['ghcost_watchdog']);
  const ctx = mk(host, { settings: { enabled: true, every_ticks: 1 }, every_ticks: 1 });
  const notes = [];
  await ghcostSteps({ github: host })[0].run(ctx.db, { tickId: 1, now: ctx.now, config: ctx.config, notes });
  assert.ok(notes.some(n => /ghcost settings: \d+ failing/.test(n)), notes.join(' | '));
});

// ---- US-24-R51, R44: the dead-man route ----

test('US-24-T12 US-24-R51 the dead-man route refuses an unauthenticated caller', async () => {
  const ctx = mk(settingsHost());
  const res = await handle(new Request('https://x/ghcost/deadman', { method: 'POST' }), { db: ctx.db, now: ctx.now, config: ctx.config });
  assert.equal(res.status, 401);
  const wrong = await handle(new Request('https://x/ghcost/deadman'), { db: ctx.db, now: ctx.now, config: ctx.config, authorize: () => false });
  assert.equal(wrong.status, 401);
  const throwing = await handle(new Request('https://x/ghcost/deadman'), { db: ctx.db, now: ctx.now, config: ctx.config, authorize: () => { throw new Error('x'); } });
  assert.equal(throwing.status, 401);
  assert.equal(one(ctx.db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'DEADMAN-%'`).n, 0, 'a refused call writes nothing');
});

test('US-24-T12 US-24-R51 an authorized call after a three-slot gap opens one item and reports missed_slots 3, and the route closes it once a tick is recorded', async () => {
  const ctx = mk(settingsHost());
  await runTick(ctx.db, { config: TICK, now: T0 });
  ctx.t.at = T0 + 35 * 60000;
  const call = async () => { const r = await handle(new Request('https://x/ghcost/deadman', { method: 'POST' }), { db: ctx.db, now: ctx.now, config: ctx.config, authorize: () => true }); return [r.status, await r.json()]; };
  const [s1, b1] = await call();
  assert.deepEqual([s1, b1.result, b1.missed_slots, b1.item], [503, 'fail', 3, 'DEADMAN-202611151200']);
  await call();
  assert.equal(one(ctx.db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'DEADMAN-%'`).n, 1, 'one item per gap');
  await runTick(ctx.db, { config: TICK, now: T0 + 40 * 60000 });
  ctx.t.at = T0 + 41 * 60000;
  const [s2, b2] = await call();
  assert.deepEqual([s2, b2.result, b2.missed_slots], [200, 'pass', 0]);
  assert.equal(one(ctx.db, `SELECT status FROM items WHERE id='DEADMAN-202611151200'`).status, 'done');
});

test('US-24-R44 the dead-man route needs no tick and no workflow schedule: the module still does not import the tick', () => {
  const src = readFileSync(fileURLToPath(new URL('./index.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(src, /from '\.\.\/src\/tick\.js'|runTick/);
  assert.match(src, /\/ghcost\/deadman/);
});

// ---- US-24-R03: the one-way Projects view ----

function board(initial = []) {
  const items = new Map(initial.map(b => [b.itemId, { ...b }])), calls = [];
  return { calls, items, async projectItems() { return [...items.values()]; }, async upsertProjectItem({ itemId, fields }) { calls.push('upsert:' + itemId); items.set(itemId, { id: 'P-' + itemId, itemId, fields: { ...fields } }); }, async deleteProjectItem({ id }) { calls.push('delete:' + id); for (const [k, v] of items) if (v.id === id) items.delete(k); } };
}
const addItem = (db, id, status = 'open', extra = '') => db.raw.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, project, status${extra ? ', disposition' : ''}) VALUES (?,?,?,?,?,?,?,?${extra ? ',?' : ''})`).run(...[id, 't ' + id, 'work', 'ops', 'done', 'probe ' + id, 'prog', status, ...(extra ? [extra] : [])]);

test('US-24-R03 the board mirrors open ledger items and writes nothing back into the ledger', async () => {
  const b = board(), ctx = mk(b, { projects: { enabled: true, project: 'P1' } });
  addItem(ctx.db, 'A-1'); addItem(ctx.db, 'A-2', 'ready');
  const before = JSON.stringify(rows(ctx.db, `SELECT * FROM items ORDER BY id`));
  const r = await projectMirror(ctx);
  assert.deepEqual([r.result, r.added.sort()], ['pass', ['A-1', 'A-2']]);
  assert.deepEqual(b.items.get('A-2').fields, { Status: 'ready', Program: 'prog', Probe: 'probe A-2' });
  b.items.get('A-1').fields.Status = 'done'; // somebody edits the board
  assert.equal(JSON.stringify(rows(ctx.db, `SELECT * FROM items ORDER BY id`)), before, 'the ledger is untouched by the board');
  assert.equal(one(ctx.db, `SELECT status FROM items WHERE id='A-1'`).status, 'open');
});

test('US-24-R03 a field changed on the board is reported as drift and the ledger value is re-asserted', async () => {
  const b = board(), ctx = mk(b, { projects: { enabled: true, project: 'P1' } });
  addItem(ctx.db, 'A-1');
  await projectMirror(ctx);
  b.items.get('A-1').fields.Status = 'done';
  const r = await projectMirror(ctx);
  assert.deepEqual([r.result, r.drift], ['drift', [{ item: 'A-1', fields: ['Status'] }]]);
  assert.equal(b.items.get('A-1').fields.Status, 'open');
  assert.equal(one(ctx.db, `SELECT result FROM ghcost_probes WHERE probe='projects' ORDER BY id DESC LIMIT 1`).result, 'fail');
  assert.equal((await projectMirror(ctx)).result, 'pass');
});

test('US-24-R03 an item leaves the board only after its ledger item is closed with a disposition; an unreadable board is unmeasured', async () => {
  const b = board([{ id: 'P-X', itemId: 'X-1', fields: {} }, { id: 'P-Y', itemId: 'Y-1', fields: {} }, { id: 'P-Z', itemId: 'Z-1', fields: {} }]), ctx = mk(b, { projects: { enabled: true, project: 'P1' } });
  addItem(ctx.db, 'X-1', 'done', 'fixed by test'); addItem(ctx.db, 'Y-1', 'blocked');
  const r = await projectMirror(ctx);
  assert.deepEqual(r.removed, ['X-1']);
  assert.ok(b.items.has('Y-1') === false || b.items.get('Y-1').fields.Status === 'blocked');
  assert.ok(b.items.has('Z-1'), 'an item the ledger does not know is not ours to delete');
  const broken = { async projectItems() { throw new Error('http 502'); } };
  const u = await projectMirror(mk(broken, { projects: { enabled: true, project: 'P1' } }));
  assert.equal(u.result, 'unknown');
  assert.deepEqual(await projectMirror(mk(b, {})), { skipped: true }, 'opt-in');
});
