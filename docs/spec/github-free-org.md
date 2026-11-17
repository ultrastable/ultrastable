<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# What GitHub gives a free organization, and how Ultrastable uses it

Facts retrieved 2026-11-11 from docs.github.com and from read-only calls against the `ultrastable` organization. Anything not confirmed is marked **unverified**. The requirements are in [US-SPEC-24](../specs/US-SPEC-24-github-substrate-and-cost-control.md).

## The short version

GitHub's free organization plan is generous for public repositories, which is what Ultrastable's repositories are, and thin for private ones. Public repositories get unlimited standard-runner Actions minutes, Pages, code scanning, secret scanning and enforced branch rules. Private repositories on the Free plan get a monthly allowance of compute (USD 12, about 2,000 Linux minutes), no Pages and no enforced branch rules. Ultrastable therefore keeps heavy and scheduled work on Cloudflare, uses Actions only for cheap checks, and keeps the spending limit at USD 0 so an overrun stops instead of billing.

## What Ultrastable uses, and how

| GitHub feature | Use | Notes |
|---|---|---|
| Issues | Items, each with a closing probe | Free |
| Pull requests | Changes, draft first | Free |
| Projects (v2) | A board view of items | Availability and item limits on Free **unverified** (the documentation pages read did not state them) |
| Discussions | Owner questions that are not gate cards | Must be enabled per repository; Free availability **unverified** in the pages read |
| Releases | Deployable, versioned bundles | Free |
| Pages | Bootstrap and documentation pages | Public repositories only on Free |
| Actions | Tests, lint, link check | Metered on private repositories |
| Rulesets, branch protection, CODEOWNERS | Enforce the change path | See the difference below |
| Dependabot | Dependency alerts and update pull requests | Available on all plans |
| Code scanning, secret scanning, push protection | Security checks | Free on public repositories only |
| Codespaces | Optional cloud dev machine | No included usage shown for Free organizations; budget is 0 |
| Packages and container registry | Not needed now | Public free; private 500 MB and 1 GB transfer a month |

## Private and public repositories compared

| Area | Private (Free plan) | Public |
|---|---|---|
| Actions minutes | Count against USD 12 a month | Free on standard runners |
| Pages | Not available | Available |
| Branch protection and rulesets | Not available (observed error: "Upgrade to GitHub Pro or make this repository public to enable this feature") | **Unverified**: the pages read did not state it for public repositories |
| Code scanning, secret scanning, push protection | Need paid products | Free |
| Scheduled workflows | Run; any private limits **unverified** | Disabled after 60 days without repository activity |
| Forks and outside pull requests | None | Possible: secrets are not passed to fork runs; approval policy applies; `pull_request_target` is dangerous |
| Anyone can read the workflow files and the history | No | Yes: scan history for secrets first |

What stays the same: every cost and security rule in US-SPEC-24. Free minutes are not a reason to relax them (abuse and forks cost money).

## Limits table

