<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# US-SPEC-22: Self-description and the claims registry

| Field | Value |
|---|---|
| ID | US-SPEC-22 |
| Title | Self-description and the claims registry |
| Version | 0.1.0 (draft) |
| Date | 2026-11-11 |
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

## 7. Conformance tests

| Test | Pass condition |
|---|---|
| T22-1 | A claim whose probe fails is absent from the next published output and an item is filed. |
| T22-2 | A published sentence with no registry claim is rejected by the checker. |
| T22-3 | The three output forms contain the same set of claim ids. |
| T22-4 | A claim older than its freshness limit is withdrawn. |
| T22-5 | The self-model lists PLANNED and open risks. |

## 8. Reference implementation status

| Capability | Status |
|---|---|
| Claims table with probes, a product page that runs the probe live, an hourly contract, an API feed | RUNNING in the first installation (seven claims); not generalized |
| Spec status counting (BUILT, RUNNING, PLANNED) from specification tables | BUILT (`tools/spec_backlog.py`) |
| Self-model builder, claims registry, probe runner, three output forms, voice checker | BUILT (`core/describe/index.js`, `core/describe/voice-rules.json`, `core/describe/migrations/0001_describe.sql`; tests `core/describe/describe.test.js`, covering T22-1 to T22-5). Cost per merged change and pull requests merged and rejected have no claim yet |
