// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// DEPLOY-OIDC-1: deploys the platform workers into the ultrastable Cloudflare account with no stored Cloudflare credential. GitHub Actions
// mints an OIDC token for this run (audience ultrastable-deploy); the ultrastable-site worker verifies it (site/deployer.js) and uploads with
// the credential only it holds. Modules are flattened from the repository at GITHUB_SHA by the same code the tick's handoff loop uses.
//   node deploy/deploy-oidc.mjs [worker,worker]   (in GitHub Actions with permissions id-token: write, contents: read)
import { readFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  let r;
  for (let a = 1; a <= 3; a++) {  // DEPLOY-RETRY-1: a transient network error ("fetch failed", 5xx) on one worker failed run 44153697286; retry with backoff
    r = await makeDeployer({ token: gh, site, oidc: await oidc() })(id, sha, repo);
    if (r.ok || !/fetch failed|ECONNRESET|ETIMEDOUT|HTTP 5\d\d|timeout/i.test(String(r.detail))) break;
    console.log("RETRY ", id, a, r.detail); await new Promise(z => setTimeout(z, 5000 * a));
  }
  console.log(r.ok ? "OK    " : "FAIL  ", id, r.ok ? (r.version || "uploaded") + (r.detail && r.detail !== "uploaded" ? " (" + r.detail + ")" : "") : r.detail);
  results.push({ worker: id, ...r });
}
// DEPLOY-RECORD-1: live_matches_commit is true only when Cloudflare returned the deployment id of this upload (built from this commit) and the deployed tick then answered /health; the workflow commits the rows.
// The live probe: the tick in the target account answers and names its controller state.
const h = await fetch(SITE.replace("ultrastable-site", "ultrastable-tick") + "/health").then(r => r.json()).catch(() => null);
console.log("tick health:", h ? JSON.stringify(h.cutover) : "unreachable");
// DEPLOY-ORIGIN-2: who originated what this deploy put live, judged over every substantive commit it carried since the previous deployed commit
// (a deploy usually starts on a bookkeeping commit, so the commit message alone called executor work outside or unknown). `main_sha` is the checkout.
let carried = { origin: "unknown" };
try { carried = JSON.parse(execFileSync("python3", ["-m", "foundation", "criticality", "--deploy-origin", sha, "--json"], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" })); }
catch (e) { console.error("origin lookup failed, recorded as unknown:", e.message); }
console.log("origin:", carried.origin, "carried", (carried.carried || []).length, "commit(s)");
for (const x of results) appendFileSync(new URL("../ops/deploys.jsonl", import.meta.url), JSON.stringify({ at: new Date().toISOString(), worker: x.worker, uploaded: x.ok, live_matches_commit: !!(x.ok && x.version && h), version: x.version || "", route: "oidc", account: topo.account_id, sha, main_sha: carried.sha || "", origin: carried.origin, carried: (carried.carried || []).map(c => c.sha + ":" + c.origin).slice(0, 20), ...(x.source_sha ? { source_repo: x.source_repo, source_sha: x.source_sha } : {}) }) + "\n");
// DEPLOY-VISIBLE-1: each repository whose code went live shows where it runs (a GitHub Deployment with the live URL). A refusal is printed, never fatal here;
// `python3 -m foundation repostd --live` reads the homepage back, and the gate repo-deployments-grant in doctrine/open-loops.json holds what the App lacks.
try { const { record } = await import("./record-deployments.mjs"); await record(results, { coreRepo: repo, coreSha: sha, token: gh, site: SITE, oidc }); }
catch (e) { console.error("::warning::DEPLOY-VISIBLE-1: recording deployments failed:", e.message); }
// SEED-DEPLOY-1: admitted seeds (doctrine/seed-deploys.json) deploy through the same OIDC route after the platform workers. A seed failure is a row in ops/deploys.jsonl
// that the `seed-live` detector files; it never fails the platform deploy or blocks its record step.
try { execFileSync("node", ["deploy/deploy-seed.mjs"], { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "inherit" }); } catch (e) { console.error("seed deploy did not finish live:", e.message); }
process.exit(results.every(r => r.ok) ? 0 : 1);
