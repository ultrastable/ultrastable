# Ultrastable: handoff (state at 2026-11-10; this file replaces the chat thread)

## What the product is
Ultrastable is a self-governing development platform: a control loop around coding agents that finds its own work in metrics and failures, hands each task to the agent that fits, proves every change live with automatic revert, and scores its own decisions against logged predictions. QNFO (the owner's research fleet) runs on it as customer zero. Name from W. Ross Ashby's ultrastable system (Design for a Brain, 1952).

## Owner decisions made in this thread
- Ultrastable must be a **separate company codebase** (to shop around for funding), with its own repo and business docs, governed by the Ultrastable License. A new GitHub org named for it was suggested; not created.
- Everything must be done by the agent without manual steps; voice-driven; the owner does not want to create anything by hand.
- Positioning: the self-governing layer **around the coding agents a team already uses** (not another agent, not only a gateway).

## Live now (verified from outside the account, 2026-11-10)
- Cloudflare worker `ultrastable-site` v0.1.0, source `site/worker.js` (standalone; no QNFO design-system code).
- https://ultrastable.io (canonical: /, /how, /proof, /pilot, /health, robots.txt, sitemap.xml, llms.txt). www.ultrastable.io, ultrastable.app (to /pilot), ultrastable.net (to /proof) redirect.
- /proof reads live claims from https://qnfo.org/api/platform-claims (7 of 7 passed at 08:33 UTC). That feed also exposes a `repo_url` pointing at the public QNFO repo: build a product-side feed (see github/issues.json).
- Mail: Email Routing enabled on the ultrastable.io zone; pilot@ultrastable.io forwards to the owner's verified address (rule named "pilot inbox").
- Private KV namespace `ultrastable-private` (id 41ef5a537ec24f598db2a1178a5e69e1): docs/positioning.md, docs/extraction-plan.md, github/issues.json, github/roadmap.json.
- Cloudflare zone ids: ultrastable.io 18a7463a4e79b98d04aa22eb96b0127b; ultrastable.app 29a8a782765682441aafd3f64a186ea6; ultrastable.net e23fd6a6078d557c08462aaa80614402. The zones are still in the quniverse account until the registrar lock ends (2026-11-20); everything else runs in the ultrastable account (81e3a4efb4eb66e613529b87682911bb). Redeploy: `deploy/deploy-site.mjs`.

## Blocked / not done, with the reason
- **(Resolved 2026-11-10)** GitHub: repo https://github.com/ultrastable/ultrastable exists, main is pushed, 12 issues filed (ROADMAP.md maps them to Now/Next/Later). Remaining gap: no GitHub Projects board (the agent had no Projects tool); create one and add the issues. Earlier text, kept for history: **GitHub org and repo not created.** GitHub has no API to create an organization, and repo creation was disabled for the agent session that did this work (and was not worked around). `github/bootstrap-github.sh` creates the repo, files the 12 issues and a project once the org exists. 
- **IP ownership is the main diligence item.** The author owns the code personally and no entity exists yet. `QNFO/qnfo-workers` is public under the QNFO User License Agreement v2.1, which prohibits commercial use without a separate commercial license (verified in the repo's LICENSE, 2026-11-10); the author must grant the company a written assignment or commercial license. Incorporate, assign the core.
- Pilot sign-up is a mailto link, not a form. Source of truth for the site until a repo exists: this directory and the deployed worker.
- PR QNFO/qnfo-workers#10183 (an earlier attempt to put the site in the public repo) was closed unmerged.
- QNFO roadmap issues #10173-#10177 (P0-P4 spin-off) are still in the public repo; the same work is in github/issues.json.
- No agents or routines were created for this product; nothing runs besides the site worker.

## Layout
- `site/` worker, tests (`node site/site.test.mjs`), probes, wrangler config
- `deploy/` deploy script
- `github/` issues.json (12), roadmap.json (Now/Next/Later), bootstrap-github.sh
- `core-manifest/` which QNFO workers are product core (19), QNFO apps (12) or personal (8); extraction map (phases P1-P4)
- `docs/` positioning, extraction plan, product design (full original)
- `research/market-read.md` market research and sources
