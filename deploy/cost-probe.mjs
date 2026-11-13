// Q-COST-PROOF-1: records D1 rows read (GraphQL d1AnalyticsAdaptiveGroups) and Workers AI neurons for the Cloudflare account, appends one
// line per run to ops/cost.jsonl, files a queue item (docs/issues/*.json) when a database or the AI total exceeds a threshold held in
// ops/cost-thresholds.json, and discovers account Workers, D1, KV and R2 and diffs them against doctrine/topology.json
// (the comparison of `python3 -m foundation topology --drift`, extended to resources without the ultrastable- prefix), filing undeclared ones as items.
//   node deploy/cost-probe.mjs            measure, append, file
//   node deploy/cost-probe.mjs --dry      measure and print only; writes nothing
// Needs CLOUDFLARE_API_TOKEN (never printed). The account id comes from doctrine/topology.json.
import { readFileSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const ROOT = new URL("..", import.meta.url);
const readJson = (p) => JSON.parse(readFileSync(new URL(p, ROOT), "utf8"));
const API = "https://api.cloudflare.com/client/v4";

export async function cf(fetchFn, token, path, init = {}) {
  const r = await fetchFn(API + path, { ...init, headers: { authorization: "Bearer " + token, "content-type": "application/json" } });
  const j = await r.json();
  if (!r.ok || j.success === false || j.errors?.length) throw new Error(`cloudflare ${path.split("?")[0]} -> ${r.status} ${JSON.stringify(j.errors || [])}`.split(token).join("***"));
  return j;
}
async function list(fetchFn, token, path, pick) {
  const out = [];
  for (let page = 1; page < 50; page++) {
    const j = await cf(fetchFn, token, `${path}?page=${page}&per_page=100`);
    out.push(...pick(j.result)); if (page >= (j.result_info?.total_pages || 1)) break;
  }
  return out;
}
const gql = async (fetchFn, token, query) => (await cf(fetchFn, token, "/graphql", { method: "POST", body: JSON.stringify({ query }) })).data.viewer.accounts[0];

export async function measure({ fetchFn = fetch, token, account, thresholds, now = new Date() }) {
  const day = (d) => d.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - thresholds.window_days * 864e5);
  const dbs = await list(fetchFn, token, `/accounts/${account}/d1/database`, r => r);
  const g = await gql(fetchFn, token, `{viewer{accounts(filter:{accountTag:"${account}"}){d1AnalyticsAdaptiveGroups(limit:10000,filter:{date_geq:"${day(from)}",date_leq:"${day(now)}"}){sum{rowsRead rowsWritten readQueries writeQueries} dimensions{databaseId}}}}}`);
  const byId = new Map((g.d1AnalyticsAdaptiveGroups || []).map(x => [x.dimensions.databaseId, x.sum]));
  const d1 = dbs.map(d => { const s = byId.get(d.uuid) || {}; return { name: d.name, id: d.uuid, rows_read: s.rowsRead || 0, rows_written: s.rowsWritten || 0, read_queries: s.readQueries || 0, write_queries: s.writeQueries || 0 }; })
    .sort((a, b) => b.rows_read - a.rows_read);
  const a = await gql(fetchFn, token, `{viewer{accounts(filter:{accountTag:"${account}"}){aiInferenceAdaptiveGroups(limit:10000,filter:{datetime_geq:"${from.toISOString()}",datetime_leq:"${now.toISOString()}"}){sum{totalNeurons} dimensions{modelId}}}}}`);
  const models = (a.aiInferenceAdaptiveGroups || []).map(x => ({ model: x.dimensions.modelId, neurons: Math.round(x.sum.totalNeurons) })).sort((x, y) => y.neurons - x.neurons);
  return { d1, ai: { neurons: models.reduce((s, m) => s + m.neurons, 0), top_models: models.slice(0, 5) } };
}

export async function discover({ fetchFn = fetch, token, account }) {
  const names = (rows, f) => rows.map(f).filter(Boolean).sort();
  const A = `/accounts/${account}`;
  return {
    workers: names(await list(fetchFn, token, `${A}/workers/scripts`, r => r), x => x.id),
    d1: names(await list(fetchFn, token, `${A}/d1/database`, r => r), x => x.name),
    kv: names(await list(fetchFn, token, `${A}/storage/kv/namespaces`, r => r), x => x.title),
    r2: names(await list(fetchFn, token, `${A}/r2/buckets`, r => r.buckets || []), x => x.name),
  };
}

