# ultrastable/seed

**Ultrastable is the foundation for any autonomous system.**

A system is autonomous if it has self-referential loops and the ability to close them. Knowing without being able to act is useless, so the system is privileged to close its own loops (`python3 -m foundation loops --verify`).

Ultrastable runs on itself: its roadmap, issues, managers, trust ledger, plussing budget and specs are run by the same code it gives everyone else, from this repository alone, with any tools (`python3 -m foundation selfhost`).

The spark. One person writes an idea; this repo turns it into a running organization of virtual managers and staff, server-side, on a heartbeat.

```
IDEA.md  ──►  bootstrap/bootstrap.py  ──►  org/ (charter, roles, backlog, gate cards)
                                      ──►  D1 schema + seed rows
                                      ──►  Worker with a 10-minute tick (managers run here)
```

After the first boot, nothing runs on a laptop. The bootstrapper is the only step that starts from a person; every later step starts from the tick.

## Boot in three steps

1. Copy this repo (template repo, `git clone`, or the bundle). Write your idea in [`IDEA.md`](IDEA.md). That is the only file a founder has to touch.
2. Dry run, anywhere with Python 3.11+ and no dependencies:
   `python3 bootstrap/bootstrap.py --dry-run`
   It writes `org/` (charter, roles, backlog, gate cards, boot log) and prints a four-line report. Nothing leaves the host it runs on.
3. Apply, once, from CI or a cloud-hosted session with a Cloudflare token in the environment:
   `python3 bootstrap/bootstrap.py --apply`
   It creates the D1 database, applies migrations, loads the seed rows and deploys the Worker. From then on the Worker's cron is the heartbeat. The GitHub workflow [`bootstrap.yml`](.github/workflows/bootstrap.yml) runs the same command on the first push.

A missing credential never stops the boot. The step is recorded as a backlog item with its blocker and a closing probe, and the rest of the boot continues (the AIOS "PID 1 never dies" rule; see [docs/bootstrapping.md](docs/bootstrapping.md)).

## What is in the seed

| Path | What it is |
|---|---|
| [`IDEA.md`](IDEA.md) | The idea, the person, the first outcomes. The one human input. |
| [`ultrastable.json`](ultrastable.json) | Org config: name, roles, connectors, model ladder, budget, capacity rules. Defaults work as-is. |
| [`autonomy/policy.json`](autonomy/policy.json) | Autonomy settings: the maximum permission per surface, action classes, trust ladder defaults and thresholds, the narrow interrupt gate, standing limits. |
| [`agents/AGENTS.md`](agents/AGENTS.md) | The shared protocol every agent reads (Claude Code, Copilot, Codex, any other). |
| [`agents/roles/`](agents/roles/) | One instruction file per virtual role: portfolio, project, product manager, staff, reviewer, operations. |
| [`.claude/settings.json`](.claude/settings.json) | Claude Code permissions at the ceiling the policy allows, with the gated actions denied. |
| [`CLAUDE.md`](CLAUDE.md), [`.github/copilot-instructions.md`](.github/copilot-instructions.md) | Pointers so each agent loads `agents/AGENTS.md`. |
| [`bootstrap/bootstrap.py`](bootstrap/bootstrap.py) | The bootstrapper: read, detect, select, plan, provision, start, report. Stdlib only, idempotent. |
| [`worker/`](worker/) | The server-side runtime: Cloudflare Worker with the tick, D1 migrations, tests. |
| [`plugins/`](plugins/SCOPE.json) | Optional plugin tier (email, mailing list, social, YouTube, GCP, self-description, guided communication flow). Dry-run by default, never in the core path. Spec: `docs/architecture/plugins.md`. |
| [`tests/`](tests/) | Bootstrapper and policy tests, <!-- claim:seed-py-tests -->72<!-- /claim --> in all (`python3 -m unittest discover tests`). |
| [`docs/bootstrapping.md`](docs/bootstrapping.md) | The boot sequence, stage by stage, and what each stage learned from AIOS. |

## Rules the seed carries into every org it starts

- **Words match code (CLAIMS-1).** Every public statement is a probed sentence, a block generated from code, or an inventory checked in reverse (`doctrine/claims.json`; `python3 scripts/claims.py --check` on every change, `--fix` rewrites generated blocks, `--file` files one item per drift). A new claim is registered in the same change that makes it.
- **If it is not in code, it does not exist.** Every output of every role is a commit, an issue or a database row. Chat is never the record.
- **The fleet is the actor.** People set direction and take only identity-bound steps (money, signing, credentials only they hold, their own accounts). Each of those is a gate card, never an instruction in prose.
- **Narrow interrupt gate.** An agent stops only for a step that is irreversible and identity-bound with no reversible path. Everything else runs, is verified and reported.
- **Trust is computed, not granted.** It rises and falls with recorded outcomes per surface and action class, and widens scope only through a reviewed change to `autonomy/policy.json`.
- **Never self-review.** A different agent or model verifies each claimed result.
- **Plussing.** 20% of capacity goes to improvements, and every closed item proposes one.

## Interview and screens (no code needed)
`python3 bootstrap/interview.py --org-name "My Project"` asks plain questions with hints and numbered choices, then writes `IDEA.md` and `specs/`. The Worker serves the same interview at `/start` and three screens at `/`, `/next`, `/needs-you`. See [SCOPE.md](SCOPE.md) and [LICENSING.md](LICENSING.md).

## License

Source-available under the [Ultrastable License v1.0 (USL-1.0)](LICENSE): free for non-commercial use; commercial use needs a Commercial License. This kit is code and agent instructions only (TEMPLATE-CODE-ONLY-1); it carries no facts about any one system.
