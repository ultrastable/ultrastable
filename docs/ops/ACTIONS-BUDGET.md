# Actions minutes budget

Rule: stay inside the free monthly Actions quota for private repositories. As of 2026-11-10 GitHub Free gives 2,000 Linux minutes per month (Pro and Team 3,000); private-repo minutes bill at 1x for Linux, 2x Windows, 10x macOS; public repositories are free. Check the current figure at docs.github.com (billing, about billing for GitHub Actions) and keep `monthly_free_minutes` in `actions-budget.json` in step. Minutes are rounded up per job, so a one-second job costs a minute.

## Before and after (estimate, ultrastable/ultrastable, per month, from the workflow triggers and sampled run times)

| Workflow | Before | After |
|---|---|---|
| lane (every 10 min + PR events + checks) | ~4,400 | ~150 (checks completion + 1 daily fallback) |
| issues (hourly + opened/reopened) | ~1,000 | ~60 (daily + opened) |
| index (hourly + every issue event, failing) | ~800 | ~5 (weekly) |
| retriage (every 3 h) | ~240 | ~5 (weekly) |
| memory-fresh (6-hourly + push + PR) | ~300 | 0 (a step in checks) |
| checks (every PR push, drafts too, 2 failures sampled) | ~400 | ~250 (ready PRs, cancel-in-progress, lint first) |
| platform-core (3 jobs, 3-way matrix, PR and push) | ~150 | ~50 (one job) |
| outreach, dashboard-snapshot, social-post, org-profile-probe, funding-maintenance (daily) | ~270 | ~45 (weekly, twice weekly social) |
| org-settings (failing on push, no token) | ~10 | 0 (dispatch only) |
| actions-budget (new) | 0 | ~4 |
| **Total** | **~7,500** | **~570** |

Before is above the 2,000 quota; after is about 30% of it. `scripts/actions_budget.py` gives the measured figure from run history.

## Mechanisms

- `actions-budget.json`: `paused`, `paused_workflows`, `essential`, quota and thresholds. Non-essential workflows call `scripts/actions_guard.py <name>` right after checkout and cancel their own run when paused.
- `actions-budget` workflow (weekly): estimates minutes from run history; at `pause_at_pct` of the quota it commits `paused: true`.
- `scripts/lint_workflows.py` (first step of `checks`, about 2 seconds): requires `# budget:`, `# trigger:`, `# free-alternative:` headers, `timeout-minutes` per job, no matrix, no cron more often than daily, concurrency on scheduled and PR workflows.
- Zero-minute alternative: a Cloudflare cron worker (not billed by Actions) can run any of the scheduled sweeps through the REST API. Moving issues, retriage, outreach, dashboard and social there is the next plus.

## Public minutes

Public repositories get unlimited free minutes. Do not make anything public: the provisional patent is not filed (docs/CONFIDENTIALITY.md). A later option is a small public repo with only non-confidential tooling (the lint, the budget script, public-safe CI) once the filing is done; until then this is documentation only.
