# Claude Code routine (cloud-hosted)

A routine here is a scheduled task that runs in Anthropic's cloud: the scheduler, the container and the session all live on their servers. Nothing on a person's computer has to be installed, signed in or open. Server-side only (owner, 2026-11-12): a task that needs the Claude desktop app open is not a routine and is not a host (`doctrine/server-side.json`).

Runs the same command as every other host. The routine is created from a cloud session with the scheduler tool (or at claude.ai/code, Routines) on repo `ultrastable/ultrastable`, hourly, with this prompt:

> Read docs/PROJECT-MEMORY.md and instances/ultrastable/loops.json. Run `ULTRASTABLE_HOST=claude-routine python3 -m foundation launch --failover --commit --push`. If any loop failed, open or update the backlog item for it with a probe and fix it on a branch `agent/<item>-<slug>` as a draft PR. Report in four lines: what happened, what I decided, what is next, what is open.

Evidence lands on branch `loop-evidence`; the routine reads `ops/loop-evidence/LATEST.md` to continue where the last pass stopped. `python3 -m foundation launch --probe` reports this host as available only inside a cloud session (`CLAUDE_CODE_REMOTE`); a `claude` program found on a computer does not count.

## Routines that exist (read from the cloud scheduler, 2026-11-12)

| Routine | Schedule (UTC) | What it runs |
|---|---|---|
| Ultrastable executor tick (Claude session route) | `33 */3 * * *` | `python3 -m foundation executor --pick`, the change, checks, a PR, then `--record`; needs no model key |
| Ultrastable Cloudflare transfer (self-closing) | `17 */3 * * *` | probes the dedicated Cloudflare account through the connector and runs `deploy/transfer/plan.json` when it is reachable |

The merge of pull requests labeled `needs-pat` is not a routine: the lane workflow does it (`.github/workflows/lane.yml`, `scripts/lane.sh`).
