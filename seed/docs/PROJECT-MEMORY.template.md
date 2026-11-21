<!-- Template: a new system copies this to docs/PROJECT-MEMORY.md and fills the {placeholders} from IDEA.md. It carries no facts about any one system (TEMPLATE-CODE-ONLY-1, checked by the template check in the main repository). -->
# Project memory (canonical)

This file is the single source of truth for project memory. Chat memory, tool memory and platform memory stores are read-only pointers to this file and are never edited as a record. Every session starts by reading this file and ends by updating it. Nothing is done until it is deployed end to end; every open item is an issue or an owner card with a default in effect and a closing probe.

Last updated: {date}
Maintained by: every agent, on every session end. Staleness is checked by `scripts/check_memory.py` (CI `memory-fresh`).

## 1. Standing rules (from {owner})

1. **If it is not in code, it does not exist.** The repository is canonical for code, files, plans, issues, tasks, agents and instructions. Local files, thread output and chat or platform memory are ephemeral.
2. **No open loops.** Work ends in completion, not handoff: deployed end to end, verified, recorded. An item leaves the active set only as done, superseded, cancelled, or blocked with owner, blocker and closing probe.
3. **Autonomy first.** Agents act, verify and report as done. They do not ask questions the record can answer. Pauses only at steps both irreversible and identity-bound, after engineering reversibility.
4. **Facts are checked at the source** before being stated.
5. **Memory lives in the repo** (this file). See `agents/AGENTS.md` section 1.

## 2. Facts from {owner}

- {fact from IDEA.md, one per line}

## 3. Current status ({date})

- {what is live, with the probe that shows it}

## 4. Owner-only items (identity-bound; each has a default in effect)

| Item | Default in effect | Closing probe |
|---|---|---|
| {credential, money, signature or account step} | {what runs meanwhile} | {probe} |

## 5. Workstream map

| Workstream | Where |
|---|---|
| Idea and first outcomes | `IDEA.md` |
| Org config, roles, budget | `ultrastable.json`, `autonomy/policy.json` |
| Agent rules | `agents/AGENTS.md`, `agents/roles/` |
| Running system | `worker/` |
| Objectives and metrics | `org/objectives.json` |

## 6. Update protocol

Update this file in the same PR as any change to status, rules, facts, owner items or workstreams, and at the end of every session. Bump "Last updated". `scripts/check_memory.py` fails the `memory-fresh` workflow when merged work has outrun this file.
