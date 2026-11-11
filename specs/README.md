# Ultrastable architectural specifications

**Ultrastable is the foundation for any autonomous system.**

These specifications replace the patent track. They describe how Ultrastable works precisely enough for another team, human or agent, to build a conforming system, and they are licensed under the [Ultrastable Hybrid License](../LICENSE): free to read and build on non-commercially, a Commercial License for anything that makes or saves money (LICENSE 3.2(f)).

Status 2026-11-11: working drafts, reviewed by no outside party. Not legal advice. Derived from the earlier patent drafts, now archived in [`ip/`](../ip/README.md); numbers for sections of those drafts are cited as "archive §n" for depth only. The specs make no claims language and no patent statements.

## How to read
Each spec has the same parts: purpose, concepts, records, procedure, invariants, reference implementation (code paths), conformance, status. Words: MUST, SHOULD, MAY. Status words: RUNNING (in QNFO production), BUILT (code and tests here), PLANNED.

| # | Spec | One line |
|---|---|---|
| 00 | [Scope and boundaries](00-scope.md) | What this is, what it will not become, how scope changes |
| 01 | [Architecture and portability](01-architecture.md) | Portable core, seams, Cloudflare first, Google Cloud second |
| 02 | [Organization and roles](02-organization-and-roles.md) | Virtual managers and staff, enumerated operations |
| 03 | [Work, tick and claims](03-work-tick-claims.md) | The heartbeat, work items, claims, no silent drops |
| 04 | [Predict, verify, trust](04-predict-verify-trust.md) | Predictions, outcomes, trust ledger, ladder, interrupt gate |
| 05 | [Plussing](05-plussing.md) | Protected improvement capacity |
| 06 | [Governance and self-amendment](06-governance-and-amendment.md) | Doctrine as data, recognitions, reviewed amendment |
| 07 | [Change path](07-change-path.md) | Branch, review, deploy, probe, revert |
| 08 | [Bootstrapping for people who do not know what to ask](08-bootstrapping.md) | Idea to specifications to running system |
| 09 | [Interface](09-interface.md) | Three bite-sized screens, guided choices, front end is back end |
| 10 | [Project management lifecycle](10-project-management-lifecycle.md) | Portfolio, program, product, project; agile and traditional |
| 11 | [Models and routing](11-models-and-routing.md) | Model ladder, different-family review, cost caps |
| 12 | [Conformance and traceability](12-conformance.md) | What a conforming system passes; spec to code to test |

Changes to a spec are a reviewed PR; changes to 00 also need the owner (it is the scope gate).
