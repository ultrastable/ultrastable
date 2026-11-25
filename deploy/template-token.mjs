// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// TEMPLATE-PUBLISH-1 (FLEET-MAP-1): the credential-free route to the template repository. template-publish.yml has no stored GitHub credential;
// this asks the site Worker over GitHub OIDC, the site asks the tick Worker, and the tick hands back a one-hour token for ultrastable/seed only.
// Prints the token on stdout; exits 1 with the answer on stderr otherwise.
//   node deploy/template-token.mjs
const SITE = process.env.TARGET_SITE || "https://ultrastable-site.ultrastable.workers.dev", UA = "ultrastable-template-publish";
const u = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, t = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
if (!u || !t) { console.error("no OIDC request URL: the job needs permissions id-token: write"); process.exit(1); }
const id = await (await fetch(u + "&audience=ultrastable-deploy", { headers: { authorization: "bearer " + t } })).json();
if (!id.value) { console.error("no OIDC token"); process.exit(1); }
const r = await fetch(SITE + "/__internal/launches", { method: "POST", headers: { authorization: "Bearer " + id.value, "content-type": "application/json", "user-agent": UA },
  body: JSON.stringify({ op: "template-token", repo: "ultrastable/seed" }) });
const j = await r.json().catch(() => ({}));
if (!j.ok || !j.token) { console.error(`template token: HTTP ${r.status} ${j.waiting_on || ""} ${j.error || ""}`.trim()); process.exit(1); }
console.log(j.token);
