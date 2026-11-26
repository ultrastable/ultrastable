<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/elicit: ignorance and prompted recall

US-SPEC-16. Tests: `elicit.test.js` (T16-1 to T16-9 and the rules below), `outcomes.test.js`, `derive.test.js`, `audit-step.test.js`. Outcome learning and derivation need the tables of `outcomes/migrations/`; without them, and without a `predict` port, the register behaves as the plain register.

| Requirement | Status |
|---|---|
| US-16-R01 never ask what the idea already answers (T16-1) | BUILT (`registerNeeds`, `derive_from`) |
| US-16-R02 Ask card fields, 25 words, recognition (T16-2) | BUILT (`validateCard`) |
| US-16-R03 glossary: the person's words in every card, jargon defined in the card | BUILT (`learnTerm`, `applyGlossary`, `reviewCards`) |
| US-16-R04, R16 open cap, daily cap, quiet period (T16-5) | BUILT |
| US-16-R05, R10 Not sure and timeout become the default with an assumption log entry (T16-3) | BUILT |
| US-16-R06 no default for a not-reversible, identity-bound, over-cap or private need (T16-4) | BUILT (gate card) |
| US-16-R07, R09 verbatim answer, deterministic mapping, Tell me more keeps the card | BUILT |
| US-16-R08 neutral options, default marked | BUILT |
| US-16-R11, R12, R13 provenance tags, read-back with defaults first, corrections re-run artifacts (T16-6, T16-8) | BUILT; the read-back screen is in `core/walkthrough` |
| US-16-R14 an unconfirmed read-back does not hold work | BUILT in `core/walkthrough` |
| US-16-R15 computed readiness, G1 and G2 (T16-7) | BUILT (`readiness`) |
| US-16-R17 related needs as one card sequence | BUILT (`sequence` on each card) |
| US-16-R18 no escalation when the person stops answering | BUILT (`fatigue`) |
| US-16-R19 Tell me more three times teaches the glossary | BUILT (`answer`) |
| US-16-R20 every card that would be shown is reviewed against the glossary | BUILT (`reviewCards`, `reviewAll`) |
| US-16-R21 derivation before asking: records, tool probes, cited research, every attempt logged (`elicit_derivations`), no research value without a source, exhaustion required before an ask (`require_exhaustion`) | BUILT (`derive`; tests `derive.test.js`) |
| US-16-R22 later evidence returns an answered or derived need to open | BUILT (`contradict`; tests `derive.test.js`) |
| US-16-R23 value of information logged as a prediction, scored by `core/predict`, learned from settled outcomes across projects (a learned estimate, a need derived from three agreeing answers, a held default that stops the asking) | BUILT (`predict` port, `outcomes/migrations`; tests `outcomes.test.js`) |
| US-16-R24 ignorance audit: four sweeps, default inputs (the REQUIRED fields of US-SPEC-15, the analogy list), triggers at G1, a gate and a surprise, a surprise sweep since the last audit, an independent model or the labelled rule floor | BUILT (`audit`, `audit-step.js`, `analogies.json`; tests `elicit.test.js`, `audit-step.test.js`). The live act, a model of another family answering on the server clock, is PLANNED: see below |
| US-16-R25 drafted artifacts with a provenance tag on every statement, a linter for drafts an agent wrote, A-INI-4 with revert paths | BUILT (`draft.js`; tests `derive.test.js`) |
| US-16-R26 default quiet period in the person's local time once a time zone is known; low-priority reversible needs defaulted without asking (`DEFAULT_DEFER_BELOW` 0.15, a chosen default) | BUILT (`quiet`, `nextAsks`; tests `derive.test.js`) |
| Live: red-team sweep by a model of another family on a schedule | PLANNED. Reason: a deployment must expose a model route (an Actions token with `models: read`, or a Workers AI binding). Reversible path built: `elicitAuditStep` with the route a port, the floor and one filed item (`ELICIT-AUDIT-MODEL-ROUTE`). Closing probe: `MODEL_ROUTE_PROBE` in `audit-step.js` returns more than 0 |
| Live: a research adapter that fetches public pages and returns `{ value, sources }` | PLANNED. Reason: needs network and a search service; the port, the no-source refusal and the attempt log are built with fakes. Closing probe: a need with provenance researched whose source URL answers 200 when read back |
| Section 5.3, US-16-R19 value-of-information estimates scored later like predictions | BUILT (`scoreDefaults`, `voiCalibration`; a default taken writes `ELICIT-<project>-<need>` to the prediction table) |

Ports: `db`, `now`, `config`. Owner role: portfolio-manager. Closing probe: `node --test core/elicit/elicit.test.js`.
