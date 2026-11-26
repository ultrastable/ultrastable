<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# US-SPEC-22: Self-description and the claims registry

| Field | Value |
|---|---|
| ID | US-SPEC-22 |
| Title | Self-description and the claims registry |
| Version | 0.2.0 (draft) |
| Date | 2026-11-26 |
| Status | Draft |

## 1. Purpose

How does the system see itself and describe itself? Outreach, marketing and branding all start there. If an organization describes itself in words that are not tied to what its records show, every pack that communicates will drift into exaggeration. This specification makes self-description a core capability: the organization generates a description of itself from its own records, and **every factual statement in it is backed by a probe that can be re-run**.

## 2. Terms

| Term | Definition |
|---|---|
| Self-model | A structured snapshot of what the organization is and does, built only from its records. |
| Claim | One factual statement about the organization, with an id, text, a probe and a freshness limit. |
| Probe | A read-only check (a query over records, a file check, an HTTP check) that returns pass, fail or unknown with evidence. |
| Claims registry | The table of claims and their last probe results. |
| Voice | Short rules for tone and wording, set by the person's answers and the charter. |

## 3. The self-model

Built each period by the describe loop from records only:

| Section | Source |
|---|---|
| Purpose | Charter and idea record (A-INI-1, A-INI-2), in the person's words |
| Capabilities | Specification status tables and passing tests (BUILT, RUNNING, PLANNED counts and names) |
| Scope | `SCOPE.md` and enabled packs (what it does and does not do) |
| Operation | Tick health, last check, uptime from tick records |
| Performance | Predictions scored, cost per merged change, autonomy rungs, pull requests merged and rejected |
| Packs | Enabled packs, their charters and guard metrics |
| Limits | Open risks and unknowns, honest `PLANNED` list |

## 4. Requirements

