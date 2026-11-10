# Dashboard deploy: procedure and failures (2026-11-10)

Feeds the seed's `provision` step (BS-3). Status: RUNNING. Live on ultrastable.io, ultrastable.app, ultrastable.net (worker `ultrastable-dashboard` v0.1.0, D1 `ultrastable-ops`); the worker's own cron confirmed all three domains and the disclosure guard at 09:31 UTC.

## Procedure that worked (Cloudflare adapter, no API token, connector only)
1. List zones; confirm the three domains are active.
2. **List zone Workers routes for every zone and remove any that shadow the new worker** (see failure 2).
3. Create D1, apply `dashboard/schema.sql`, seed tasks.
4. Upload the worker as multipart (metadata with bindings: D1, send_email restricted to the owner address, plain vars) and set the cron schedules.
5. Detach custom domains from any older worker, then attach to the new one.
6. Verify from inside the platform: the worker's cron probes each domain's `/health` and the public page for forbidden words, and writes results to D1. Read D1.
7. Hash the deployed script and compare with the file in git.

## Failures and fixes
1. **Sandbox cannot reach the domains** (proxy returns 403 for ultrastable hosts; the connector sandbox blocks fetch). Fix: verify through the worker's own cron and D1, not curl. Seed rule: every deploy ends with an in-platform check, never an outside curl alone.
2. **Hidden zone routes shadowed the worker.** Six routes (`ultrastable.{io,app,net}/*` and `www.`) pointed at `qnfo-gateway` and beat the custom domains, so the old QNFO-flavored page kept serving after "deploy". Symptom: `/health` answered `v3.66.0-codeagent`. Fix: delete the routes (ids recorded in the thread). Seed rule: preflight lists routes, custom domains and DNS per hostname before attaching.
3. **409 when attaching domains**: hostnames were already attached to the older `ultrastable-site` worker. Fix: delete those domain attachments first, then attach. Brief gap is expected.
4. **`www.ultrastable.app` and `www.ultrastable.net` refused** (externally managed DNS records). Not attached; either delete the records or leave them redirecting.
5. **Downloading a script returns multipart, not source.** Patching a deployed worker means parsing between the first blank line and the last boundary, then verifying the sha256 equals the repo file before upload. Done with a hash check; a wrong parse failed with a syntax error and deployed nothing.
6. **Inline upload is expensive** (about 11k tokens per full upload with no token or CI). Fix: CI deploy from the repo (issue #11) with a scoped Cloudflare token as a GitHub secret.
7. **Repo and live drifted.** The brand thread changed `worker.js` in main while the deployed script was older. Fix: hash comparison after each deploy; deploy from main only.
8. **A live public site already described mechanisms** (issue #52). Replaced by a generic holding page the same day. Seed rule: first deploy is a holding page; fuller copy is staged in `site/STAGED-COPY.md` until filing.
9. **A factual claim I wrote from stale notes was wrong** (a public-repo date in owner-queue text, seeded into code and the database). Fixed in PR #71 and the live row. Seed rule: legal or IP statements in seeded data come from a reviewed source, and database and repo seeds are updated together.
10. **Test caught batching**: the new-items email was capped at 10 and sent a second email on the next tick. Cap raised to 50.
11. **Duplicate owner items** (seeded `own-file`/`own-google` and `gh-30`/`gh-17`). Left for the next sync to reconcile; dedupe by source id.
12. **MCP connectors dropped and reconnected mid-session.** Re-load tool schemas and re-check state after any disconnect; never assume a half-finished call completed.
13. **A GitHub credential exists in the sandbox environment but must not be copied into the deployed worker.** The dashboard needs its own fine-grained token, minted by the owner (queue item `own-gh-token`). Until then the `github` check fails by design and issues are a seeded copy.

## Not yet verified (be honest in the next run)
- Live owner login: the code email is sent (confirmed in the notifications table) and the verify path passes offline tests, but the owner has not yet signed in on the real page from a phone.
- Daily digest at 13:00 UTC has not yet fired.
- `FLEET_TOKEN` endpoints are off until a secret exists; no agent consumes the fleet queue yet.
- Search Console and Cloudflare Web Analytics (third-party, indexing) stay gated until filing. First-party cookieless analytics (`seed/analytics/`, ANALYTICS-1) is live: it stores no IP and publishes nothing, so it does not touch the disclosure gate.

## Changes for the next initialization
- Add `preflight` to `seed/bootstrap/bootstrap.py`: zones, routes, custom domains, DNS, existing workers per hostname; fail loudly on shadowing.
- Add `verify` that reads in-platform probe results, then compares deployed hash to git.
- Ship the dashboard worker as part of the seed so every new organization gets owner login, status, queue and notifications on day one.
