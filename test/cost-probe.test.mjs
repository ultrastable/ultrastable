import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureDay, discoverResources, appendRecord, routedFetch, run, sizeBreaches, dayThresholds } from '../deploy/cost-probe.mjs';

function gqlFetchFactory(data) {
  return async () => ({ ok: true, status: 200, json: async () => ({ data, errors: null }) });
}

describe('cost probe', () => {
  it('keeps the D1 reading and marks neurons unmeasured when the AI dataset schema changes (COST-PROBE-FIELD-1)', async () => {
    const fetchFn = async (url, init) => {
      const isD1 = JSON.parse(init.body).query.includes('d1AnalyticsAdaptiveGroups');
      return { ok: true, status: 200, json: async () => (isD1
        ? { data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 5 }, dimensions: { databaseId: 'x' } }] }] } }, errors: null }
        : { data: null, errors: [{ message: 'unknown field "totalNeurons"' }] }) };
    };
    const out = await measureDay({ fetchFn, token: 't', account: 'a', date: '2026-11-20', databaseIds: [{ id: 'x' }], thresholds: { neurons: 1 } });
    assert.equal(out.d1[0].rowsRead, 5);
    assert.equal(out.neurons, null, 'unmeasured is never 0');
    assert.equal(out.unmeasured[0].kind, 'ai-neurons');
    assert.equal(out.breaches.length, 0);
  });
  it('measures d1 rows read and neurons via d1AnalyticsAdaptiveGroups', async () => {
    let call = 0;
    const fetchFn = async (url, init) => {
      call++;
      const body = JSON.parse(init.body);
      const isD1 = body.query.includes('d1AnalyticsAdaptiveGroups');
      const data = isD1
        ? { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 9460000000 }, dimensions: { databaseId: 'qnfo-audit' } }] }] } }
        : { viewer: { accounts: [{ aiInferenceAdaptiveGroups: [{ sum: { totalNeurons: 12345 } }] }] } };
      assert.equal(url, 'https://api.cloudflare.com/client/v4/graphql');
      return { ok: true, status: 200, json: async () => ({ data, errors: null }) };
    };
    const out = await measureDay({
      fetchFn, token: 't', account: 'a', date: '2026-11-13',
      databaseIds: [{ id: 'qnfo-audit' }],
      thresholds: { d1RowsRead: { 'qnfo-audit': 7000000 } }
    });
    assert.equal(out.d1[0].rowsRead, 9460000000);
    assert.equal(out.neurons, 12345);
    assert.equal(out.breaches[0].kind, 'd1-rows-read');
    assert.ok(call >= 2);
  });

  it('discovers resources and reports drift', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-'));
    writeFileSync(join(dir, 'topology.json'), JSON.stringify({ workers: ['known-worker'], d1: [], kv: [], r2: [] }));
    const rest = { '/workers/scripts': [{ id: 'known-worker' }, { id: 'stray-worker' }], '/d1/database': [{ uuid: 'db1', name: 'd' }], '/storage/kv/namespaces': [{ id: 'kv1', title: 'k' }], '/r2/buckets': { buckets: [{ name: 'b1' }] } };
    const fetchFn = async (url) => { const k = Object.keys(rest).find((p) => new URL(url).pathname.endsWith(p)); return { ok: true, status: 200, json: async () => ({ success: true, result: rest[k] }) }; };
    const { found, items } = await discoverResources({ fetchFn, token: 't', account: 'a', topologyPath: join(dir, 'topology.json') });
    assert.deepEqual(found.workers, ['known-worker', 'stray-worker']);
    assert.ok(items.some((i) => i.kind === 'workers' && i.id === 'stray-worker'));
    assert.ok(items.some((i) => i.kind === 'd1' && i.id === 'db1'));
    assert.ok(items.some((i) => i.kind === 'kv' && i.id === 'kv1'));
    assert.ok(items.some((i) => i.kind === 'r2' && i.id === 'b1'));
  });

  it('a kind the token cannot list is unmeasured and files no drift (COST-PROBE-4)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-'));
    writeFileSync(join(dir, 'topology.json'), JSON.stringify({ workers: [], d1: [], kv: [], r2: [] }));
    const fetchFn = async (url) => (String(url).includes('/workers/scripts') ? { ok: true, status: 200, json: async () => ({ result: [{ id: 'w' }] }) } : { ok: false, status: 403, json: async () => ({}) });
    const { found, items, unmeasured } = await discoverResources({ fetchFn, token: 't', account: 'a', topologyPath: join(dir, 'topology.json') });
    assert.deepEqual(found, { workers: ['w'], d1: null, kv: null, r2: null });
    assert.deepEqual(items.map((i) => i.id), ['w']);
    assert.deepEqual(unmeasured.map((u) => u.kind), ['d1', 'kv', 'r2']);
  });

  it('appends jsonl records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-'));
    appendRecord({ date: '2026-11-13', d1: [] }, join(dir, 'cost.jsonl'));
    assert.ok(existsSync(join(dir, 'cost.jsonl')));
    assert.equal(JSON.parse(readFileSync(join(dir, 'cost.jsonl'), 'utf8')).date, '2026-11-13');
  });
});

