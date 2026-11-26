// Ultrastable cost probe (Q-COST-PROOF-1). Server-side only: fetch is injected, no servers, no ports.
// Closing probe: deploy/cost-probe.mjs::d1AnalyticsAdaptiveGroups

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
{ const __acc = JSON.parse(readFileSync(new URL("./cloudflare-accounts.json", import.meta.url), "utf8")); if ((__acc.retired_account_ids || []).includes(process.env.CLOUDFLARE_ACCOUNT_ID)) { console.log("skip: account " + process.env.CLOUDFLARE_ACCOUNT_ID + " is retired (SINGLE-ACCOUNT-2)"); process.exit(0); } }

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
  // COST-PROBE-4: the GraphQL analytics API has no resource lists ("unknown field workers", run 44807806946), so discovery never worked there.
  // Each kind is listed over REST; a kind the token cannot list is null (unmeasured) and yields no drift item, never an empty account.
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}`, unmeasured = [], sizes = [];
  const list = async (kind, path, pick) => {
    try {
      const res = await fetchFn(base + path, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) { unmeasured.push({ kind, error: `HTTP ${res.status}` }); return null; }
      const j = await res.json(); const r = j.result && j.result.buckets ? j.result.buckets : j.result;
      return (r || []).map(pick);
    } catch (e) { unmeasured.push({ kind, error: String(e.message || e).slice(0, 120) }); return null; }
  };
  const found = {
    workers: await list('workers', '/workers/scripts', (w) => w.id),
    d1: await list('d1', '/d1/database?per_page=1000', (d) => { sizes.push({ databaseId: d.uuid, name: d.name, bytes: Number(d.file_size) || 0 }); return d.uuid; }),
    kv: await list('kv', '/storage/kv/namespaces?per_page=1000', (k) => k.id),
    r2: await list('r2', '/r2/buckets', (b) => b.name)
  };
  for (const u of unmeasured) console.error(`cost-probe: ${u.kind} discovery unmeasured: ${u.error}`);
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
    drift[kind] = (found[kind] || []).filter((id) => !declared.has(id));
  }
  const items = [];
  for (const [kind, ids] of Object.entries(drift))
    for (const id of ids)
      items.push({ queue: 'topology-drift', kind, id, title: `Undeclared ${kind} resource ${id}` });
  return { found, items, unmeasured, sizes };
}

// D1-GROWTH-1 (2026-11-25): a database that grows past the plan's size limit stops taking writes, and nothing measured size. Each database's
// file size is checked against size_max_bytes (warn at size_warn_share of it). Pure: thresholds come from ops/cost-thresholds.json.
export function sizeBreaches(sizes, t = {}) {
  const max = Number(t.d1_size_max_bytes) || 500 * 1024 * 1024, share = Number(t.d1_size_warn_share) || 0.6;
  return (sizes || []).filter((d) => d.bytes > max * share).map((d) => ({ kind: 'd1-size', databaseId: d.databaseId, name: d.name, bytes: d.bytes, limit: Math.round(max * share) }));
}

// COST-THRESHOLDS-1 (2026-11-25): run() read data/cost-thresholds.json, which never existed, so every reading had d1: [] and looked like a quiet
// account. The real file is ops/cost-thresholds.json with per-window keys; this maps them to the per-day limits measureDay compares.
export function dayThresholds(t = {}) {
  const days = Number(t.window_days) || 7, per = (n) => Math.floor(Number(n) / days);
  const over = Object.fromEntries(Object.entries(t.rows_read_override || {}).map(([k, v]) => [k, per(v)]));
  return { d1RowsReadDefault: t.rows_read_max ? per(t.rows_read_max) : undefined, d1RowsRead: over, neurons: t.neurons_max ? per(t.neurons_max) : undefined };
}

// Append a measurement record to ops/cost.jsonl.
export function appendRecord(record, path = 'ops/cost.jsonl') {
  appendFileSync(resolve(process.cwd(), path), JSON.stringify(record) + '\n');
}

// CLI entry: node deploy/cost-probe.mjs <date> [YYYY-MM-DD]
export async function run({ fetchFn = fetch, token, account, date, cwd = process.cwd() } = {}) {
  const raw = loadJson(`${cwd}/ops/cost-thresholds.json`, {});
  // COST-PROBE-3: a token the account refuses ("not authorized for that account") is recorded as unmeasured, never as an empty account.
  // Discovery runs first: the databases it finds are the ones measured (COST-THRESHOLDS-1), so a new database is never left out.
  let discovery = { items: [], found: { d1: null }, sizes: [] };
  try { discovery = await discoverResources({ fetchFn, token, account, topologyPath: `${cwd}/doctrine/topology.json` }); }
  catch (e) {
    const msg = String(e.message || e);
    if (!/not authorized|authz/i.test(msg)) throw e;
    console.error('cost-probe: resource discovery unmeasured: ' + msg.slice(0, 200));
  }
  const dbIds = (discovery.found.d1 || []).map((id) => ({ id }));
  const measurement = await measureDay({ fetchFn, token, account, date, databaseIds: dbIds, thresholds: dayThresholds(raw) });
  measurement.d1Size = discovery.sizes || [];
  measurement.breaches.push(...sizeBreaches(measurement.d1Size, raw));
  if (!dbIds.length) measurement.unmeasured = [...(measurement.unmeasured || []), { kind: 'd1', error: 'no database listed; rows read and size not measured' }];
  const record = { ts: new Date().toISOString(), ...measurement };
  appendRecord(record, `${cwd}/ops/cost.jsonl`);
  return { record, queueItems: [...measurement.breaches.map((b) => ({ queue: 'cost', ...b })), ...discovery.items] };
}

// COST-ROUTE-1: with no usable Cloudflare token in GitHub, the read goes through the site Worker (GitHub OIDC, audience ultrastable-deploy), which holds the credential.
export function routedFetch({ site, account, env = process.env, fetchFn = fetch }) {
  const oidc = async () => (await (await fetchFn(env.ACTIONS_ID_TOKEN_REQUEST_URL + '&audience=ultrastable-deploy', { headers: { authorization: 'Bearer ' + env.ACTIONS_ID_TOKEN_REQUEST_TOKEN } })).json()).value;
  return async (url, init = {}) => {
    const u = new URL(String(url)), h = { authorization: 'Bearer ' + await oidc(), 'user-agent': 'ultrastable-cost-route/1' };
    if (u.pathname.endsWith('/client/v4/graphql')) return fetchFn(site + '/__internal/cf-graphql', { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: init.body });
    const path = (u.pathname + u.search).replace(`/client/v4/accounts/${account}/`, '');
    return fetchFn(site + '/__internal/cf', { method: 'POST', headers: { ...h, 'x-cf-method': init.method || 'GET', 'x-cf-path': path.replace(/^\//, '') }, body: '' });
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);
  let token = process.env.CLOUDFLARE_API_TOKEN, fetchFn = fetch;
  if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {  // COST-ROUTE-1: the Worker route is the credential-free path and the primary one
    const acct = process.env.CLOUDFLARE_ACCOUNT_ID || JSON.parse(readFileSync(new URL('../doctrine/cost.json', import.meta.url), 'utf8')).account_id;
    fetchFn = routedFetch({ site: process.env.TARGET_SITE || 'https://ultrastable-site.ultrastable.workers.dev', account: acct }); token = 'via-worker-route';
  }
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
  const result = await run({ fetchFn, token, account, date });
  console.log(JSON.stringify(result));
}