| ID | Requirement |
|---|---|
| US-22-R01 | Every factual statement in a published description MUST be a claim with a probe. A statement without a probe MUST NOT be published as fact. |
| US-22-R02 | A claim whose probe fails, is unknown, or is stale beyond its freshness limit MUST be withdrawn from public output automatically, and a repair item filed. |
| US-22-R03 | The self-model MUST include limits and PLANNED items alongside capabilities, in equal prominence. |
| US-22-R04 | Descriptions MUST be produced in at least three forms from one self-model: a short statement (one paragraph), a full page, and a machine-readable form (JSON and a plain-text file for AI systems). |
| US-22-R05 | Every pack that communicates MUST take its facts from the claims registry, not from free generation. Free text may choose wording; it MUST NOT introduce a claim not in the registry. |
| US-22-R06 | Numbers MUST come from probes and MUST carry their date. Estimates MUST be labeled as estimates. |
| US-22-R07 | The voice rules MUST be data, versioned, and applied by a checker that a different agent from the writer runs. |
| US-22-R08 | The describe loop MUST NOT mention out-of-scope outputs as things the organization does (`SCOPE.md`), unless the corresponding pack is enabled. |
| US-22-R09 | The describe loop MUST write only to the organization's own repository and records (class A). Publishing the result to any channel is the job of a pack and passes the outbound guard. |
| US-22-R10 | A count, list or schedule in a published description MUST be written by a generator from the code or data it describes, and the check MUST fail when the published value is stale. It MUST NOT be typed by hand. (Added in 0.2.0.) |
| US-22-R11 | The registry MUST also be checked in the reverse direction: each member of a set read from code (routes, tools, workflows) MUST be described on a surface or carry a written exemption. Shipped behaviour that no surface describes is a finding. (Added in 0.2.0.) |
| US-22-R12 | A probe that cannot run MUST be reported as unmeasured and MUST NOT count as passed; a live surface that cannot be fetched is drift. (Added in 0.2.0.) |
| US-22-R13 | A system that serves pages MUST serve its statements in machine-readable form at a fixed path, each with the page that shows it and the endpoint that backs it, and its own tests MUST read them front to back (every statement's endpoint answers) and back to front (every public endpoint is named by a statement or listed as internal with a reason). (Added in 0.2.0.) |

## 5. Claims registry

| Column | Meaning |
|---|---|
| `id` | Stable id |
| `text` | The statement |
| `probe` | Probe kind and argument (for example `sql:<read-only query>`, `file:<path>`, `http:<url>`, `spec:<id>`) |
| `expect` | The condition that makes it true |
| `max_age_hours` | Freshness limit |
| `last_result`, `last_checked_at`, `evidence` | Latest outcome |
| `public` | Whether the claim may be published |

Each period a probe runner re-checks every public claim; the registry is the source of the public page and of the claims feed.

## 6. Failure modes

| Failure | Control |
|---|---|
| Marketing copy outruns the product | R01, R02, R05 |
| A true claim goes stale | Freshness limit and automatic withdrawal |
| The description hides the unbuilt parts | R03 |
| A writer agent grades its own copy | R07 |
| Out-of-scope claims creep in | R08 |
| A typed number goes stale while its sentence still reads true | R10 |
| A capability ships and no surface says so | R11, R13 |
| A probe that could not run is read as a pass | R12 |

## 7. Conformance tests

| Test | Pass condition |
|---|---|
| T22-1 | A claim whose probe fails is absent from the next published output and an item is filed. |
| T22-2 | A published sentence with no registry claim is rejected by the checker. |
| T22-3 | The three output forms contain the same set of claim ids. |
| T22-4 | A claim older than its freshness limit is withdrawn. |
| T22-5 | The self-model lists PLANNED and open risks. |
| T22-6 | A generated number that no longer equals its source is reported as drift, and the fix command rewrites it. |
| T22-7 | A page that is served and described nowhere is reported. |
| T22-8 | A live probe that cannot reach its surface is reported as drift, not as a pass. |
| T22-9 | A statement whose endpoint is gone fails, and so does a public endpoint no statement names. |

## 8. Reference implementation status

| Capability | Status |
|---|---|
| Claims table with probes, a product page that runs the probe live, an hourly contract, an API feed | RUNNING in the first installation (seven claims); not generalized |
| Spec status counting (BUILT, RUNNING, PLANNED) from specification tables | BUILT (`tools/spec_backlog.py`; test `tests/test_spec_backlog.py`; both in the `workers/` tree) |
| Self-model builder, claims registry, probe runner, three output forms, voice checker | BUILT (`core/describe/index.js`, `core/describe/voice-rules.json`, `core/describe/migrations/0001_describe.sql`; tests `core/describe/describe.test.js`, covering T22-1 to T22-5). Cost per merged change and pull requests merged and rejected have no claim yet |
| Platform claims registry: literal sentences bound to probes, generated blocks, the reverse inventory, generated modules bound as a whole, unmeasured probes never passed (R01, R06, R10, R11, R12; T22-6, T22-7, T22-8) | BUILT (`foundation/claims.py` over `doctrine/claims.json`, paths from the repository root; test `tests/foundation/test_claims.py`). A drift fails the change and `--file` files one `Q-CLAIM-*` item for it; that is how R02 is met on the platform: a false statement is stopped before it is published and is not withdrawn after. The daily live read is `.github/workflows/claims.yml` |
| Numbers, cadences and guarantees on public surfaces need a registered claim (R01, R06) | BUILT (`foundation/claimcode.py` over `doctrine/claim-code.json`, with a shrink-only baseline; test `tests/foundation/test_claimcode.py`) |
| The checker in every seeded system | BUILT (`seed/scripts/claims.py` over `seed/doctrine/claims.json`; test `seed/tests/test_claims.py`) |
| Statements served by every system with their page and endpoint, verified in both directions (R13, T22-9) | BUILT (`seed/worker/src/contract.js`: `/claims.json`, `/.well-known/ultrastable.json` and `verify()`; test `seed/worker/test/contract.test.js`) |
| Tenant pages rendered from statements that carry a probe; unbound prose refused (R01, T22-2) | BUILT (`core/statements/index.js`; test `core/statements/statements.test.js`; in the `workers/` tree) |
| Withdrawal of a published claim by freshness limit on the platform registry (R02, T22-4 outside `core/describe`) | PLANNED: `doctrine/claims.json` carries no `max_age_hours`; staleness is caught by re-running every probe on each change and each day, not by a per-claim age |
