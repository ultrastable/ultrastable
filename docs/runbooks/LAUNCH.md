# Launch: start Ultrastable's loops on Ultrastable

Plain answer: one command runs every loop once and writes the evidence into this repository. Every scheduler that calls it is server-side (owner, 2026-11-12: Ultrastable runs server-side only; `python3 -m foundation serverside --check`).

    python3 -m foundation launch --commit --push      # all loops, evidence to ops/loop-evidence/, branch loop-evidence
    python3 -m foundation launch --probe              # tests every host surface, says what each returned
    python3 -m foundation launch --install github-actions   # also: claude-routine | cloudflare

The loops and hosts are data in `instances/ultrastable/loops.json`: tick, plussing, probes, funding-outreach (dry-run until `outreach/gate.json` is live) and write-back.

## Hosts (all three are server-side and wired; run more than one, the evidence format is the same)

| Host | Cadence | State 2026-11-11 | Adapter |
|---|---|---|---|
| Cloudflare Worker cron `ultrastable-tick` | every 10 minutes, no Actions minutes | running; D1 `ultrastable-org` loaded with the real records (condensed titles) | `deploy/loops/cloudflare.md` |
| Claude Code routine (cloud-hosted) | hourly, takes over after 3 h of silence | prompt ready | `deploy/loops/claude-routine.md` |
| GitHub Actions (the credential-free route: its built-in token is minted by GitHub per run) | daily gate + dispatch, takes over after 12 h of silence | workflow ready, about 1 min/day while another host is alive, guarded by `actions-budget.json` | `.github/workflows/loop.yml` |

## Credential surfaces tested (2026-11-11, from a Claude cloud session)
- Cloudflare API token and account id as env: absent. The Cloudflare connector works: read the worker, read and write D1.
- GitHub MCP tools: work. `gh` and git push from the container: see the PR for the push result.
- Claude routine: counted only inside a cloud session (`CLAUDE_CODE_REMOTE`); a `claude` program on a computer is not a host.

## What is still outside the system
The scheduler itself (gap SG-9, closed: any server-side host works because the command is the contract). The worker cron still runs the seed tick over D1; the Python-only loops (probes, outreach, write-back) run through the other hosts until the worker carries them (plus).
