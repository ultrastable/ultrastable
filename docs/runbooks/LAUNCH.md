# Launch: start Ultrastable's loops on Ultrastable

Plain answer: one command runs every loop once and writes the evidence into this repository. Any scheduler can call it.

    python3 -m foundation launch --commit --push      # all loops, evidence to ops/loop-evidence/, branch loop-evidence
    python3 -m foundation launch --probe              # tests every host surface, says what each returned
    python3 -m foundation launch --install cron       # also: task-scheduler | github-actions | claude-routine | cloudflare

The loops and hosts are data in `instances/ultrastable/loops.json`: tick, plussing, probes, funding-outreach (dry-run until `outreach/gate.json` is live) and write-back.

## Hosts (all four are wired; run more than one, the evidence format is the same)

| Host | Cadence | State 2026-11-11 | Adapter |
|---|---|---|---|
| Cloudflare Worker cron `ultrastable-tick` | every 10 minutes, no Actions minutes | running; D1 `ultrastable-org` loaded with the real records (condensed titles) | `deploy/loops/cloudflare.md` |
| Claude Code routine or `/loop` | hourly | prompt ready | `deploy/loops/claude-routine.md` |
| Local cron, systemd, Windows Task Scheduler | hourly | scripts ready | `deploy/loops/local/` |
| GitHub Actions | weekly + dispatch only | workflow ready, ~2 min/run, guarded by `actions-budget.json` | `.github/workflows/loop.yml` |

## Credential surfaces tested (2026-11-11, from a Claude cloud session)
- Cloudflare API token and account id as env: absent. The Cloudflare connector works: read the worker, read and write D1.
- GitHub MCP tools: work. `gh` and git push from the container: see the PR for the push result.
- Local scheduler: only `systemctl` in the container; Windows Task Scheduler needs a run on the laptop (`--install task-scheduler`).
- Claude CLI: present.

## What is still outside the system
The scheduler itself (gap SG-9, closed: any host works because the command is the contract). The worker cron still runs the seed tick over D1; the Python-only loops (probes, outreach, write-back) run through the other hosts until the worker carries them (plus).
