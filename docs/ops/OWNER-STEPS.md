# Owner steps in one place (minimum manual work)

Every other item is done by the fleet. Each row: time estimate, what removes it, default in effect.

| # | Step (identity-bound) | Time | Route that removes or shrinks it | Default until done |
|---|---|---|---|---|
| 1 | File the Dutch priority application (`ip/europe/OWNER-CARD.md`, `SELF-FILING-WALKTHROUGH.md`) | 45-90 min plus bank transfer | None: signature and payment are the owner's. Paper filing at OCNL if the portal still answers "not available via this channel" | Nothing public beyond SAFE NOW |
| 2 | Legal entity and IP assignment (BIZ-1, FUND-3, issue #105) | counsel-dependent, about 1-2 h of your time | None | Entity-dependent applications unsubmitted |
| 3 | Mint `ORG_ADMIN_TOKEN` (`docs/ops/ORG-TOKEN.md`) | 5 min | Largely removed already: the desktop Code session's `gh` login held `admin:org` (BG-13). Only needed again for new automation | Org page already live; holding state otherwise |
| 4 | Save `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` repo secrets and set variable `DEPLOY_SITE_ENABLED=true` | 5 min | Done 2026-11-10: secrets and `DEPLOY_SITE_ENABLED` set from the desktop session; site deployed with `deploy/deploy-site.mjs` and the four hostnames repointed to `ultrastable-site` | Done |
| 5 | Org avatar, social preview, pins, domain verification (BG-23) | 10 min | None: GitHub has no API for these | Identicon |
| 6 | Create Bluesky and Mastodon accounts, add tokens (SOC-1, SOC-2) | 15 min | None | Social posting dry-run |
| 7 | Submit funding applications (`business/funding/applications/*/OWNER-CARD.md`; needs entity, domain email, billing ID, live site) | 20-30 min each, after steps 2 and 4 | Domain email `hello@` done 2026-11-10 (forwards to the owner's Outlook); outreach sender still needs Email Sending scope on the token | Not submitted |
| 8 | Co-founder or operator outreach (FUND-5, #107) | 30 min to approve | None: sends as the owner | Drafted, nothing sent |

Merged duplicates: issue cards #103 to #107 and #96 (BIZ-4) are this table. Order: 1, 2, 7, then 5, 6, 8; step 3 and 4 only if automation needs them.

Status 2026-11-10: site live (BG-25 closed), `hello@` live (WEB-5 closed), org Projects board created with all open issues loaded (#53 closed). Remaining rows are identity-bound: 1, 2, 5, 6, 7, 8.