export function diff(live, topo, thresholds) {
  const decl = { workers: topo.workers, d1: topo.stores.d1, kv: topo.stores.kv, r2: topo.stores.r2 };
  const nameOf = (x) => x.name || x.id;
  const undeclared = [], foreign = [], missing = [];
  for (const kind of Object.keys(decl)) {
    const have = new Set(decl[kind].map(nameOf));
    for (const n of live[kind]) if (!have.has(n)) (thresholds.file_prefixes.some(p => n.startsWith(p)) ? undeclared : foreign).push({ kind, name: n });
    for (const x of decl[kind]) if (x.state === "live" && !live[kind].includes(nameOf(x))) missing.push({ kind, name: nameOf(x) });
  }
  return { undeclared, foreign, missing };
}

const slug = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
export function itemsFor({ cost, drift, thresholds }) {
  const base = { labels: thresholds.item_labels, milestone: thresholds.item_milestone, workstream: thresholds.item_workstream };
  const mk = (id, title, detail, probe) => ({ id, title: `${id}: ${title}`, body: `**Owner:** executor\n**Trigger:** daily clock, driver order\n**Done check:** ${probe}\n**Status:** open\n\n${detail}\n\nsize: S\n\n**Closing probe:** ${probe}\n`, ...base });
  const out = [];
  for (const d of cost.d1) {
    const max = thresholds.rows_read_override[d.name] ?? thresholds.rows_read_max;
    if (d.rows_read > max) out.push(mk(`Q-COST-ROWS-${slug(d.name)}`, `D1 ${d.name} read ${d.rows_read} rows in ${thresholds.window_days} days (limit ${max})`, `Measured by deploy/cost-probe.mjs via d1AnalyticsAdaptiveGroups at ${cost.at}: ${d.read_queries} read queries, ${d.rows_written} rows written. Find the queries and missing indexes behind the reads and fix them; the next probe run shows the database back under the limit.`, `grep:ops/cost.jsonl::${d.name}`));
  }
  if (cost.ai.neurons > thresholds.neurons_max) out.push(mk("Q-COST-NEURONS", `Workers AI used ${cost.ai.neurons} neurons in ${thresholds.window_days} days (limit ${thresholds.neurons_max})`, `Top models: ${JSON.stringify(cost.ai.top_models)}. Route the largest consumer to a cheaper model or cache it.`, "grep:ops/cost.jsonl::neurons"));
  const rows = thresholds.file_foreign ? [...drift.undeclared, ...drift.foreign] : drift.undeclared;
  for (const u of rows) out.push(mk(`Q-TOPO-${u.kind.toUpperCase()}-${slug(u.name)}`, `undeclared ${u.kind} ${u.name} exists in the account`, `deploy/cost-probe.mjs found ${u.kind} ${u.name} in the account and not in doctrine/topology.json. Declare it (state live) or retire it, then run python3 -m foundation topology --drift.`, `grep:doctrine/topology.json::${u.name}`));
  return out;
}

export async function run({ fetchFn = fetch, token, dry = false, now = new Date(), out = ROOT, topo = readJson("doctrine/topology.json"), thresholds = readJson("ops/cost-thresholds.json") }) {
  const account = topo.account_id;
  const cost = { at: now.toISOString(), window_days: thresholds.window_days, ...(await measure({ fetchFn, token, account, thresholds, now })) };
  const live = await discover({ fetchFn, token, account });
  const drift = diff(live, topo, thresholds);
  cost.counts = Object.fromEntries(Object.entries(live).map(([k, v]) => [k, v.length]));
  cost.drift = { undeclared: drift.undeclared, missing: drift.missing, foreign: drift.foreign.length };
  const items = itemsFor({ cost, drift, thresholds });
  const filed = [];
  if (!dry) {
    appendFileSync(new URL("ops/cost.jsonl", out), JSON.stringify(cost) + "\n");
    for (const it of items) { const f = new URL(`docs/issues/${it.id}.json`, out); if (!existsSync(f)) { writeFileSync(f, JSON.stringify(it, null, 2) + "\n"); filed.push(it.id); } }
  }
  return { cost, items: items.map(i => i.id), filed };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) { console.error("set CLOUDFLARE_API_TOKEN"); process.exit(1); }
  const res = await run({ token, dry: process.argv.includes("--dry") });
  console.log(JSON.stringify({ ...res.cost, d1: res.cost.d1.slice(0, 8), items: res.items, filed: res.filed }, null, 1));
}
