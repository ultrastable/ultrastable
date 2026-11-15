// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// DEPLOY-OIDC-1: deploys the platform workers into the ultrastable Cloudflare account with no stored Cloudflare credential. GitHub Actions
// mints an OIDC token for this run (audience ultrastable-deploy); the ultrastable-site worker verifies it (site/deployer.js) and uploads with
// the credential only it holds. Modules are flattened from the repository at GITHUB_SHA by the same code the tick's handoff loop uses.
//   node deploy/deploy-oidc.mjs [worker,worker]   (in GitHub Actions with permissions id-token: write, contents: read)
import { readFileSync, appendFileSync } from "node:fs";
import { makeDeployer } from "../seed/worker/src/handoff.js";
const SITE = process.env.TARGET_SITE || "https://ultrastable-site.ultrastable.workers.dev";
const sha = process.env.GITHUB_SHA, repo = process.env.GITHUB_REPOSITORY || "ultrastable/ultrastable", gh = process.env.GITHUB_TOKEN;
if (!sha || !gh) { console.error("needs GITHUB_SHA and GITHUB_TOKEN (run in GitHub Actions)"); process.exit(1); }
async function oidc() {
  const u = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, t = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!u || !t) throw new Error("no OIDC request URL: the job needs permissions id-token: write");
  const r = await fetch(u + "&audience=ultrastable-deploy", { headers: { authorization: "bearer " + t } });
  const j = await r.json(); if (!j.value) throw new Error("OIDC token request HTTP " + r.status); return j.value;
}
const topo = JSON.parse(readFileSync(new URL("../doctrine/topology.json", import.meta.url), "utf8"));
const ORDER = ["ultrastable-agents", "ultrastable-dashboard", "ultrastable-tick", "ultrastable-site"];  // the site replaces itself last
const wanted = process.argv[2] ? process.argv[2].split(",") : topo.workers.filter(w => w.state === "live" && !w.retire_candidate).map(w => w.id);
const ids = [...ORDER.filter(i => wanted.includes(i)), ...wanted.filter(i => !ORDER.includes(i))];
const site = { fetch: (url, init) => fetch(String(url).replace("https://internal", SITE), init) };
const results = [];
for (const id of ids) {
  const r = await makeDeployer({ token: gh, site, oidc: await oidc() })(id, sha, repo);
  console.log(r.ok ? "OK    " : "FAIL  ", id, r.ok ? (r.version || "uploaded") : r.detail);
  results.push({ worker: id, ...r });
  appendFileSync(new URL("../ops/deploys.jsonl", import.meta.url), JSON.stringify({ at: new Date().toISOString(), worker: id, uploaded: r.ok, route: "oidc", account: topo.account_id, sha }) + "\n");
}
// The live probe: the tick in the target account answers and names its controller state.
const h = await fetch(SITE.replace("ultrastable-site", "ultrastable-tick") + "/health").then(r => r.json()).catch(() => null);
console.log("tick health:", h ? JSON.stringify(h.cutover) : "unreachable");
process.exit(results.every(r => r.ok) ? 0 : 1);
