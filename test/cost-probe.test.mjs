import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureDay, discoverResources, appendRecord } from '../deploy/cost-probe.mjs';

function gqlFetchFactory(data) {
  return async () => ({ ok: true, status: 200, json: async () => ({ data, errors: null }) });
}

describe('cost probe', () => {
  it('measures d1 rows read and neurons via d1AnalyticsAdaptiveGroups', async () => {
    let call = 0;
    const fetchFn = async (url, init) => {
      call++;
      const body = JSON.parse(init.body);
      const isD1 = body.query.includes('d1AnalyticsAdaptiveGroups');
      const data = isD1
        ? { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 9460000000 }, dimensions: { databaseId: 'qnfo-audit' } }] }] } }
        : { viewer: { accounts: [{ aiInferenceAdaptiveGroups: [{ sum: { neurons: 12345 } }] }] } };
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
    const data = { viewer: { accounts: [{ workers: [{ id: 'known-worker' }, { id: 'stray-worker' }], d1Databases: [{ databaseId: 'db1', name: 'd' }], kvNamespaces: [{ id: 'kv1', title: 'k' }], r2Buckets: [{ name: 'b1' }] }] } };
    const { found, items } = await discoverResources({ fetchFn: gqlFetchFactory(data), token: 't', account: 'a', topologyPath: join(dir, 'topology.json') });
    assert.deepEqual(found.workers, ['known-worker', 'stray-worker']);
    assert.ok(items.some((i) => i.kind === 'workers' && i.id === 'stray-worker'));
    assert.ok(items.some((i) => i.kind === 'd1' && i.id === 'db1'));
    assert.ok(items.some((i) => i.kind === 'kv' && i.id === 'kv1'));
    assert.ok(items.some((i) => i.kind === 'r2' && i.id === 'b1'));
  });

  it('appends jsonl records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-'));
    appendRecord({ date: '2026-11-13', d1: [] }, join(dir, 'cost.jsonl'));
    assert.ok(existsSync(join(dir, 'cost.jsonl')));
    assert.equal(JSON.parse(readFileSync(join(dir, 'cost.jsonl'), 'utf8')).date, '2026-11-13');
  });
});
