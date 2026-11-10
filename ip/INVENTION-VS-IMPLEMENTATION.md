# Invention versus implementation versus QNFO products

Basis: qnfo-workers HEAD `3eef0c5` and this repo. Row-level evidence is in ip/CLAIM-TO-CODE.md. Not legal advice; the claims are the attorney's.

## Layer (a): the INVENTION (platform-agnostic, what the claims cover)

Methods and records, independent of any cloud:

- Management hierarchy: persona records with enumerated operations, a portfolio agent allocating bounded focus slots by risk, program agents writing priority rows, an execution queue, action records with prior value (family A).
- Plus loop: product register, reserved improvement share, one additive change with a prediction, baseline at verified deploy, keep or revert with a guard measure (B).
- Earned autonomy: stored predictions, trust ledger per surface and action class, ladder selecting the execution path (C).
- Self-amending governance: signature register, replayed proposals, versioned adoption under protected limits (D).
- Change path: fenced claims, two-family review with verbatim evidence, deploy lock, probe-triggered revert (E).
- Organization kit and bootstrapping from an idea and seed (F, G); autonomy policy as data with a deny-list consistency test (H).

Where it lives in this repo: ip/ (claims, specification, evidence), the policy and ledger schemas in seed/ and platform/core. Nothing in this layer names Cloudflare, D1, QNFO or any model vendor.

## Layer (b): REFERENCE IMPLEMENTATIONS (replaceable)

| Implementation | Where | Status vs claims |
|---|---|---|
| Python and SQLite | platform/core/ultrastable (engine.py, orgchart.py, store.py) | simplified: no risk formula, no metric-tier ranking, no action log with prior value, no fences or review gate |
| Cloudflare Worker and D1 tick | seed/worker (src/tick.js, migrations) | single heartbeat, ceilings and promotion rules, no dual scheduler |
| GCP / Postgres adapter | platform/adapters/gcp, platform/core pg_store.py | storage adapter only |
| Cloudflare production reference (extracted from qnfo-workers) | platform/cloudflare-reference (see PROVENANCE.md) | the only layer that implements most of A, B, C, E live; it is SQL views, triggers and `fleet_tasks` data plus deploy-path scripts and the deploy-guard worker |

Most of the live implementation is SQL stored in migrations, not JavaScript. Extracting the monolithic kernels (qnfo-fleet-control, qnfo-fleet-dashboard) is a refactor, listed in CLAIM-TO-CODE.md with function anchors.

## Layer (c): QNFO / QUNIVERSE PRODUCTS AND PROGRAMS (must never ship in the Ultrastable repo)

These run on the platform as customer zero and are not the invention:

- Research pipeline and publications: qnfo-research-exec, paper-hub family, Zenodo flows, qnfo-pdf, qnfo-ipatent, ideas hub (idea-hub), radar-hub, qnfo-ai-search, qnfo-gateway.
- Outreach and reach: qnfo-social, qnfo-email, qnfo-subscribers, qnfo-lifecycle, qnfo-youtube-shorts, outreach caps and suppression data (the private `qnfo-outreach` and `qnfo-identity` databases).
- Personal plane (never copied anywhere): personal-api, personal-companion, personal-watch, q08-mind, q08-prediction-markets, q08-signal-engine, qnfo-jobsearch, qnfo-companion-guard, the `personal-life` database.
- QNFO programs, charters, products and metrics as data: program codes (QNFO.OPS, QNFO.INFRA, QNFO.REACH, QNFO.RSCH, QNFO.PERSONAL), the product seed rows in migrations/2026-10-29-plussing-1.sql lines 53-59, metric keys seeded in kernel-registries.sql, owner directives and doctrine text overlays.
- Customer-zero numbers (spec [0079]) are self-reported; keep as examples only.

## QNFO-specific strings that leak into core files (parameterise before sharing)

Source: scans of platform/cloudflare-reference (line numbers in its PROVENANCE.md) and repo-clone core.

| Leak | Where | Parameterise as |
|---|---|---|
| Hard-coded D1 database UUID of the `qnfo-audit` database (35e2e573-92f3-46ac-83c6-22f6429fc5e5) | scripts/canary_revert.py:74; scripts/review_gate.py:579, 596, 608; scripts/apply_migrations.py:51 (also the `living-paper` UUID); scripts/deploy_probes.py:684, 686 (test fixture); a Worker version id at deploy_probes.py:854 | tenant config `audit_db_id` and `audit_db_name`; resolve by name at run time |
| Fleet hostnames and private-database names: qnfo.org, q08.org, q08.workers.dev, qwav.* ; `qnfo-identity`, `qnfo-outreach`, `personal-life` | scripts/deploy_probes.py:53-57 (HOST_SUFFIXES, HOST_EXACT, PRIVATE_DATABASES); scripts/canary_revert.py:67 (`HEALTH_URL = https://{worker}.q08.workers.dev/health`); scripts/remediation_consumer.py:120-188 (not copied; also holds the `personal-life` D1 id) | `allowed_hosts`, `health_url_template`, `private_databases` in tenant config |
| Repository default `QNFO/qnfo-workers` (and `lower(repo) LIKE 'qnfo/%'`) | scripts/canary_revert.py:320, 366; claim_reaper.py:25; review_gate.py:908; worker_release.py:64 (hard-coded `gh api repos/QNFO/qnfo-workers/...`) | `GITHUB_REPOSITORY` only, no default |
| QNFO worker names and the control-plane worker list (qnfo-ops, qnfo-deploy-guard, qnfo-fleet-control, qnfo-audit binding) | canary_revert.py (52 lines), deploy_probes.py (35), deploy-guard worker.js (44), review_gate.py (26), all copied migrations | `control_plane_workers` list and `audit_binding` in tenant config |
| Account ID | not hard-coded: read from `CLOUDFLARE_ACCOUNT_ID` (apply_migrations.py:1664); account `edb167b7...` appears only in the doctrine files outside the platform code. No hits for it in repo-clone core | keep as environment only |
| Owner and creator names (rwnq8, Rowan Brad Quni-Gudzinas) | repo-clone: platform/core/tests/test_config.py, seed/docs/aios-lessons.md, seed/docs/PROJECT-MEMORY.template.md, seed/scripts/check_memory.py; creator block in qnfo-workers product/boundary.json | tenant `principal` field; keep inventorship statements only in ip/ |
| QNFO programs and product rows seeded inside schema migrations | management-personas.sql (programs, personas), plussing-1.sql:53-59, kernel-registries.sql (metric keys, surfaces) | split each file into schema and a tenant seed file |

Top three, in order: (1) the hard-coded D1 UUID, (2) the host and private-database allow-lists, (3) QNFO product and program seed rows mixed into schema migrations.
