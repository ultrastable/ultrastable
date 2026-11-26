// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../../../core/_shared/testdb.js';
import * as wiring from '../../../core/graph/wiring.js';
import * as fleet from '../../../core/fleet/index.js';
import { cloudflareMetadata, cloudflareDeployed, mapBinding } from './metadata.js';

const graphMig = fileURLToPath(new URL('../../../core/graph/migrations/', import.meta.url));
const fleetMig = fileURLToPath(new URL('../../../core/fleet/migrations/', import.meta.url));
const ok = result => new Response(JSON.stringify({ success: true, result }), { status: 200 });
const A = 'acct-1', B = 'https://api.cloudflare.com/client/v4/accounts/acct-1';

// A fake account: three scripts, with every binding type the adapter maps, a secret and a variable whose values must never be read out.
const BINDINGS = {
  api: [{ type: 'service', name: 'STORE', service: 'store' }, { type: 'secret_text', name: 'API_TOKEN', text: 'secret-value-123' }, { type: 'plain_text', name: 'MODE', text: 'prod-variable' },
    { type: 'json', name: 'CFG', json: { a: 1 } }, { type: 'ai', name: 'AI' }, { type: 'send_email', name: 'MAIL' }],
  store: [{ type: 'd1', name: 'DB', id: 'db-uuid', database_name: 'main' }, { type: 'kv_namespace', name: 'KV', namespace_id: 'kv-1' }, { type: 'r2_bucket', name: 'R2', bucket_name: 'files' },
    { type: 'vectorize', name: 'VEC', index_name: 'idx' }, { type: 'queue', name: 'OUT', queue_name: 'jobs' }, { type: 'durable_object_namespace', name: 'DO', class_name: 'Room' }, { type: 'workflow', name: 'WF', workflow_name: 'flow' }],
  reader: [],
};
const CRONS = { api: ['*/10 * * * *'], store: [], reader: ['0 * * * *', '*/10 * * * *'] };
const MODULE = n => `--b\r\ncontent-disposition: form-data\r\n\r\nexport default { name: '${n}' }\r\n--b--`;
function account({ fail = [], queues = true } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, auth: init.headers && init.headers.authorization });
    const path = url.replace(B, '').replace(/^https:\/\/api\.cloudflare\.com\/client\/v4/, '');
    if (fail.some(f => path.startsWith(f))) return new Response('boom secret-value-123', { status: 500 });
    let m;
    if (path.startsWith('/workers/scripts?')) return new Response(JSON.stringify({ result: Object.keys(BINDINGS).map(id => ({ id })), result_info: { total_pages: 1 } }), { status: 200 });
    if ((m = /^\/workers\/scripts\/([^/]+)\/settings$/.exec(path))) return ok({ bindings: BINDINGS[m[1]] });
    if ((m = /^\/workers\/scripts\/([^/]+)\/schedules$/.exec(path))) return ok({ schedules: CRONS[m[1]].map(cron => ({ cron })) });
    if ((m = /^\/workers\/scripts\/([^/]+)\/content\/v2$/.exec(path))) return new Response(MODULE(m[1]), { status: 200 });
    if (path.startsWith('/workers/domains')) return ok(path.includes('service=api') ? [{ hostname: 'api.example.test' }] : []);
    if (path === '/queues') return queues ? ok([{ queue_name: 'jobs', consumers: [{ script: 'reader' }] }]) : new Response('no', { status: 403 });
    if (path === '/zones/z1/workers/routes') return ok([{ pattern: 'api.example.test/v1/*', script: 'api' }, { pattern: 'other/*', script: 'store' }]);
    if (url === 'https://health.example/api') return new Response(JSON.stringify({ status: 'ok', worker: 'api', version: '1.2.0', enabled: true, bindings_ok: true }), { status: 200 });
    if (url === 'https://health.example/store') return new Response('down', { status: 503 });
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}

test('US-12-R09: every binding type is read from the platform API and mapped to the graph\'s types; secret and variable values never leave the reading', async () => {
  const { fetch } = account();
  const meta = cloudflareMetadata({ fetch, accountId: A, token: 'tok', label: 'main-account', zones: ['z1'] });
  assert.deepEqual(await meta.list(), ['api', 'reader', 'store']);
  assert.equal(meta.account, 'main-account');
  const api = await meta.describe('api');
  assert.deepEqual(api.bindings, [{ type: 'service', name: 'STORE', target: 'store' }, { type: 'secret', name: 'API_TOKEN' }, { type: 'variable', name: 'MODE' }, { type: 'variable', name: 'CFG' }, { type: 'ai', name: 'AI', target: null }]);
  assert.deepEqual(api.routes, ['api.example.test', 'api.example.test/v1/*']);   // a custom domain and a zone route; another script's route is not ours
  assert.ok(!JSON.stringify(api).includes('secret-value-123') && !JSON.stringify(api).includes('prod-variable'));
  const store = await meta.describe('store');
  assert.deepEqual(store.bindings.map(b => [b.type, b.target]), [['database', 'main'], ['kv', 'kv-1'], ['bucket', 'files'], ['vector', 'idx'], ['queue', 'jobs'], ['durable_object', 'Room'], ['workflow', 'flow']]);
  assert.deepEqual((await meta.describe('reader')).queue_consumers, ['jobs']);
  assert.deepEqual((await meta.describe('reader')).crons, ['*/10 * * * *', '0 * * * *']);
  assert.equal(mapBinding({ type: 'send_email', name: 'x' }), null);
});

