// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// DEPLOY-VISIBLE-1: where a repository's code runs is recorded on that repository as a GitHub Deployment with the live URL.
import test from "node:test";
import assert from "node:assert/strict";
import { plan, record } from "../deploy/record-deployments.mjs";
const topology = { workers: [{ id: "ultrastable-site", routes: ["ultrastable.io"] }, { id: "ultrastable-tick" }, { id: "ultrastable-unlearn", routes: ["unlearn.ultrastable.org"], source: { repo: "ultrastable/unlearn" } }, { id: "ultrastable-x", source: { repo: "ultrastable/x" } }] };
const tenantRepos = { tenants: { x: { repo: "ultrastable/x", frontend: "https://x.example.org" } } };
const CORE = "ultrastable/ultrastable", A = "a".repeat(40), B = "b".repeat(40);
const results = [{ worker: "ultrastable-tick", ok: true }, { worker: "ultrastable-site", ok: true }, { worker: "ultrastable-unlearn", ok: true, source_repo: "ultrastable/unlearn", source_sha: B }, { worker: "ultrastable-x", ok: false, source_repo: "ultrastable/x", source_sha: B }];
test("one deployment per repository: the core at the run's commit, a tenant on its own repository at its own commit with its own URL", () => {
  const p = plan(results, { topology, tenantRepos, coreRepo: CORE, coreSha: A });
  assert.deepEqual(p.map(d => [d.repo, d.sha, d.url]), [[CORE, A, "https://ultrastable.io/"], ["ultrastable/unlearn", B, "https://unlearn.ultrastable.org/"]]);
  assert.equal(plan([{ worker: "ultrastable-x", ok: true, source_repo: "ultrastable/x", source_sha: B }], { topology, tenantRepos, coreRepo: CORE, coreSha: A })[0].url, "https://x.example.org", "a tenant with no route uses its registered front end");
  assert.equal(plan([{ worker: "ultrastable-unlearn", ok: true, source_repo: "ultrastable/unlearn" }], { topology, tenantRepos, coreRepo: CORE, coreSha: A }).length, 0, "no tenant commit, no record: a wrong commit is never written");
});
test("the core is written with the run's token, a tenant through the code app; a refusal is reported with GitHub's answer and does not throw", async () => {
  const calls = [], lines = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body, auth: init.headers.authorization });
    if (url.endsWith("/repos/ultrastable/ultrastable/deployments")) return new Response(JSON.stringify({ id: 9 }), { status: 201 });
    if (url.endsWith("/deployments/9/statuses")) return new Response("{}", { status: 201 });
    if (url.endsWith("/__internal/launches")) return new Response(JSON.stringify({ ok: false, waiting_on: "code-app-scope", error: "the code app has no Deployments: write grant on ultrastable/unlearn" }), { status: 409 });
    return new Response("{}", { status: 500 });
  };
  const r = await record(results, { coreRepo: CORE, coreSha: A, token: "run-token", site: "https://site", oidc: async () => "oidc", fetch: f, topology, tenantRepos, log: l => lines.push(l) });
  assert.equal(r[0].ok, true); assert.equal(r[0].route, "run-token");
  assert.equal(calls[0].body.environment, "production"); assert.equal(calls[0].body.ref, A); assert.deepEqual(calls[0].body.required_contexts, []);
  assert.equal(calls[1].body.environment_url, "https://ultrastable.io/"); assert.equal(calls[1].body.state, "success");
  assert.equal(calls[2].body.op, "repo-deployment"); assert.equal(calls[2].body.repo, "ultrastable/unlearn"); assert.equal(calls[2].body.sha, B); assert.equal(calls[2].auth, "Bearer oidc");
  assert.equal(r[1].ok, false); assert.match(lines[1], /::warning::.*ultrastable\/unlearn.*Deployments: write/);
});
