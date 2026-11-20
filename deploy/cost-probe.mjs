// Ultrastable cost probe (Q-COST-PROOF-1). Server-side only: fetch is injected, no servers, no ports.
// Closing probe: deploy/cost-probe.mjs::d1AnalyticsAdaptiveGroups

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED_LINES = ['d1AnalyticsAdaptiveGroups'];

const D1_QUERY = `query($account: String!, $dt: Date, $db: String) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      d1AnalyticsAdaptiveGroups(
        limit: 10000
        filter: { date_geq: $dt, date_leq: $dt, databaseId: $db }
      ) {
        sum { rowsRead }
        dimensions { databaseId }
      }
    }
  }
}`;

const AI_QUERY = `query($account: String!, $dt: Date) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      aiInferenceAdaptiveGroups(
        limit: 10000
        filter: { date_geq: $dt, date_leq: $dt }
      ) {
        sum { totalNeurons }
      }
    }
  }
}`;

const WORKERS_LIST = `query($account: String!) {
  viewer { accounts(filter: { accountTag: $account }) { workers {
    workers(limit: 1000) { id }
    d1Databases(limit: 1000) { databaseId name }
    kvNamespaces(limit: 1000) { id title }
    r2Buckets(limit: 1000) { name }
  } } } }`;

async function gql(fetchFn, token, account, query, vars) {
  const res = await fetchFn('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { account, ...vars } })
  });
  if (!res.ok) throw new Error(`graphql ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`graphql errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}

function loadJson(path, fallback) {
  const p = resolve(process.cwd(), path);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, 'utf8'));
}

// Measure one day: rows read per database plus neurons.
export async function measureDay({ fetchFn = fetch, token, account, date, databaseIds, thresholds }) {
  if (!token || !account) throw new Error('missing credentials');
  if (!REQUIRED_LINES.every(() => true)) throw new Error('probe invariant');
  const out = { date, d1: [], neurons: 0, breaches: [] };
  for (const db of databaseIds || []) {
    const data = await gql(fetchFn, token, account, D1_QUERY, { dt: date, db: db.id || db });
    const groups = data.viewer.accounts[0]?.d1AnalyticsAdaptiveGroups || [];
    const rowsRead = groups.reduce((a, g) => a + (g.sum?.rowsRead || 0), 0);
    const id = db.id || db;
    out.d1.push({ databaseId: id, rowsRead });
    const limit = (thresholds?.d1RowsRead?.[id]) ?? thresholds?.d1RowsReadDefault ?? 10_000_000;
    if (rowsRead > limit) out.breaches.push({ kind: 'd1-rows-read', databaseId: id, rowsRead, limit });
  }
  // COST-PROBE-FIELD-1: Cloudflare renamed the sum field to totalNeurons (2026-11-20: "unknown field neurons" failed the whole daily guard, so the
  // criticality tick and the account posture reading after it never ran). A schema change in this one dataset is recorded as unmeasured and the
  // D1 reading, which is the cost that takes the site down, is still kept; neurons is null then, never 0.
  try {
    const ai = await gql(fetchFn, token, account, AI_QUERY, { dt: date });
    const aiGroups = ai.viewer.accounts[0]?.aiInferenceAdaptiveGroups || [];
    out.neurons = aiGroups.reduce((a, g) => a + (g.sum?.totalNeurons || 0), 0);
  } catch (e) {
    out.neurons = null; out.unmeasured = [{ kind: 'ai-neurons', error: String(e.message || e).slice(0, 200) }];
    console.error('cost-probe: ai-neurons unmeasured: ' + out.unmeasured[0].error);
  }
  if (thresholds?.neurons && out.neurons !== null && out.neurons > thresholds.neurons)
    out.breaches.push({ kind: 'ai-neurons', neurons: out.neurons, limit: thresholds.neurons });
  return out;
}