| Limit | Value | Source (retrieved 2026-11-11) |
|---|---|---|
| Included compute, Free organization | USD 12 a month | [Plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans), [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| Linux 2-core, Windows 2-core, macOS | 0.006, 0.010, 0.062 USD per minute | [Runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing) |
| Minute multipliers | Not stated in current docs; ratios are derived: Windows 1.7x, macOS 10.3x Linux | same |
| Rounding | Each job's minutes round up to a whole minute | same |
| Usage blocked without a payment method | Yes, once the included usage is used | [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| Budget stops usage | Only if "Stop usage when budget limit is reached" is selected; otherwise email only | [Budgets](https://docs.github.com/en/billing/concepts/budgets-and-alerts), [Set up budgets](https://docs.github.com/en/billing/tutorials/set-up-budgets) |
| Budget alert thresholds | 75, 90, 100 percent | [Set up budgets](https://docs.github.com/en/billing/tutorials/set-up-budgets) |
| Budget applies from creation date only | Yes | [Budgets](https://docs.github.com/en/billing/concepts/budgets-and-alerts) |
| Artifact storage, Free organization | 500 MB; cache 10 GB per repository | [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [Limits](https://docs.github.com/en/actions/reference/limits) |
| Max job time, max workflow run | 6 hours, 35 days | [Limits](https://docs.github.com/en/actions/reference/limits) |
| Default `timeout-minutes` | 360 (consistent with the 6 hour maximum; the workflow-syntax text that states it was not in the part of the page read) | **unverified directly** |
| Concurrent jobs, Free | 20 | [Limits](https://docs.github.com/en/actions/reference/limits) |
| Matrix | 256 jobs a run | [Limits](https://docs.github.com/en/actions/reference/limits) |
| Artifact retention default | 90 days | [Limits](https://docs.github.com/en/actions/reference/limits) |
| `GITHUB_TOKEN` API rate | 1,000 requests an hour per repository | [Limits](https://docs.github.com/en/actions/reference/limits) |
| Shortest schedule interval | 5 minutes | [Events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) |
| Scheduled workflows in public repos | Disabled after 60 days of no activity | same |
| Pages: site size, bandwidth, builds | 1 GB, 100 GB a month soft, 10 builds an hour soft (not applied to custom Actions publishing) | [Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) |
| Pages on Free | Repository must be public | [Creating a Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site) |
| Rulesets | Documented for Team and Enterprise (private); 75 per repository, 75 organization wide | [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) |
| Private-repo protected branches, required reviewers, code owners | Listed under Team, not Free | [Plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans) |
| Packages, private, Free | 500 MB storage, 1 GB transfer a month; public free | [Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages) |
| Security features | Code scanning, secret scanning, push protection, dependency review free on public; Dependabot on all plans | [Security features](https://docs.github.com/en/code-security/getting-started/github-security-features) |
| Default `GITHUB_TOKEN` for new organizations | Read for contents and packages (documented); this organization currently reports `write` | [Org policies](https://docs.github.com/en/organizations/managing-organization-settings/disabling-or-limiting-github-actions-for-your-organization); observed |
| Fork approval policy | first_time_contributors (observed on this organization) | observed |
| Codespaces for Free organizations | No included usage found; **unverified** | [Codespaces](https://docs.github.com/en/codespaces/overview) |

## Does the spending limit hard-stop?

Yes, today. Read on 2026-11-11 with `gh api organizations/ultrastable/settings/billing/budgets`: four budgets (Actions, Git LFS, Codespaces, Packages), each amount 0 with `prevent_further_usage: true`. Together with the documented rule that usage is blocked once included usage is consumed and no payment method is on file, an overrun stops rather than bills. Limit of this evidence: the exact stop behaviour (running jobs killed or only new ones refused) is not documented in the pages read, so Ultrastable also keeps its own minutes budget below the allowance (watchdog at 50 and 80 percent).

Usage you can read: `gh api organizations/ultrastable/settings/billing/usage` (rows per day, product, repository) and `.../usage/summary` (preview). The old per-account `settings/billing/actions` endpoint is retired (reported to return 410; not re-tested). On Windows with Git Bash write the path without a leading slash, or the shell rewrites it into a file path.

## What to turn on, in order

Do these as the organization owner. Commands marked **untested** were written from the documentation and not run. The script `tools/github_settings.py` in the code repository prints the same commands (dry run by default).

1. **Keep the Actions spending limit at USD 0.** Click path: organization, Billing and licensing, Budgets and alerts, the Actions budget, amount 0, "Stop usage when budget limit is reached" on. Already in place; verify with `gh api organizations/ultrastable/settings/billing/budgets`.
2. **Default workflow token read-only.** Settings, Actions, General, Workflow permissions, "Read repository contents and packages permissions", untick "Allow GitHub Actions to create and approve pull requests". Command (untested): `gh api -X PUT orgs/ultrastable/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false`. Currently the organization reports `write`.
3. **Require approval for outside contributors' workflows.** Settings, Actions, General, "Fork pull request workflows from outside collaborators", "Require approval for all outside collaborators". Command (untested): `gh api -X PUT orgs/ultrastable/actions/permissions/fork-pr-contributor-approval -f approval_policy=all_external_contributors`.
4. **Restrict which actions may run.** Settings, Actions, General, "Allow ultrastable and select non-ultrastable actions", allow GitHub-owned actions. Commands (untested): `gh api -X PUT orgs/ultrastable/actions/permissions -f enabled_repositories=all -f allowed_actions=selected`, then `gh api -X PUT orgs/ultrastable/actions/permissions/selected-actions -F github_owned_allowed=true -F verified_allowed=false`.
5. **Repository merge settings** (each repository): squash only, delete branch on merge, Discussions on, wiki off. Command (untested): `gh api -X PATCH repos/ultrastable/workers -F delete_branch_on_merge=true -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false -F has_discussions=true -F has_wiki=false`.
6. **Discussions.** Repository, Settings, General, Features, tick Discussions; create the category "Owner questions".
7. **Project board.** Organization, Projects, New project, Board; add the repositories' issues and pull requests; fields: Status, Program, Probe. Free-plan availability **unverified**, so open one and see.
8. **Pages (public repositories only).** Repository, Settings, Pages, Source "GitHub Actions" or "Deploy from a branch" on `main` and folder `/docs`. Possible on public repositories only.
9. **Rulesets.** Repository, Settings, Rules, Rulesets, New branch ruleset: target the default branch, require a pull request, require status checks `test`, block force pushes. On private Free repositories this is refused (observed); apply it to every public repository.
10. **Before publishing a repository**: scan history for secrets, turn on secret scanning and push protection (Settings, Advanced Security), set fork approval (step 3), confirm no workflow uses `pull_request_target` or exposes secrets to forks, then apply step 9.

Dependabot: add `.github/dependabot.yml` per repository with a weekly interval for the ecosystems in use; its runs are free (documented as free usage) and its pull requests run your workflows, so the path filters in US-24-R13 matter.

## How the cost rules look in a workflow

Every workflow in the code repository has read-only permissions, a concurrency group that cancels superseded pull request runs, `timeout-minutes` of at most 15, path filters so documentation-only changes skip the test job, no schedule trigger, and actions pinned to a version tag. `tools/workflow_lint.py` checks these on every run, and `tools/actions_budget.py` reads the billing usage and says ok, warn50, warn80 or over.
