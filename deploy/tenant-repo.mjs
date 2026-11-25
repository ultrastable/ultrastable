// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// TENANT-REPO-2: the fourth route to a tenant's repository, and the one that needs no stored credential. The workflow presents its GitHub OIDC
// token to the site worker; the tick Worker creates the repository with the App credentials it already holds (seed/worker/src/apprepos.js).
//   node deploy/tenant-repo.mjs <org/name> [--private] [--description TEXT] --push     stdout: a one-hour token for that repository, only while it is empty
//   node deploy/tenant-repo.mjs --seeds                                                 every seed in doctrine/full-stack.json with a repo gets it from the seed template
// What GitHub answered goes to stderr. Exit 1 when the repository could not be made or reached. Run by .github/workflows/tenant-repos.yml.
import { readFileSync } from "node:fs";
const SITE = process.env.TARGET_SITE || "https://ultrastable-site.ultrastable.workers.dev", UA = "ultrastable-tenant-repos/1";
const J = (rel) => JSON.parse(readFileSync(new URL("../" + rel, import.meta.url), "utf8"));
export function seedRepos(policy = J("doctrine/full-stack.json"), seeds = J("doctrine/seed-deploys.json").seeds || [], template = J("doctrine/tenant-repos.json").visitor_apps.template) {
  return seeds.filter((s) => (policy.systems[s] || {}).repo).map((s) => ({ repo: policy.systems[s].repo, template, public: true, description: `${s}: a system running on Ultrastable, generated from the seed.` }));
}
async function oidc() {
  const u = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, t = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!u || !t) throw new Error("no OIDC request URL: the job needs permissions id-token: write");
  const j = await (await fetch(u + "&audience=ultrastable-deploy", { headers: { authorization: "bearer " + t } })).json();
  if (!j.value) throw new Error("no OIDC token"); return j.value;
}
export async function ask(spec, { fetcher = fetch, token = oidc } = {}) {
  const r = await fetcher(SITE + "/__internal/launches", { method: "POST", headers: { authorization: "Bearer " + await token(), "content-type": "application/json", "user-agent": UA }, body: JSON.stringify({ op: "tenant-repo", ...spec }) });
  const j = await r.json().catch(() => null);
  return j && j.ok !== undefined ? j : { ok: false, error: "HTTP " + r.status };
}
const say = (spec, r) => console.error(`${spec.repo}: ${r.ok ? (r.created ? "created" : "already there") + (r.empty ? ", empty" : "") : "not made: " + (r.waiting_on ? "waiting on " + r.waiting_on + " | " : "") + r.error}${(r.steps || []).length ? " [" + r.steps.join("; ") + "]" : ""}`);
if (import.meta.url === "file://" + process.argv[1]) {
  const a = process.argv.slice(2), opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : "");
  let bad = 0;
  if (a.includes("--seeds")) {
    for (const spec of seedRepos()) { const r = await ask(spec); say(spec, r); if (!r.ok) bad++; }
  } else {
    const spec = { repo: a[0], public: !a.includes("--private"), description: opt("--description"), push: a.includes("--push") };
    const r = await ask(spec); say(spec, r);
    if (!r.ok) bad++; else if (r.token) process.stdout.write(r.token);
  }
  process.exit(bad ? 1 : 0);
}
