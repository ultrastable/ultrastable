// Deploys site/edge.js (the stamping wrapper around site/worker.js) to Cloudflare and attaches the four hostnames. Usage:
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node deploy/deploy-site.mjs
// This is the same sequence used for the first deploy on 2026-11-10 (Workers script upload, then Workers custom domains).
import { readFileSync, readdirSync } from "node:fs";
import { collectModules } from "../seed/worker/src/handoff.js";
const T = process.env.CLOUDFLARE_API_TOKEN, A = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!T || !A) { console.error("set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID"); process.exit(1); }
// ACCOUNT-SPLIT-2: never upload to a retired account (deploy/cloudflare-accounts.json retired_account_ids); deploy-ultrastable.yml owns deploys.
{ const acc = JSON.parse(readFileSync(new URL("./cloudflare-accounts.json", import.meta.url), "utf8")); if ((acc.retired_account_ids || []).includes(A)) { console.log("skip: account " + A + " is retired; deploy-ultrastable.yml deploys the ultrastable account"); process.exit(0); } }
const api = (m, p, b, h = {}) => fetch("https://api.cloudflare.com/client/v4" + p, { method: m, headers: { authorization: "Bearer " + T, ...h }, body: b }).then(r => r.json());
// Static images live in a KV namespace (binding ASSETS) so the worker script stays small enough to upload inline from any session.
const NS_TITLE = "ultrastable-site-assets";
const nsList = await api("GET", `/accounts/${A}/storage/kv/namespaces?per_page=100`);
let ns = nsList.result.find(n => n.title === NS_TITLE);
if (!ns) ns = (await api("POST", `/accounts/${A}/storage/kv/namespaces`, JSON.stringify({ title: NS_TITLE }), { "content-type": "application/json" })).result;
for (const f of readdirSync(new URL("../site/assets/", import.meta.url)))
  console.log("asset", f, (await api("PUT", `/accounts/${A}/storage/kv/namespaces/${ns.id}/values/${f}`, readFileSync(new URL("../site/assets/" + f, import.meta.url)), { "content-type": "application/octet-stream" })).success);
