# Seed: from one idea file to a running organization

The spark. One person writes an idea; this repo turns it into a running organization of virtual managers and staff, server-side, on a heartbeat.

```
IDEA.md  ──►  bootstrap/bootstrap.py  ──►  org/ (charter, roles, backlog, gate cards)
                                      ──►  D1 schema + seed rows
                                      ──►  Worker with a 10-minute tick (managers run here)
```

After the first boot, nothing runs on a laptop. The bootstrapper is the only step that starts from a person; every later step starts from the tick.

## Start: three doors, one result

There are three ways to start, and they end at the same checks and the same console (US-SPEC-19 in the specification repository). A person who is not a developer never needs the third.

1. **A web page.** The launcher (`apps/launcher`) asks what you want, checks you are not a robot on your own device, and puts a live preview online on a free Cloudflare temporary account. It says plainly that the preview is not verified until it is claimed.
2. **A prompt pasted into an AI assistant.** [`agent-setup/PROMPT.txt`](../agent-setup/PROMPT.txt) points an assistant at [`agent-setup/SKILL.md`](../agent-setup/SKILL.md), which deploys the organization and ends at the closing probe `agent-setup/verify.mjs`.
3. **The developer path** (below). Write your idea in [`IDEA.md`](../IDEA.md), the one file a founder touches, then:
   - Dry run, anywhere with Python 3.11+ and no dependencies: `python3 bootstrap/bootstrap.py --dry-run`. It writes `org/` (charter, roles, backlog, gate cards, an owner README, boot log) and prints a four-line report. Nothing leaves the machine.
   - Apply, once, from CI or a machine with a Cloudflare sign-in: `python3 bootstrap/bootstrap.py --apply`. It tries the ladder of Cloudflare routes, creates the D1 database, applies migrations, loads the seed rows and deploys the Worker. From then on the Worker's clock is the heartbeat. The GitHub workflow [`.github/workflows/self-start.yml`](../.github/workflows/self-start.yml) runs the same command on the first push.

All of these are one command line through `node tools/us.mjs <command>`.

A missing credential never stops the boot. The step is recorded as a backlog item with its blocker and a closing probe, and the rest of the boot continues (the AIOS "PID 1 never dies" rule; see [docs/bootstrapping.md](bootstrapping.md)).

## What is in the seed

| Path | What it is |
|---|---|
| [`IDEA.md`](../IDEA.md) | The idea, the person, the first outcomes. The one human input. |
| [`ultrastable.json`](../ultrastable.json) | Org config: name, roles, connectors, model ladder, budget, capacity rules. Defaults work as-is. |
| [`autonomy/policy.json`](../autonomy/policy.json) | Autonomy settings: the maximum permission per surface, action classes, trust ladder defaults and thresholds, the narrow interrupt gate, standing limits. |
| [`agents/AGENTS.md`](../agents/AGENTS.md) | The shared protocol every agent reads (Claude Code, Copilot, Codex, any other). |
| [`agents/roles/`](../agents/roles/) | One instruction file per virtual role: portfolio, project, product manager, staff, reviewer, operations. |
| [`.claude/settings.json`](../.claude/settings.json) | Claude Code permissions at the ceiling the policy allows, with the gated actions denied. |
| [`CLAUDE.md`](../CLAUDE.md), [`.github/copilot-instructions.md`](../.github/copilot-instructions.md) | Pointers so each agent loads `agents/AGENTS.md`. |
| [`bootstrap/bootstrap.py`](../bootstrap/bootstrap.py) | The bootstrapper: read, detect, select, cases, plan, write, surfaces, org, scaffold, ladder, provision, start, report. Stdlib only, idempotent. |
| [`core/`](../core/) and [`adapters/cloudflare/`](../adapters/cloudflare/) | The portable tick and schema, and the Cloudflare Worker that runs them. |
| [`tests/`](../tests/) | Bootstrapper and policy tests (`python3 -m unittest discover tests`). |
| [`docs/bootstrapping.md`](bootstrapping.md) | The boot sequence, stage by stage, and what each stage learned from AIOS. |

## Rules the seed carries into every org it starts

- **If it is not in code, it does not exist.** Every output of every role is a commit, an issue or a database row. Chat is never the record.
- **The fleet is the actor.** People set direction and take only identity-bound steps (money, signing, credentials only they hold, their own accounts). Each of those is a gate card, never an instruction in prose.
- **Narrow interrupt gate.** An agent stops only for a step that is irreversible and identity-bound with no reversible path. Everything else runs, is verified and reported.
- **Trust is computed, not granted.** It rises and falls with recorded outcomes per surface and action class, and widens scope only through a reviewed change to `autonomy/policy.json`.
- **Never self-review.** A different agent or model verifies each claimed result.
- **Plussing.** 20% of capacity goes to improvements, and every closed item proposes one.
