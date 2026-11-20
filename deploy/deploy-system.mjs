// SYSTEM-1: deploys the code-agent worker (and any worker in doctrine/system.json listed in DEPLOY_WORKERS) from the system data, then probes it live.
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node deploy/deploy-system.mjs
// Modules are uploaded flat with relative imports rewritten (same method as deploy-site.mjs). Appends one row to ops/deploys.jsonl (the deploy counter).
import { readFileSync, appendFileSync } from "node:fs";
const T = process.env.CLOUDFLARE_API_TOKEN, A = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!T || !A) { console.error("set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID"); process.exit(1); }
// ACCOUNT-SPLIT-3: the repository secrets still name the retired account; skip instead of failing against it (deploy-ultrastable.yml deploys the ultrastable account).
{ const acc = JSON.parse(readFileSync(new URL("./cloudflare-accounts.json", import.meta.url), "utf8")); if ((acc.retired_account_ids || []).includes(A)) { console.log("skip: account " + A + " is retired; deploy-ultrastable.yml deploys the ultrastable account"); process.exit(0); } }
const api = (m, p, b, h = {}) => fetch("https://api.cloudflare.com/client/v4" + p, { method: m, headers: { authorization: "Bearer " + T, ...h }, body: b }).then(r => r.json());
const sys = JSON.parse(readFileSync(new URL("../doctrine/system.json", import.meta.url), "utf8"));
const names = (process.env.DEPLOY_WORKERS || "ultrastable-agents").split(",");
for (const name of names) {
  const w = sys.workers[name]; if (!w) { console.error("unknown worker", name); process.exit(1); }
  let src = readFileSync(new URL("../" + w.main, import.meta.url), "utf8"); const extra = [];
  src = src.replace(/(from\s+")(\.{1,2}\/[^"]+)(")/g, (_, a, spec, c) => { const f = new URL("../" + w.main.replace(/[^/]+$/, "") + spec, import.meta.url); extra.push([spec.split("/").pop(), readFileSync(f)]); return a + "./" + spec.split("/").pop() + c; });
  const b = w.bindings, bindings = [];
  for (const n of b.ai || []) bindings.push({ type: "ai", name: n });
  for (const [n, k] of Object.entries(b.d1 || {})) bindings.push({ type: "d1", name: n, id: sys.resources.d1[k].id });
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify({ main_module: "worker.js", compatibility_date: sys.compatibility_date, bindings, observability: { enabled: true, head_sampling_rate: 1 } })], { type: "application/json" }));
  form.append("worker.js", new Blob([src], { type: "application/javascript+module" }), "worker.js");
  for (const [n, body] of extra) form.append(n, new Blob([body], { type: "application/javascript+module" }), n);
  const up = await api("PUT", `/accounts/${A}/workers/scripts/${name}`, form);
  console.log("upload", name, up.success);
  if (!up.success) { console.error(JSON.stringify(up.errors)); process.exit(1); }
  await api("POST", `/accounts/${A}/workers/scripts/${name}/subdomain`, JSON.stringify({ enabled: true, previews_enabled: false }), { "content-type": "application/json" });
  const sub = (await api("GET", `/accounts/${A}/workers/subdomain`)).result?.subdomain;
  const url = `https://${name}.${sub}.workers.dev/agents/probe`;
  let probe = null;
  for (let i = 0; i < 6 && !probe; i++) { await new Promise(r => setTimeout(r, 5000)); try { const r = await fetch(url); probe = { status: r.status, body: await r.json() }; } catch (e) { /* subdomain propagating */ } }
  console.log("probe", url, JSON.stringify(probe));
  appendFileSync(new URL("../ops/deploys.jsonl", import.meta.url), JSON.stringify({ at: new Date().toISOString(), worker: name, uploaded: true, probe_ok: !!(probe && probe.body && probe.body.ok), sha: process.env.GITHUB_SHA || "" }) + "\n");
  if (!probe || !probe.body.ok) { console.error("probe failed: no adapter answered"); process.exit(1); }
}
