// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// DEPLOY-VISIBLE-1 (Rowan, 2026-11-25: "If somebody sees the code, then show them where it's running, show them the URL ... what I'm not seeing
// is where these repos are actually deployed."): after a deploy, each repository whose code went live gets a GitHub Deployment (environment
// production) whose status carries the live URL, on the commit that was built. GitHub then shows "Deployments" on the repository page with the
// link. A tenant Worker built from its own repository is recorded on THAT repository at the tenant commit (source_repo, source_sha).
// Routes: this repository is written with the run's own token (permissions deployments: write); another repository goes to the tick Worker's
// code app through the site's OIDC route (op repo-deployment). A refusal is returned and printed with GitHub's answer; it never fails the deploy.
import { readFileSync } from "node:fs";
const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
// Pure: which deployments this run's results amount to. One per repository; the first public route of the first Worker that went live.
export function plan(results, { topology, tenantRepos, coreRepo, coreSha, coreUrl = "https://ultrastable.io/" }) {
  const byId = new Map(topology.workers.map(w => [w.id, w])), front = new Map();
  for (const t of Object.values((tenantRepos && tenantRepos.tenants) || {})) if (t.repo && t.frontend) front.set(t.repo, t.frontend);
  const out = new Map();
  for (const r of results) {
    if (!r.ok) continue;
    const w = byId.get(r.worker) || {}, repo = r.source_repo || (w.source && w.source.repo) || coreRepo;
    const sha = repo === coreRepo ? coreSha : r.source_sha;
    const url = repo === coreRepo ? coreUrl : (w.routes && w.routes[0] ? "https://" + String(w.routes[0]).split("/")[0] + "/" : front.get(repo));
    if (!/^[0-9a-f]{40}$/.test(String(sha || "")) || !url || out.has(repo)) continue;
    out.set(repo, { repo, sha, url, worker: r.worker });
  }
  return [...out.values()];
}
async function direct(d, token, f) {
  const H = { authorization: "Bearer " + token, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "ultrastable-deploy" };
  const c = await f(`https://api.github.com/repos/${d.repo}/deployments`, { method: "POST", headers: H, body: JSON.stringify({ ref: d.sha, environment: "production", auto_merge: false, required_contexts: [], production_environment: true, description: "Deployed by Ultrastable" }) });
  const cj = await c.json().catch(() => ({}));
  if (c.status !== 201) return { ...d, ok: false, route: "run-token", error: `create deployment: HTTP ${c.status} ${cj.message || ""}`.trim() };
  const s = await f(`https://api.github.com/repos/${d.repo}/deployments/${cj.id}/statuses`, { method: "POST", headers: H, body: JSON.stringify({ state: "success", environment: "production", environment_url: d.url, auto_inactive: true, description: "Live" }) });
  return s.status === 201 ? { ...d, ok: true, route: "run-token", deployment: cj.id } : { ...d, ok: false, route: "run-token", error: `deployment status: HTTP ${s.status}` };
}
async function viaApp(d, { site, oidc, f }) {
  let id; try { id = await oidc(); } catch (e) { return { ...d, ok: false, route: "code-app", error: "no OIDC token: " + e.message }; }
  const r = await f(site + "/__internal/launches", { method: "POST", headers: { authorization: "Bearer " + id, "content-type": "application/json", "user-agent": "ultrastable-deploy" }, body: JSON.stringify({ op: "repo-deployment", repo: d.repo, sha: d.sha, url: d.url }) });
  const j = await r.json().catch(() => ({}));
  return j.ok ? { ...d, ok: true, route: "code-app", deployment: j.deployment } : { ...d, ok: false, route: "code-app", error: `HTTP ${r.status} ${j.waiting_on || ""} ${j.error || ""}`.trim() };
}
export async function record(results, { coreRepo, coreSha, token, site, oidc, fetch: f = fetch, topology = read("../doctrine/topology.json"), tenantRepos = read("../doctrine/tenant-repos.json"), log = console.log }) {
  const done = [];
  for (const d of plan(results, { topology, tenantRepos, coreRepo, coreSha })) {
    let r;
    try { r = d.repo === coreRepo && token ? await direct(d, token, f) : await viaApp(d, { site, oidc, f }); }
    catch (e) { r = { ...d, ok: false, error: String(e.message || e) }; }
    log(r.ok ? `deployment ${r.repo}@${r.sha.slice(0, 7)} -> ${r.url} (${r.route})` : `::warning::DEPLOY-VISIBLE-1: no GitHub Deployment recorded on ${r.repo}: ${r.error}`);
    done.push(r);
  }
  return done;
}
