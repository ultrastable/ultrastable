---
consumer: doctrine/decision-ledger.json
---
# KERNEL-1: a kernel that deploys and updates, modules that change on their own, and state that is not code

Owner directive (Rowan, 2026-11-26): changing thousands of files in one change is unsustainable. Find the kernel that can be deployed, updated and
changed; split the rest; maintain it all autonomously; keep every piece of work already done.

## What was measured (2026-11-26)

| Reading | Value |
|---|---|
| Tracked files in `ultrastable/ultrastable` | 4,553 |
| Of them, queue items stored as files (`docs/issues`) | 1,241 |
| Of the last 300 commits on `main`, written by loops or bots | 273 |
| `workers/core` modules, of which carry their own README and tests | 82, of which 64 |
| Merge of two sessions' work on the same Worker files | 6 failing tests and one drill, found only by running the suites |

The size is not the defect. The defect is that code, loop-written state and two sessions' concurrent changes share one tree, one history and one
test run, so no change is small and no change is independent.

## The decision: three kinds of thing, three homes

| Kind | Home | Changes | Updated by |
|---|---|---|---|
| Kernel: the tick Worker core (tick, migrations, budget and halt, ignition, criticality, claims, reconcile), `bootstrap/`, defaults, `modules.lock` | `ultrastable/seed`, the template | rarely; semver; contract-tested | a release |
| Modules: each `workers/core/<name>` (a package with its own README, migrations and tests), grouped by owner into about ten repositories along the audit clusters | one repository per group, each with its own version, CI and conformance slice | independently | a one-line bump of its pin in `modules.lock` (version and hash), through the composition root that already exists (`core/org/modules.js`) |
| State: queue items, ledgers, generated data, instance data, everything a loop writes | D1 and the private ledger in `ultrastable/ops`; never git history of the code | every tick | the loops |

The platform itself (site, dashboard, deploy, the `foundation` checks) is the company's own deployment: it consumes the kernel and the modules by
lock like any tenant, so Ultrastable still runs on Ultrastable. The specification and the company papers stay private (DISCLOSE-1).

## How it is maintained with no person

Repository shape is an essential variable of the system (ASHBY-1, `doctrine/ultrastability.json`), read by the second loop like cost or uptime:
`repo_files`, `pr_files_p95`, `loop_commit_share`, `time_to_green_p95`, each with a limit set from its first reading, never guessed. A breach files
its own split item.

- One change touches one module. The lane bounds a pull request by files and by modules; the executor splits one that is over the bound.
- A module release is a lock bump the lane opens in each consumer, canaries on a tick, and merges or reverts (the HANDOFF-1 path that already deploys).
- Each module's conformance slice and the kernel's contract tests run in that repository; a module cannot merge a change the kernel contract refuses.
- Each module has one owning manager (MANAGERS-1), who is the only writer of its repository.

## Order, with nothing deleted

1. State out of git (the largest and safest part: about a quarter of the files and nine in ten commits).
2. Modules, group by group, with full history (`git subtree split`); the monorepo stays the source of record until a group's repository is.
3. The kernel slimmed (Q-DISCLOSE-seed-slim): the seed carries what a deploy needs and the generated rules index.

The work already done stays: the code of this session ships as the last large change, the specification is held privately, and every file is kept.
Probe: `python3 -m foundation reposhape --report` reads the numbers above from the tree.

## What REPO-SHAPE-1 (#2444) already built, and what is left

The shape work was built on `main` by a parallel session while this was written, and the built version prevails. `foundation/reposhape.py` and
`doctrine/repo-shape.json` classify every tracked path (kernel, platform, docs, assets, state), `--check` fails an unclaimed top-level path, `--report`
reads files and bytes per class, `--probe state` is the closing probe of `Q-SHAPE-state-out-of-git`, and `--split BASE...HEAD` writes the in-budget
stack that carries an oversize branch (the size is gated once, by SMALL-CHANGE-1). Three items drafted here are therefore superseded with that evidence
and are not filed: classification and the state budget (`Q-SHAPE-state-out-of-git`), the shape reading, and the pull request bound (`--split` plus
SMALL-CHANGE-1). What is left and is filed is `Q-KERNEL-modules`: modules ship by version and pin, each from its own repository, which REPO-SHAPE-1
does not cover (its areas stay `mode: here`).