test('US-12-R09 and US-12-R10: the sweep over the adapter fills the wiring graph; a worker whose read fails is listed under errors and excluded from the counts', async () => {
  const { fetch } = account({ fail: ['/workers/scripts/store/settings'] });
  const meta = cloudflareMetadata({ fetch, accountId: A, token: 'tok' });
  const ctx = { db: makeDb([graphMig]), now: () => Date.parse('2026-03-02T12:00:00Z'), config: {}, metadata: meta, registry: { list: async () => [{ name: 'api' }, { name: 'store' }, { name: 'reader' }] } };
  const s = await wiring.sweep(ctx);
  assert.deepEqual([s.worker_count, s.errors.map(e => e.worker)], [2, ['store']]);
  assert.match(s.errors[0].error, /read \/workers\/scripts\/store\/settings failed: status 500/);
  assert.ok(!s.errors[0].error.includes('secret-value-123'));                  // the response body and the token are never put in the error
  const a = await wiring.analyze(ctx);
  assert.deepEqual([a.nodes, a.errors, a.ghosts], [2, ['store'], []]);       // an errored read is unknown, not a ghost
  assert.deepEqual(a.sinks.concat(a.sources, a.islands).sort(), ['api', 'reader']);
  const stored = (await ctx.db.prepare(`SELECT workers FROM graph_wiring_sweeps`).first()).workers;
  assert.ok(!stored.includes('secret-value-123') && !stored.includes('prod-variable'));
  const step = await wiring.step({ ...ctx, roster: { list: async () => [] } });
  assert.equal(step.worker_count, 2);
});

test('US-12-R09: an unreadable queue list leaves queue consumers empty and says so; a missing credential fails plainly', async () => {
  const { fetch } = account({ queues: false });
  const meta = cloudflareMetadata({ fetch, accountId: A, token: 'tok' });
  const d = await meta.describe('reader');
  assert.deepEqual([d.queue_consumers, d.read_errors.length], [[], 1]);
  assert.match(d.read_errors[0], /status 403/);
  assert.throws(() => cloudflareMetadata({ fetch }), /accountId, token.*gateway, oidc/);
  assert.throws(() => cloudflareMetadata({ accountId: A, token: 't' }), /fetch port/);
});

test('US-12-R09: with no token the gateway route reads the inventory under the run\'s identity token', async () => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push([url, init.headers.authorization]);
    if (url === 'https://gate.example/inventory') return new Response(JSON.stringify({ scripts: ['b', 'a'] }), { status: 200 });
    if (url === 'https://gate.example/inventory?script=a') return new Response(JSON.stringify({ version: null, crons: [], routes: [], queue_consumers: [], bindings: [{ type: 'database', name: 'DB', target: 'main' }] }), { status: 200 });
    return new Response('no', { status: 401 });
  };
  const meta = cloudflareMetadata({ fetch, gateway: 'https://gate.example/', oidc: async aud => `oidc-for-${aud}` });
  assert.deepEqual(await meta.list(), ['a', 'b']);
  assert.equal((await meta.describe('a')).bindings[0].target, 'main');
  assert.deepEqual(seen.map(s => s[1]), ['Bearer oidc-for-https://gate.example', 'Bearer oidc-for-https://gate.example']);
  await assert.rejects(() => meta.describe('b'), /status 401/);
});

test('US-11-R02: the deployed port carries version and health from each registered health URL, the module hash and the schedules, and an unreachable health is not healthy', async () => {
  const { fetch } = account();
  const registry = { list: async () => [{ name: 'api', health_url: 'https://health.example/api' }, { name: 'store', health_url: 'https://health.example/store' }, { name: 'reader', health_url: '/health' }] };
  const deployed = cloudflareDeployed({ fetch, accountId: A, token: 'tok', registry });
  const list = await deployed.list();
  const by = Object.fromEntries(list.map(d => [d.name, d]));
  assert.deepEqual([by.api.version, by.api.health.status, by.api.crons], ['1.2.0', 'ok', ['*/10 * * * *']]);
  assert.deepEqual(by.store.health, { status: 'unreachable', error: 'status 503' });
  assert.equal(by.reader.health, null);                                          // a relative health URL names no host: unmeasured
  assert.match(by.api.source_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(by.api.source_hash, by.store.source_hash);
  // the same readings drive reconciliation
  const ctx = { db: makeDb([fleetMig]), now: () => Date.parse('2026-03-02T12:00:00Z'), config: {}, deployed };
  const h = 'a'.repeat(64);
  await fleet.register(ctx, { name: 'api', purpose: 'p', kind: 'worker', status: 'active', crons: ['*/10 * * * *'], dependencies: [], health_url: 'https://health.example/api', autonomy_level: 'L1', owner: 'ops', version: '1.2.0', source_hash: h,
    header: { purpose: 'p', capabilities: ['x'], deploy_method: 'api', canonical_source: 'w/api' }, secret_names: [], flags_source: 'kv' });
  const r = await fleet.reconcile(ctx);
  assert.equal(r.states.api, 'drifted');                                        // version and crons match; the deployed module is not the registered copy
  assert.match((await ctx.db.prepare(`SELECT state_detail FROM fleet_registry WHERE name = 'api'`).first()).state_detail, /differs from the canonical copy/);
  assert.deepEqual(r.unregistered, ['reader', 'store']);
  assert.throws(() => cloudflareDeployed({ fetch, gateway: 'https://g.example', oidc: async () => 't' }), /accountId, token/);
});