describe('D1 measured from discovery (COST-THRESHOLDS-1, D1-GROWTH-1)', () => {
  it('maps the window limits to per-day limits', () => {
    const t = dayThresholds({ window_days: 7, rows_read_max: 14000000, neurons_max: 70000, rows_read_override: { a: 7000 } });
    assert.equal(t.d1RowsReadDefault, 2000000); assert.equal(t.neurons, 10000); assert.equal(t.d1RowsRead.a, 1000);
  });
  it('a database over the warn share of the size limit is a breach', () => {
    const b = sizeBreaches([{ databaseId: 'x', name: 'big', bytes: 400e6 }, { databaseId: 'y', name: 'small', bytes: 1e6 }], { d1_size_max_bytes: 500e6, d1_size_warn_share: 0.6 });
    assert.deepEqual(b.map((x) => x.name), ['big']);
  });
  it('run measures every listed database and records sizes, never an empty account', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-')); const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, 'ops')); mkdirSync(join(dir, 'doctrine'));
    writeFileSync(join(dir, 'ops/cost-thresholds.json'), JSON.stringify({ window_days: 7, rows_read_max: 7, d1_size_max_bytes: 100, d1_size_warn_share: 0.5 }));
    writeFileSync(join(dir, 'doctrine/topology.json'), JSON.stringify({ stores: { d1: [{ id: 'db1' }] } }));
    const fetchFn = async (url, init) => {
      if (String(url).includes('/graphql')) {
        const isD1 = JSON.parse(init.body).query.includes('d1Analytics');
        return { ok: true, status: 200, json: async () => ({ data: { viewer: { accounts: [isD1 ? { d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 3 } }] } : { aiInferenceAdaptiveGroups: [] }] } } }) };
      }
      const result = String(url).includes('/d1/database') ? [{ uuid: 'db1', name: 'n', file_size: 80 }] : [];
      return { ok: true, status: 200, json: async () => ({ result }) };
    };
    const { record } = await run({ fetchFn, token: 't', account: 'a', date: '2026-11-25', cwd: dir });
    assert.equal(record.d1[0].rowsRead, 3);
    assert.equal(record.breaches.find((b) => b.kind === 'd1-rows-read').limit, 1);
    assert.equal(record.d1Size[0].bytes, 80);
    assert.ok(record.breaches.some((b) => b.kind === 'd1-size'));
  });
});

describe('cost route (COST-ROUTE-1)', () => {
  it('sends the GraphQL read to the Worker with the run OIDC token and maps REST paths', async () => {
    const calls = [];
    const f = async (url, init = {}) => { calls.push([String(url), init.method, init.headers]); return String(url).includes('token.example') ? { json: async () => ({ value: 'jwt' }) } : { ok: true }; };
    const r = routedFetch({ site: 'https://site', account: 'A', env: { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.example/?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 't' }, fetchFn: f });
    await r('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', body: '{}' });
    await r('https://api.cloudflare.com/client/v4/accounts/A/d1/database?per_page=1000', {});
    assert.equal(calls.find(c => c[0] === 'https://site/__internal/cf-graphql')[2].authorization, 'Bearer jwt');
    assert.equal(calls.find(c => c[0] === 'https://site/__internal/cf')[2]['x-cf-path'], 'd1/database?per_page=1000');
  });
});
