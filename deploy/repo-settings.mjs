// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// REPO-SETTINGS-1: the credential-free route to delete_branch_on_merge and allow_auto_merge on one org repository. The job's GitHub OIDC token goes
// to the site Worker, the site asks the tick Worker, and the tick sets the two settings with the administration app it already holds.
//   node deploy/repo-settings.mjs <org/repo>     prints the settings it turned on (or "unchanged"); exits 1 with the reason on stderr
const [repo] = process.argv.slice(2);
const SITE = process.env.TARGET_SITE || "https://ultrastable-site.ultrastable.workers.dev";
const u = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, t = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
if (!repo) { console.error("usage: repo-settings.mjs <org/repo>"); process.exit(2); }
if (!u || !t) { console.error("no OIDC request URL: the job needs permissions id-token: write"); process.exit(1); }
const id = await (await fetch(u + "&audience=ultrastable-deploy", { headers: { authorization: "bearer " + t } })).json();
if (!id.value) { console.error("no OIDC token"); process.exit(1); }
const r = await fetch(SITE + "/__internal/launches", { method: "POST", headers: { authorization: "Bearer " + id.value, "content-type": "application/json", "user-agent": "ultrastable-repo-settings" },
  body: JSON.stringify({ op: "repo-settings", repo }) });
const j = await r.json().catch(() => ({}));
if (!j.ok) { console.error(`repo settings ${repo}: HTTP ${r.status} ${j.waiting_on || ""} ${j.error || ""}`.trim()); process.exit(1); }
console.log(j.archived ? "archived (read-only, skipped)" : j.changed && j.changed.length ? j.changed.join(", ") : "unchanged");
