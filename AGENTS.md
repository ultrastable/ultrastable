# AGENTS.md

> Ultrastable is the foundation for any autonomous system.

This repository is the platform: the one place Ultrastable's code and rules are written. `seed/` is the kernel every system runs and is published to `ultrastable/seed`; tenant repositories vendor files from here. This file is all an agent loads before it starts. The standing rules stay word for word in [`agents/AGENTS.md`](agents/AGENTS.md) and are enforced by the checks they name: fetch the ones for the files you will change, and do not read that file top to bottom.

## Commands

| To | Run |
|---|---|
| see the rules for the files you will change | `python3 -m foundation agentrules --for PATH [PATH ...]` |
| read one rule in full | `python3 -m foundation agentrules --show ID` |
| list the rules, id and title | `python3 -m foundation agentrules --list` |
| run one platform test file | `python3 -m unittest discover -s tests/foundation -p "test_NAME.py"` |
| run one kernel Worker test file | `cd seed/worker && node --test test/NAME.test.js` |
| run the kernel's Python tests | `cd seed && python3 -m unittest discover -s tests` |
| regenerate the generated files | `./scripts/regen_generated.sh` |
| run what CI runs | `python3 -m foundation checksrun` |
| measure a change against the size limit | `cd seed && python3 scripts/prsize.py --range origin/main...HEAD` |
| record a lesson or a decision | `python3 -m foundation writeback record --kind lesson --title T --body B --probe grep:FILE::TEXT` |

Python 3.12 and Node 24 (`.devcontainer/devcontainer.json`). There is no install step: the code has no third-party dependency except PyYAML, which only `checksrun` imports.

## How a change moves

1. Branch from current `main`. Check that no open pull request already holds the work: `python3 -m foundation collisions --claim ID`.
2. Keep the change to one concern and inside the size limit in `seed/autonomy/prsize.json`.
3. Edit code where it is written (the table below) and change its test in the same commit.
4. Run the tests for what you touched, then `./scripts/regen_generated.sh`, then the checks that `agentrules --for` lists for your paths.
5. Record what was learned with `writeback record`. `python3 -m foundation writeback check` fails a code change that has none.
6. Push the branch and open a draft pull request from `.github/pull_request_template.md`. A change to a protected path carries a `Protected-change:` line in the body that says why.
7. Stop. The server-side lane marks the pull request ready, merges it when its checks pass, deploys it and probes the result. Do not merge, deploy or poll.

## Limits

- Refer to a secret by its binding name. Do not print, commit or paste a value.
- Protected paths are `.github/`, `seed/autonomy/`, `AGENTS.md`, `CLAUDE.md`, `LICENSE`, `SCOPE.md` and the kill switches `actions-budget.json` and `ops/halt.json` (`scripts/protected_paths.py`). Change one only when the task is about it. Do not weaken a guard or a test to get a pass.
- Loops write state, you do not: `docs/issues/`, `ops/`, `outreach/packets/`.
- Generators write generated files: `site/*-data.js`, `research/papers/`, `seed/SYSTEM.md`, `catalog-info.yaml`, `sbom.cdx.json`. Change the source and regenerate.
- `seed/` here is the source of the kernel. The `ultrastable/seed` repository and `vendor/ultrastable/` in a tenant repository are copies; change them here.
- Stop for the owner only at a step that cannot be undone and commits the owner's identity: money, a signature, their own account, deleting data that has no backup. Make it reversible first. If it cannot be, record a gate with its default in effect in `doctrine/open-loops.json` and go on with other work.
- State a refusal by a permission check with its reason. Do not route around it.

## Where things are

