# Invention versus implementation versus product

Date 2026-11-10. Companion to ip/CLAIM-TO-CODE.md. Rule: only layers (a) and (b) belong in the Ultrastable repository; layer (c) never does.

## (a) INVENTION (platform-agnostic; what the claims define)

The method and its records, independent of any database, cloud or model vendor:

- A. Persona records with enumerated operations; a portfolio agent that allocates bounded focus slots by risk; program agents that rank metric-linked work first and write priority rows; an execution queue; action records with prior value (claims 1-14).
- B. Plus loop: product register, reserved improvement share, one additive change with a prediction, baseline at verified deploy, keep or revert with a guard measure (15-23).
- C. Earned autonomy: stored predictions, scored; trust ledger per surface and action class; ladder selecting the execution path (24-32).
- D. Self-amending governance: signature register, recurrence to proposal, replay, versioned adoption inside protected limits (33-36).
- E. Change path: fenced claims, two-family review with verbatim evidence, code-made hold, deploy lock, probe-triggered revert (37-40).
- F. Organization kit (46). G. Bootstrapping from an idea file and a seed (47-52, 57). H. Autonomy policy as data with a gate and a harness consistency test (53-56).
- Dependents 41-45: dual heartbeat, silent-drop reopen, owner-card queue, kill switch, model ladder.

## (b) REFERENCE IMPLEMENTATIONS (replaceable; show the invention works)

| Implementation | Where | Covers |
|---|---|---|
| Cloudflare Worker plus D1 (SQL views, triggers, `fleet_tasks`, deploy-guard worker, Python CI scripts) | platform/cloudflare-reference (16 verbatim files, PROVENANCE.md); the rest of qnfo-workers by refactor | A, B, C, E, parts of D and H as live code |
| Python plus SQLite engine | platform/core/ultrastable (engine.py, orgchart.py, store.py) | A and B simplified, C, D `amend`, H ladder |
| Seed worker (D1 tick) and bootstrapper | seed/worker/src/tick.js, seed/bootstrap/bootstrap.py, seed/autonomy/policy.json | G, H validator and consistency test (seed/tests/test_seed.py:19), ceilings |
| GCP and Postgres adapters | platform/adapters/gcp, platform/core/ultrastable/pg_store.py | portability evidence |

## (c) QNFO / QUNIVERSE PRODUCTS AND PROGRAMS (customer zero; must never ship here)

Research pipeline (qnfo-research-exec, idea-hub, radar-hub, papers, Zenodo publication, paper reviser), reach and outreach (qnfo-social, qnfo-email, qnfo-subscribers, qnfo-lifecycle, qnfo-youtube-shorts, outreach contacts), IP and PDF tools (qnfo-ipatent, qnfo-pdf), gateway and search apps, and the whole personal plane (personal-api, personal-companion, personal-watch, q08-*, qnfo-jobsearch, qnfo-companion-guard; D1 `personal-life`). Also the owner directives text in CLAUDE.md, program charters, product rows and metric names.

## QNFO-specific strings that leak into core files (parameterise before sharing)

Ranked by risk:

1. **D1 database UUIDs**: `35e2e573-92f3-46ac-83c6-22f6429fc5e5` (qnfo-audit) in canary_revert.py:74, review_gate.py:579/596/608, apply_migrations.py:51, deploy_probes.py:684/686; living-paper `70a58cb3-b2cd-498d-877f-ecca86859a22` apply_migrations.py:51; personal-life `e8d6c61a-10b7-4086-b81e-9e6e85afa407` in scripts/remediation_consumer.py:180 (personal plane; file not copied). Account id `edb167b78c9fb901ea5bca3ce58ccc4b` in AGENTS.md, CLAUDE.md and wrangler files.
2. **Hosts and planes**: deploy_probes.py:53-57 (`.qnfo.org`, `q08.org`, `q08.workers.dev`, `qwav.*`, private DB names `qnfo-identity`, `qnfo-outreach`, `personal-life`); canary_revert.py:67; deploy-guard worker.js:3, 16, 17, 129, 158, 285, 531 (`ops.qnfo.org`, `fleet.qnfo.org`).
3. **Repository and owner names**: default `QNFO/qnfo-workers` (canary_revert.py:320, review_gate.py:908, claim_reaper.py:25, worker_release.py:64); owner name and personal site in product/boundary.json (`creator`), docs/PRODUCT-ULTRASTABLE.md, CITATION.cff and the patent memos.
4. **QNFO worker and database names** as identifiers in core scripts: 52 lines in canary_revert.py, 44 in deploy-guard worker.js, 35 in deploy_probes.py, 26 in review_gate.py (control-plane worker list, `qnfo-audit`, `qnfo-ops`).
5. **Seed data in migrations**: QNFO programs (management-personas.sql 212-259), products (plussing-1.sql 53-60), metrics (kernel-registries.sql 278-312), trusted issue sources (fleet-control worker.js:3474).
6. Tenant constants named in boundary.json phase P3 (account, repository, hosts, model ladder, owner contact): the fix is designed and still open.
