---
consumer: doctrine/ship-plan.json
---
# SHIP-PLAN-1: what the resumed specification run shipped, and what it did not

Read from the run's own journal (stored privately in ultrastable/ops under `wip/session-2026-11-26/workflow/`) and from `main` on 2026-11-26.
This file is the marker of the ship-plan entry `workflow-output`; `python3 -m foundation shipplan --check` reads it.

## The run

Workflow `ultrastable-specs-implement-v2` (run wf_63903503-466): 102 agents. Per phase, agents that returned a result out of agents started:

| Phase | Returned | Not returned |
|---|---|---|
| Audit | 11 of 11 | none |
| Coverage | 1 of 1 | none |
| Implement | 11 of 11 | none |
| New specs | 23 of 30 | the re-verifiers of US-SPEC-26, 27, 29, 30, 31, 32 and 33 |
| Verify | 22 of 22 | none |
| Fix | 13 of 23 | the re-verifiers of clusters A, D, E, F, G, H, I, J and K, and fix round 2 of cluster C |
| Integrate | 0 of 1 | the integrator |
| Final gate | 0 of 3 | clean copy, specification critic, diff review |

The agents that did not return were refused by the account's weekly usage limit, not by a finding.

## Shipped

The run's code shipped as bounded pull requests, each built on the latest `main` from the private bundle, checked with the repository's own suites before it was pushed and merged by the server lane:

| Slice | What | PR |
|---|---|---|
| W01 | storage adapters, core test helpers, claims, console-l3 and deploy | #2530 |
| W02 | describe, doors, elicit, fleet and walkthrough | #2544 |
| W03 | ghcost, governance, graph, ignorance, install and kernel | #2575 |
| PK | the capability packs, with their channels, manifests and probes | #2576 |
| W04 | ladder and modelport | #2581 |
| W05 | predict, remediation, router and signals | #2583 |
| W06 | sla, specloop, staff, tenantstore and trust | #2585 |
| W07 | console and elicit | #2586 |
| BS | the bootstrapper, its ladder and the owner document | #2587 |
| W08 | adapters and launcher | #2588 |
| W09 | workers tools, gaplint and loop closer | #2593 |
| WI | steward, principles enforcement and GitHub pull helpers | #2594 |
| SW+FX | the seed tests and the fixes they prove | #2595 |
| FT | the foundation's specification-citing tests | #2600 |
| WK | the workers' ratchets and specification-citing tests | #2605 |
| RC+WD1 | the round-one fixes the early slices merged without, the REST pull-request reader | #2606 |
| INT1 | integration round 1: the build-out modules wired into `core/org`, the small module defects closed | #2607 |

The final specification text went to the private repository in four batches (ultrastable/ops #50, #52, #53, #54), and the code stack that was not yet shipped was kept there as a bundle (#55) until every slice above had merged.

## Round 2: reconcile, review, land

Workflow `ultrastable-specs-implement-v2` round 2 (run wf_6f3e33cc-1e2): 35 agents, 0 errors. Eleven clusters reconciled requirement ids, retitled tests, fixed the round-one review findings and brought each status line up to the code. An integrator applied the integration requests, and a final gate (clean-copy CI reproduction, specification critic, diff review) read the integrated change.

The landing run (wf_89b4c77d-2e2, 9 agents, 0 errors) carried the integrated change onto a `main` that had moved 80 commits, resolved 19 conflicts (keeping `main`'s newer behaviour), fixed every finding of the gate, re-verified independently and split the result into ten bounded slices.

| Slice | What | PR |
|---|---|---|
| R3-1 | requirement-id forms, reuse report, protected-change reasons; two fixes found on `main` while shipping (the JavaScript substance classifier list, the invented-number test) | #2815 |
| R3-2 | tick Worker holds, criticality ratio, health fields and the seed spec tests | #2819 |
| R3-3 | bootstrap policy guard, runtime manifest, dashboard connection status, test citations | #2825 |
| R3-4 | tenant store statement classes, vector port, migration apply, export classifier | #2827 |
| R3-5 | sandboxed hosted packs, egress guard, fleet stagger skips, adapter migrations 0081 and 0082 | #2828 |
| R3-6 | text-form vendoring, install, self-start, release verification | #2829 |
| R3-7 | console and tick routes, launcher bundle, platform adapters | #2830 |
| R3-8 | claims, elicit, vault (key held outside the database, bound to its name), sla, walkthrough | #2838 |
| R3-9 | ladder, kernel, predict, trust and the other modules citing their requirements | #2839 |
| R3-10 | hits window, owner-action wording, foundation spec tests, the bootstrap stage assertion | #2843 |

The corrected private text of all 35 specifications went to the private repository as one batch (ultrastable/ops #58).

Checked after landing: every file of the round-two tree is on `main`, or is a generator-owned file `main` regenerates, a write-back shard `main` folded into its decision ledger, or a file `main` changed since (44 of 357 differ; 0 lost). One section was dropped on purpose: the round-two integration list in `docs/PROJECT-MEMORY.md`, because each slice carries its own memory entry.

Main-side defects found and fixed on the way: the JavaScript substance classifier lacked `spinoffs/registry.js` (#2815), and the invented-number test used a figure that had become a measured value (#2815). One CI run on #2828 was stopped by the actions budget and the GitHub rate limit, and cleared on one re-run.
