// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// REPO-SETTINGS-1 / REPO-STANDARD-1: the credential-free route to the repository standard on one org repository. The job's GitHub OIDC token goes
// to the site Worker, the site asks the tick Worker, and the tick applies the standard (merge rules, security, main ruleset) and the description,
// homepage and topics passed here with the administration app it already holds.
//   node deploy/repo-settings.mjs <org/repo> ['{"description":..,"homepage":..,"topics":[..],"visibility":"public"}']
// prints what it changed (or "unchanged", or "archived"); exits 1 with every refused step on stderr, so a refusal is never a quiet skip
const [repo, extra] = process.argv.slice(2);
let more = {}; if (extra) { try { more = JSON.parse(extra); } catch { console.error("the second argument must be JSON"); process.exit(2); } }
const SITE = process.env.TARGET_SITE || "https://ultrastable-site.ultrastable.workers.dev";
const u = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, t = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
if (!repo) { console.error("usage: repo-settings.mjs <org/repo>"); process.exit(2); }
if (!u || !t) { console.error("no OIDC request URL: the job needs permissions id-token: write"); process.exit(1); }
const id = await (await fetch(u + "&audience=ultrastable-deploy", { headers: { authorization: "bearer " + t } })).json();
if (!id.value) { console.error("no OIDC token"); process.exit(1); }
const r = await fetch(SITE + "/__internal/launches", { method: "POST", headers: { authorization: "Bearer " + id.value, "content-type": "application/json", "user-agent": "ultrastable-repo-settings" },
  body: JSON.stringify({ ...more, op: "repo-settings", repo }) });
const j = await r.json().catch(() => ({}));
if (!j.ok) { console.error(`repo settings ${repo}: HTTP ${r.status} ${j.waiting_on || ""} ${j.error || ""}${j.changed && j.changed.length ? " (changed before the refusal: " + j.changed.join(", ") + ")" : ""}`.trim()); process.exit(1); }
console.log((j.archived ? "archived" : j.changed && j.changed.length ? j.changed.join(", ") : "unchanged") + (j.gated && j.gated.length ? " gated(private): " + [...new Set(j.gated)].join(", ") : ""));