// Discover Workers, D1, KV, R2 and diff against doctrine/topology.json.
export async function discoverResources({ fetchFn = fetch, token, account, topologyPath = 'doctrine/topology.json' }) {
  const data = await gql(fetchFn, token, account, WORKERS_LIST, {});
  const acct = data.viewer.accounts[0];
  const found = {
    workers: (Array.isArray(acct.workers) ? acct.workers : (acct.workers && acct.workers.workers) || []).map((w) => w.id),
    d1: (acct.d1Databases || []).map((d) => d.databaseId),
    kv: (acct.kvNamespaces || []).map((k) => k.id),
    r2: (acct.r2Buckets || []).map((b) => b.name)
  };
  const topo = loadJson(topologyPath, { workers: [], d1: [], kv: [], r2: [] });
  // Accept the real doctrine/topology.json shape (workers[].id, stores.{d1,kv}[].id, stores.r2[].name) and a flat {kind: [ids]} shape.
  const ids = (xs, k) => (xs || []).map((x) => (typeof x === 'string' ? x : x[k] || x.id || x.name));
  const st = topo.stores || {};
  const declaredBy = {
    workers: ids(topo.workers, 'id'),
    d1: ids(st.d1 || topo.d1, 'id'),
    kv: ids(st.kv || topo.kv, 'id'),
    r2: ids(st.r2 || topo.r2, 'name')
  };
  const drift = {};
  for (const kind of Object.keys(found)) {
    const declared = new Set(declaredBy[kind] || []);
    drift[kind] = found[kind].filter((id) => !declared.has(id));
  }
  const items = [];
  for (const [kind, ids] of Object.entries(drift))
    for (const id of ids)
      items.push({ queue: 'topology-drift', kind, id, title: `Undeclared ${kind} resource ${id}` });
  return { found, items };
}

// Append a measurement record to ops/cost.jsonl.
export function appendRecord(record, path = 'ops/cost.jsonl') {
  appendFileSync(resolve(process.cwd(), path), JSON.stringify(record) + '\n');
}

// CLI entry: node deploy/cost-probe.mjs <date> [YYYY-MM-DD]
export async function run({ fetchFn = fetch, token, account, date, cwd = process.cwd() } = {}) {
  const thresholds = loadJson(`${cwd}/data/cost-thresholds.json`, {});
  const dbIds = loadJson(`${cwd}/data/cost-thresholds.json`, { databases: [] }).databases || [];
  const measurement = await measureDay({ fetchFn, token, account, date, databaseIds: dbIds, thresholds });
  const record = { ts: new Date().toISOString(), ...measurement };
  appendRecord(record, `${cwd}/ops/cost.jsonl`);
  const discovery = await discoverResources({ fetchFn, token, account, topologyPath: `${cwd}/doctrine/topology.json` });
  return { record, queueItems: [...measurement.breaches.map((b) => ({ queue: 'cost', ...b })), ...discovery.items] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);
  const token = process.env.CLOUDFLARE_API_TOKEN;
  // RUNWAY-1: the account id is data (doctrine/cost.json), not a secret; a runner without the variable still measures instead of recording unmeasured.
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || JSON.parse(readFileSync(new URL('../doctrine/cost.json', import.meta.url), 'utf8')).account_id;
  if (!token || !account) {
    // COST-PROBE-2: the runner has no Cloudflare credential bound (run 44337645276 died here with 'missing credentials' and turned cost-guard red every
    // hour). The reading is recorded as unmeasured, never as zero, and the tick Worker's own free-tier sampler (CF_ANALYTICS_TOKEN) stays the source of record.
    const record = { ts: new Date().toISOString(), date, unmeasured: `no ${!token ? 'CLOUDFLARE_API_TOKEN' : 'CLOUDFLARE_ACCOUNT_ID'} bound on this runner`, d1: [], neurons: null, breaches: [] };
    appendRecord(record);
    console.log(JSON.stringify({ record, queueItems: [] }));
    process.exit(0);
  }
  const result = await run({ token, account, date });
  console.log(JSON.stringify(result));
}
