// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// TENANT-REPO-2: the credential-free route to a tenant's own repository. tenant-repos.yml has no stored GitHub credential; this asks the site
// Worker over GitHub OIDC, the site asks the tick Worker, and the tick creates the repository with the administration app it already holds.
// Prints a one-hour push token for that one repository on stdout only while the repository is empty, "has-history" when it already has
// commits, and exits 1 with GitHub's answer on stderr otherwise.
//   node deploy/tenant-repo-token.mjs <org/repo> <public|private> [description]
const [repo, visibility = "public", description = ""] = process.argv.slice(2);
const SITE = process.env.TARGET_SITE || "https://ultrastable-site.ultrastable.workers.dev", UA = "ultrastable-tenant-repos";
const u = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, t = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
if (!repo) { console.error("usage: tenant-repo-token.mjs <org/repo> <public|private> [description]"); process.exit(2); }
if (!u || !t) { console.error("no OIDC request URL: the job needs permissions id-token: write"); process.exit(1); }
const id = await (await fetch(u + "&audience=ultrastable-deploy", { headers: { authorization: "bearer " + t } })).json();
if (!id.value) { console.error("no OIDC token"); process.exit(1); }
const r = await fetch(SITE + "/__internal/launches", { method: "POST", headers: { authorization: "Bearer " + id.value, "content-type": "application/json", "user-agent": UA },
  body: JSON.stringify({ op: "tenant-repo", repo, visibility, description }) });
const j = await r.json().catch(() => ({}));
if (!j.ok) { console.error(`tenant repo ${repo}: HTTP ${r.status} ${j.waiting_on || ""} ${j.error || ""}`.trim()); process.exit(1); }
if (j.created) console.error(`created ${repo} with the platform's administration app`);
console.log(j.empty ? j.token : "has-history");