// worker.js imports sibling modules by relative path (../seed/analytics/analytics.js). The upload API has no path resolution,
// so each relative import is uploaded as a flat module and the specifier is rewritten to ./<name>. (Root cause of the silent
// 0.2.0-live / 0.3.1-merged drift: the single-file upload was rejected with code 10021 and the script still exited 0.)
// HANDOFF-1: modules are collected recursively with the same function the server-side deployer uses (seed/worker/src/handoff.js collectModules),
// so a module imported by a module (agentic.js -> sop.js, controlplane.js -> ../seed/worker/src/handoff.js) is uploaded too. Root cause it closes: the
// one-level flattening uploaded worker.js's direct imports only and Cloudflare rejected the script with 10021 "No such module".
const ROOT_DIR = new URL("../", import.meta.url);
const MODS = await collectModules(async (p) => readFileSync(new URL(p, ROOT_DIR), "utf8"), "site/edge.js");
const src = MODS[0].src;
// TOPOLOGY-1: bindings come from doctrine/topology.json (same mapping as foundation/topology.py `bindings`, live targets only), so the declaration and the deploy cannot disagree.
// Plain Node on purpose: the deploy workflow has no Python dependencies installed.
const TOPO = JSON.parse(readFileSync(new URL("../doctrine/topology.json", import.meta.url), "utf8"));
function topologyBindings(id) {
  const w = TOPO.workers.find(x => x.id === id), b = w.bindings || {}, live = (kind, n) => ((TOPO.stores[kind] || []).find(s => s.name === n) || {}).state === "live", st = (kind, n) => (TOPO.stores[kind] || []).find(s => s.name === n), out = [];
  for (const [bn, t] of Object.entries(b.d1 || {})) if (live("d1", t)) out.push({ type: "d1", name: bn, id: st("d1", t).id });
  for (const [bn, t] of Object.entries(b.kv || {})) if (live("kv", t)) out.push({ type: "kv_namespace", name: bn, namespace_id: st("kv", t).id });
  for (const bn of b.ai || []) out.push({ type: "ai", name: bn });
  for (const [bn, t] of Object.entries(b.services || {})) if ((TOPO.workers.find(x => x.id === t) || {}).state === "live") out.push({ type: "service", name: bn, service: t });
  for (const [bn, v] of Object.entries(b.vars || {})) out.push({ type: "plain_text", name: bn, text: v });
  return out;
}
const TOPOLOGY_BINDINGS = topologyBindings("ultrastable-site");
if (!TOPOLOGY_BINDINGS.some(b => b.name === "ASSETS" && b.namespace_id === ns.id)) { console.error("topology ASSETS namespace differs from the account's " + NS_TITLE); process.exit(1); }
const form = new FormData();
form.append("metadata", new Blob([JSON.stringify({ main_module: MODS[0].name, compatibility_date: "2026-11-04", bindings: TOPOLOGY_BINDINGS, keep_bindings: ["secret_text", "secret_key"], observability: { enabled: true, head_sampling_rate: 1 } })], { type: "application/json" }));
for (const m of MODS) form.append(m.name, new Blob([m.src], { type: m.type }), m.name);
const up = await api("PUT", `/accounts/${A}/workers/scripts/ultrastable-site`, form);
console.log("upload", up.success);
// BUILD-3: the hourly tick (model health, change rounds, idea work items).
{ const cr = await api("PUT", `/accounts/${A}/workers/scripts/ultrastable-site/schedules`, JSON.stringify([{ cron: "17 * * * *" }]), { "content-type": "application/json" }); console.log("cron", cr.success); if (!cr.success) { console.error("cron failed:", JSON.stringify(cr.errors)); process.exit(1); } }
if (!up.success) { console.error("upload failed:", JSON.stringify(up.errors)); process.exit(1); }
const zones = { "ultrastable.io": "18a7463a4e79b98d04aa22eb96b0127b", "www.ultrastable.io": "18a7463a4e79b98d04aa22eb96b0127b", "ultrastable.app": "29a8a782765682441aafd3f64a186ea6", "www.ultrastable.app": "29a8a782765682441aafd3f64a186ea6", "www.ultrastable.net": "e23fd6a6078d557c08462aaa80614402", "ultrastable.net": "e23fd6a6078d557c08462aaa80614402" };
let bad = 0;
for (const [hostname, zone_id] of Object.entries(zones)) {
  const ok = (await api("PUT", `/accounts/${A}/workers/domains`, JSON.stringify({ hostname, service: "ultrastable-site", zone_id, environment: "production" }), { "content-type": "application/json" })).success;
  console.log(hostname, ok); if (!ok) bad++;
}
// BUILD-2: <id>.ultrastable.io. A proxied wildcard DNS record plus a wildcard Workers route send every site subdomain to this worker.
// A missing Cloudflare permission is recorded verbatim (::warning:: plus the owner card text) and does not fail the deploy: sites keep working at /s/<id>.
{
  const Z = zones["ultrastable.io"], miss = [];
  const dns = await api("GET", `/zones/${Z}/dns_records?name=${encodeURIComponent("*.ultrastable.io")}`);
  if (!dns.success) miss.push("dns list: " + JSON.stringify(dns.errors));
  else if (!dns.result.length) { const c = await api("POST", `/zones/${Z}/dns_records`, JSON.stringify({ type: "AAAA", name: "*", content: "100::", proxied: true, ttl: 1, comment: "BUILD-2 per-site subdomains (served by worker ultrastable-site)" }), { "content-type": "application/json" }); console.log("wildcard dns", c.success); if (!c.success) miss.push("dns create (needs Zone > DNS > Edit): " + JSON.stringify(c.errors)); } else console.log("wildcard dns present");
  const rt = await api("GET", `/zones/${Z}/workers/routes`);
  if (!rt.success) miss.push("routes list: " + JSON.stringify(rt.errors));
  else if (!rt.result.some(r => r.pattern === "*.ultrastable.io/*")) { const c = await api("POST", `/zones/${Z}/workers/routes`, JSON.stringify({ pattern: "*.ultrastable.io/*", script: "ultrastable-site" }), { "content-type": "application/json" }); console.log("wildcard route", c.success); if (!c.success) miss.push("route create (needs Zone > Workers Routes > Edit): " + JSON.stringify(c.errors)); } else console.log("wildcard route present");
  for (const m of miss) console.log("::warning::BUILD-2 subdomain setup incomplete, owner card: grant the deploy token Zone DNS Edit + Workers Routes Edit on ultrastable.io. Exact error: " + m);
}
// Verify live: the served version must equal the repo version (a green deploy that serves old code is a failed deploy).
const want = /var VERSION = "([^"]+)"/.exec(MODS.map(m => m.src).join("\n"))[1];
let got = "";
for (let i = 0; i < 12 && got !== want; i++) { await new Promise(r => setTimeout(r, 5000)); try { got = (await (await fetch("https://ultrastable.io/health?v=" + Date.now())).json()).version; } catch {} }
console.log("live version", got, "want", want);
if (bad || got !== want) process.exit(1);
