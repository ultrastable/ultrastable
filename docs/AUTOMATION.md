# Automation loop (no human in the path)

Issue -> triage -> agent PR -> checks -> auto-review -> squash merge -> branch delete. Every step has a clock.

| Stage | Workflow | Clock |
|---|---|---|
| Triage (priority, SLA comment, agent-ready, Copilot assign) | issues.yml / scripts/triage.sh | on open, and hourly |
| Issue SLA: p0 4h, p1 24h, p2 72h, p3 7d | scripts/sla.sh | hourly; breach label at 1x, escalate one level at 2x |
| Checks (YAML, secret scan, size, verify) | checks.yml | every PR push |
| Lane (draft to ready, auto-review, merge) | lane.yml / scripts/lane.sh | PR events, check completion, every 10 min |
| Stuck PR: conflict 12h, ci-failed 24h, any 48h | scripts/sla.sh | closed and re-filed as a p2 issue, branch kept |

Hold: label `hold` pauses the lane and the SLA for that item. Nothing else requires a human.

Platform limits (GitHub Free org, private repo): branch protection, rulesets and native auto-merge are unavailable, so the lane workflow performs the merge itself. A PR that changes `.github/workflows/**` cannot be merged with the default token; set the repo secret `LANE_PAT` (fine-grained PAT: contents, pull requests, workflows write) to lift this. Such PRs get the label `needs-pat` meanwhile.
