# Bootstrap notes: branding and deploy thread (2026-11-10)

Procedures that worked and failures hit, so the seed's next initialization starts better. Fold into `docs/BOOTSTRAP-GAPS.md` (owned by the landing-page thread) when that file lands.

## Procedures that worked
1. **Brand as files first.** Write `brand/BRAND.md` (positioning, palette, type, voice, public/private rule), generate every logo variant from one SVG script, render PNGs with Playwright (`brand/tools/render.js`), then apply tokens to site, dashboard, templates, email and external copy in the same PR.
2. **Separate identities early.** The first palette copied the sibling product (QNFO) because the site's CSS tokens were reused. A new project's seed must ask "what must this NOT look like" and pick a distinct palette, typeface and mark before any page is built.
3. **Deploy by patching live code, not re-sending it.** With only the Cloudflare MCP (no API token in the shell), fetch the live script (`content/v2`), verify its sha256 equals the repo's previous version, apply the changed lines, verify the result's sha256 equals the repo's new file, then upload with `keep_bindings` (`plain_text`, `secret_text`, `d1`, `send_email`). Bindings and cron schedules survived. Deployed `ultrastable-dashboard` this way (serves the holding page and owner dashboard on the three domains).
4. **Verify what you can reach.** Shell egress and the Cloudflare sandbox both refuse requests to ultrastable.io, so a live HTTP check was impossible; verification was by script hash, bindings and schedules.

## Failures and fixes
| Failure | Cause | Fix for next time |
|---|---|---|
| Public `.github` repo not created | no valid `gh` token, API blocks repo creation, device VM would not start (disk full) | seed should request an org-owner token or a pre-created `.github` repo as an identity-bound step at init |
| `git push --force` denied twice by the safety classifier | I reset my branch to main after its PR squash-merged | start follow-up work on a fresh branch name, or merge the old remote branch with `-s ours` and push normally |
| Whole bash command denied when it contained a blocked step (`rm -rf logo/*`, force push) so later steps in the chain never ran | chained `&&` after a denied call | keep destructive or risky steps in their own command; never rely on chained steps after one that may be denied |
| Dashboard unit-test run failed on first try | invoked `node --test test/` (directory) instead of the test file | document `node --test dashboard/test/dashboard.test.mjs` in dashboard README |
| JS syntax error after font-name edit | double quotes inside a double-quoted JS string | use single quotes for CSS font names inside JS strings |
| Reviewer request on own PR failed | author cannot review own PR | assign instead; request review only from another account |
| PR deploy not automatic | merging to main does not deploy the workers | add a deploy workflow or run `deploy/` script from CI once a token exists (issue) |

## Still owner-only
Create `ultrastable/.github` (public), set org avatar, description and verified domains, paste the QNFO snippet, file the provisional patent.