| Path | What |
|---|---|
| `seed/` | the kernel: Worker in `seed/worker/src`, bootstrap in `seed/bootstrap`, kit scripts in `seed/scripts`, policy in `seed/autonomy` |
| `foundation/` | platform commands, one module per `python3 -m foundation NAME` |
| `doctrine/` | the registers and config those commands read, JSON with a schema each in `doctrine/schemas/` |
| `site/`, `dashboard/` | the public site Worker and the owner console Worker |
| `workers/core/` | shared modules that tenants vendor |
| `deploy/`, `.github/workflows/` | deploy scripts and the workflows that run them |
| `tests/foundation/`, `seed/worker/test/`, `seed/tests/`, `test/` | tests |
| `instances/ultrastable/` | this system's own manifest and loop registry |

## Read when the task needs it

| File | When |
|---|---|
| [`seed/SYSTEM.md`](seed/SYSTEM.md) | what an Ultrastable system is: tick steps, boot stages and the index from each rule to its code |
| [`docs/doctrine/SYSTEM.md`](docs/doctrine/SYSTEM.md), [`docs/doctrine/VISION.md`](docs/doctrine/VISION.md) | the definition, and what the product is and is not for; before product or bootstrap work |
| [`docs/doctrine/GUIDING-DIRECTIVE.md`](docs/doctrine/GUIDING-DIRECTIVE.md) | the owner's directive on autonomy, in full |
| [`seed/autonomy/policy.json`](seed/autonomy/policy.json), [`agents/roles/`](agents/roles/) | your limits and your role |
| [`docs/PROJECT-MEMORY.md`](docs/PROJECT-MEMORY.md) | past decisions. Search it with `grep -n`; do not load it whole |

## Axioms the checks hold

> CLOSED-LOOP-AXIOM: Every loop is closed by the system itself. No step depends on a person reading, deciding, reviewing or approving, and nothing is ever assumed to be read. Every output has a code consumer (registered in doctrine/consumers.json). Every open item has an automatic owner, trigger and probe. A credential only the owner can mint becomes an automated acquisition attempt across every surface plus a staged default in effect, never a document or a card. A document, memory or note that no code consumes is not produced. Enforced by `python3 -m foundation closedloop --check` (doctrine/closed-loop.json).

> BOUNDARY-AXIOM: Inside the boundary the system creates and destroys at will, because everything inside is rebuilt from the repository (python3 -m foundation boundary --drill). Only egress crosses the boundary: credentials, money, the owner's accounts, public publishing, other people's systems. Egress keeps its gate and its staged default. Trust widens what an agent may do inside, never what it may do at egress, never harness permissions, secrets or the interrupt gate. (doctrine/boundary.json, enforced by `python3 -m foundation boundary --check`.)

> AGENT-CONSUMPTION: code is written to be read by agents as well as run. Public surfaces serve Link headers, llms.txt, an OpenAPI description, an API catalog, an MCP server card and a read-only MCP server (site/agentic.js); every endpoint has a stable operationId, errors are JSON with a machine-readable code, and no behaviour is explained only in prose. Standards and their status: doctrine/agent-standards.json (`python3 -m foundation agentstd --check`).

> TERMS-CROSSWALK: autonomous, automatic and unattended name one property (glossary `unattended`, `autonomy`): the loop runs on a clock or event on server-side infrastructure, closes itself and does not stop at an error. Say autonomous for a system, closed loop for one loop, unattended for the measure (merged work with no session driving it). Do not use never-terminating, non-terminating, hands-off, set-and-forget, or report a PR as waiting for review: a green PR merges itself (`python3 -m foundation lanewatch --check` fails when one does not). Map and avoided words: doctrine/crosswalk.json (`python3 -m foundation crosswalk --check`).

> CODE-ONLY-ORDER (Rowan, 2026-11-16): chat threads, sessions and reports are temporary and are never storage. Every decision, instruction and standing rule lives in the system itself as code the system consumes: the seed, agent instructions, doctrine and policy files, checks and loops. A rule that exists only in a thread or a report does not count. Agents decide on their own, implement, deploy to production and verify live; they never present a decision to the owner. A merged change that records a decision with no code consumer, or an agent report that hands a decision to the owner, fails a check and files a work item. Enforced by `python3 -m foundation standingorder --check` (doctrine/standing-order.json); every tenant bootstrapped from the seed inherits it.
