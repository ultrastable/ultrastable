# GitHub settings audit (2026-11-10)

Source of truth: [github/org-settings.json](../../github/org-settings.json). Applied by `scripts/apply_github_settings.sh` (workflow `org-settings`). Brand: [brand/BRAND.md](../../brand/BRAND.md).

## What is verified live
| Surface | Observed | How |
|---|---|---|
| Org profile README | live ("runs itself, and gets better while it does") | `curl raw.githubusercontent.com/ultrastable/.github/main/profile/README.md` |
| Org description | set to the headline (BG-13) | org-init |
| Repo README header | banner, headline, status table | this repo |

## What a session cannot read or write (recorded, not bypassed)
Org and repo settings endpoints return "not available: sessions are bound to their configured repositories" or "Repository settings writes are not permitted through this proxy". So current values of repo description, topics, merge options and security features are **unverified**; the desired state is declared in code and `probe` mode reads it back once the token exists.

## Desired state, by field
| Field | Value | Why |
|---|---|---|
| Org description | Coding agents write code. Ultrastable runs the system. From one idea to a business that improves itself. | headline plus sub-line, under 160 chars |
| Org URL, email | https://ultrastable.io, pilot@ultrastable.io | canonical domain, pilot contact |
| Default member permission | read | least privilege |
| Members creating public repos | off | confidentiality until filing |
| Repo description / homepage | autonomous system, "private system of record" / ultrastable.io | generic, SAFE NOW wording |
| Topics | autonomous-agents, ai-agents, agent-orchestration, developer-tools, devops, automation, bootstrapping, cloudflare-workers, google-cloud | discoverability if ever public |
| Merge | squash only, auto-merge on, delete head branch, update-branch button | matches `retriage` auto-merge; clean history |
| Wiki, discussions | off | docs live in code |
| Security | Dependabot alerts and fixes, secret scanning with push protection | nothing secret in repo |
| `main` | no force-push, no deletion, linear history; no required reviewers (retriage merges green PRs) | protects history without blocking the fleet |
| Community files | SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, SUPPORT, CODEOWNERS, issue templates | added in `.github/` |
| Site | PNG social card, twitter card, touch icon, theme colour | BG-24 |

## Residuals
BG-22 (apply, needs token) and BG-23 (UI-only brand items) in [docs/BOOTSTRAP-GAPS.md](../BOOTSTRAP-GAPS.md).
