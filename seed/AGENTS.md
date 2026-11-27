# AGENTS.md

> Ultrastable is the foundation for any autonomous system.

This repository is one Ultrastable system, started from the kernel. The owner wrote [`IDEA.md`](IDEA.md); everything else is the system's work. This file is all an agent loads before it starts. The standing rules stay word for word in [`agents/AGENTS.md`](agents/AGENTS.md) and are enforced by the checks they name: fetch the ones for the files you will change, and do not read that file top to bottom.

## Commands

| To | Run |
|---|---|
| see the rules for the files you will change | `python3 scripts/agentrules.py --for PATH [PATH ...]` |
| read one rule in full | `python3 scripts/agentrules.py --show ID` |
| list the rules, id and title | `python3 scripts/agentrules.py --list` |
| check the system against its own definition | `python3 scripts/system.py --check` |
| run one Worker test file | `cd worker && node --test test/NAME.test.js` |
| run the Python tests | `python3 -m unittest discover -s tests` |
| boot or re-boot the system (idempotent) | `python3 bootstrap/bootstrap.py` |
| measure a change against the size limit | `python3 scripts/prsize.py --range origin/main...HEAD` |

Python 3.12 and Node 24 (`.devcontainer/devcontainer.json`). There is no install step.

## How a change moves

1. Branch from current `main`, one concern per change, inside the size limit in `autonomy/prsize.json`.
2. Change the code and its test in the same commit, and run the tests for what you touched.
3. Run the checks that `agentrules.py --for` lists for your paths, and `python3 scripts/system.py --check`.
4. Push the branch and open a draft pull request with a `## Handoff` block (`item:`, `agent:`, `verify:`, `deploy:`).
5. Stop. The system's own Worker merges the pull request when its checks pass, deploys it and probes the result. Do not merge, deploy or poll.

## Limits

- Refer to a secret by its binding name. Do not print, commit or paste a value.
- Protected paths are `.github/`, `autonomy/`, `AGENTS.md`, `CLAUDE.md` and `LICENSE`. Change one only when the task is about it. Do not weaken a guard or a test to get a pass.
- The kernel arrives from the platform by `.github/workflows/platform-sync.yml`. A fix to kernel code (`worker/src`, `scripts`, `bootstrap`, `doctrine`, `agents`) belongs in `ultrastable/ultrastable` under `seed/`; this system's own files are `IDEA.md`, `README.md`, `org/` and its content.
- `SYSTEM.md` and `doctrine/CONSTITUTION.md` are generated. Change the code or `doctrine/constitution.json` and run `python3 scripts/system.py --write` or `python3 scripts/constitution.py --render`.
- Stop for the owner only at a step that cannot be undone and commits the owner's identity: money, a signature, their own account, deleting data that has no backup. Make it reversible first. If it cannot be, record one gate card with its default in effect and go on with other work.

## Read when the task needs it

| File | When |
|---|---|
| [`SYSTEM.md`](SYSTEM.md) | what an Ultrastable system is: tick steps, boot stages and the index from each rule to its code |
| [`doctrine/CONSTITUTION.md`](doctrine/CONSTITUTION.md) | essential variables, the ladder, criticality and each rule's detector and remediation |
| [`doctrine/SYSTEM.md`](doctrine/SYSTEM.md), [`doctrine/VISION.md`](doctrine/VISION.md) | the definition, and what the product is and is not for |
| [`doctrine/GUIDING-DIRECTIVE.md`](doctrine/GUIDING-DIRECTIVE.md) | the owner's directive on autonomy, in full |
| [`autonomy/policy.json`](autonomy/policy.json), [`agents/roles/`](agents/roles/) | your limits and your role |

## Axioms the checks hold

> CONSTITUTION-1: what an ultrastable system is, how it runs, bootstraps, becomes autonomous and reaches criticality is in [`doctrine/CONSTITUTION.md`](doctrine/CONSTITUTION.md), generated from `doctrine/constitution.json`, which the system reads at boot (stage `constitute`) and checks with `python3 scripts/constitution.py --check`. A standing rule with no detector and remediation in code fails that check. Nobody supplies this by chat.

> CLOSED-LOOP-AXIOM: Every loop is closed by the system itself. No step depends on a person reading, deciding, reviewing or approving, and nothing is ever assumed to be read. Every output has a code consumer (registered in doctrine/consumers.json). Every open item has an automatic owner, trigger and probe. A credential only the owner can mint becomes an automated acquisition attempt across every surface plus a staged default in effect, never a document or a card. A document, memory or note that no code consumes is not produced. Enforced by `python3 -m foundation closedloop --check` (doctrine/closed-loop.json).

> BOUNDARY-AXIOM: Inside the boundary the system creates and destroys at will, because everything inside is rebuilt from the repository (python3 -m foundation boundary --drill). Only egress crosses the boundary: credentials, money, the owner's accounts, public publishing, other people's systems. Egress keeps its gate and its staged default. Trust widens what an agent may do inside, never what it may do at egress, never harness permissions, secrets or the interrupt gate. (doctrine/boundary.json, enforced by `python3 -m foundation boundary --check`.)

> AGENT-CONSUMPTION: code is written to be read by agents as well as run. Public surfaces serve Link headers, llms.txt, an OpenAPI description, an API catalog, an MCP server card and a read-only MCP server (site/agentic.js); every endpoint has a stable operationId, errors are JSON with a machine-readable code, and no behaviour is explained only in prose. Standards and their status: doctrine/agent-standards.json (`python3 -m foundation agentstd --check`).

> TERMS-CROSSWALK: autonomous, automatic and unattended name one property (glossary `unattended`, `autonomy`): the loop runs on a clock or event on server-side infrastructure, closes itself and does not stop at an error. Say autonomous for a system, closed loop for one loop, unattended for the measure (merged work with no session driving it). Do not use never-terminating, non-terminating, hands-off, set-and-forget, or report a PR as waiting for review: a green PR merges itself (`python3 -m foundation lanewatch --check` fails when one does not). Map and avoided words: doctrine/crosswalk.json (`python3 -m foundation crosswalk --check`).

> CODE-ONLY-ORDER (Rowan, 2026-11-16): chat threads, sessions and reports are temporary and are never storage. Every decision, instruction and standing rule lives in the system itself as code the system consumes: the seed, agent instructions, doctrine and policy files, checks and loops. A rule that exists only in a thread or a report does not count. Agents decide on their own, implement, deploy to production and verify live; they never present a decision to the owner. A merged change that records a decision with no code consumer, or an agent report that hands a decision to the owner, fails a check and files a work item. Enforced by `python3 -m foundation standingorder --check` (doctrine/standing-order.json); every tenant bootstrapped from the seed inherits it.
