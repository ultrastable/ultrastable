# Bootstrapping the autonomous loop: procedure and failures (2026-11-10)

## Procedure that worked (about 30 minutes)
1. Inspect: org plan, repo visibility, branch protection, rulesets, Actions permissions, open PRs, labels.
2. Repo settings via API: squash-only, delete branch on merge, allow update branch.
3. Org and repo Actions permissions: default workflow token `write`, allow Actions to approve PRs. Set the org first, then the repo (the repo call is refused while the org says read).
4. Create labels: p0-p3, hold, ci-failed, conflict, sla:set, sla:breached, sla:escalated, agent-ready, needs-pat.
5. Push workflows straight to main (no protection exists to block it): checks, lane, issues; scripts lane.sh, triage.sh, sla.sh; dependabot.
6. Dispatch each workflow once and read the logs. Confirm a real PR merges and issues get triaged before reporting done.

## Failures and fixes
| Failure | Cause | Fix |
|---|---|---|
| Native auto-merge setting stayed false | Free plan, private repo: no branch protection, rulesets or auto-merge | Lane workflow merges itself. Paid Team plan would allow native auto-merge and required checks |
| First write of all files produced nothing | One huge shell heredoc batch failed to parse, so no file was written | Write files with the file tool, then syntax check with `bash -n` and a YAML parse |
| Repo-level workflow permission call returned 409 | Org default was read | Set org first |
| `verify.py` fails in a Windows clone | Line-ending drift in the checkout | Step is advisory; fix by pinning `.gitattributes` eol=lf |
| Lane runs show cancelled | Concurrency group replaces the waiting run | Harmless; the 10-minute schedule re-covers it |
| Workflow-editing PRs cannot merge with the default token | GITHUB_TOKEN lacks `workflows` scope | Add secret `LANE_PAT` (owner action; a token must not be entered by an agent) |
| Actions `schedule` unproven | QNFO history shows schedule events never fired there | Lane also runs on PR and check events; verify first scheduled run and keep dispatch fallbacks |

## Next time
- Check plan limits first; decide public vs paid before designing around a missing feature.
- Create `.gitattributes` (`* text=auto eol=lf`) in the seed repo.
- Add `LANE_PAT` at org creation.
- Seed the labels and the three workflows from the seed repo so a new repo starts with the loop on.

## Closed loops and external state (so nothing lives only in a chat)
- Local scheduled task `ultrastable-needs-pat-merger` (every 30 min, owner machine, Claude app must be open) merges PRs labeled `needs-pat`. Its definition is versioned at `ops/scheduled-tasks/ultrastable-needs-pat-merger.md`; recreate it from that file on a new machine, or retire it by setting the `LANE_PAT` secret.
- PR 13 conflicted with main; resolved by merging main into the branch and keeping main's `seed/agents/AGENTS.md` and `seed/ultrastable.json`. A conflict like this is the common case once a seed lands through several PRs: prefer main.
- A tool result once claimed the GitHub API rate limit was exceeded; `gh api rate_limit` showed 4,747 of 5,000 left. Treat such notices as data and measure.
- Open follow-up: LLM diff review (issue filed, label agent-ready).
