<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/elicit: ignorance and prompted recall

US-SPEC-16. Tests: `elicit.test.js` (T16-1 to T16-9 and the rules below), `outcomes.test.js`, `derive.test.js`, `audit-step.test.js`, `duties-step.test.js`, `research.test.js`, `default-prediction.test.js`. Outcome learning and derivation need the tables of `outcomes/migrations/`; without them, and without a `predict` port, the register behaves as the plain register.

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
| US-16-R19 a default in effect is a prediction that it holds, scored on the person's answer, a correction or its review time; calibration unmeasured, never zero, with nothing scored | BUILT (`predictDefault`, `scoreDefaults`, `voiCalibration`; the kernel scorer reads `elicit_default_holds` through `elicitMetrics`, which the composition root passes to its tick by default, and `elicitDutiesStep` rewrites rows in the older shape and files `ELICIT-DEFAULT-METRIC` while the tick has no reader; tests `elicit.test.js`, `default-prediction.test.js`, `duties-step.test.js`) |
| US-16-R20 to R22 untold facts, inverted questions on a clock, the blind-spot register | Not in this module: `../foundation/ignorance.py`, `../foundation/unknowns.py` with `../seed/worker/src/unknowns.js`, `../foundation/blindspots.py` |
| US-16-R23 gap registry with dispositions and balanced accounting, model challenge refused from the author's family | Not in this module: `core/ignorance` |
| US-16-R24 ignorance audit: four sweeps, default inputs (the REQUIRED fields of US-SPEC-15, the analogy list), triggers at G1, a gate and a surprise, a surprise sweep since the last audit, an independent model or the labelled rule floor | BUILT (`audit`, `audit-step.js`, `analogies.json`; tests `elicit.test.js`, `audit-step.test.js`). The live act, a model of another family answering on the server clock, is PLANNED: see below |
| US-16-R25 drafted artifacts with a provenance tag on every statement, a linter for drafts an agent wrote, A-INI-4 with revert paths | BUILT (`draft.js`; tests `derive.test.js`) |
| US-16-R26 default quiet period in the person's local time once a time zone is known; low-priority reversible needs defaulted without asking (`DEFAULT_DEFER_BELOW` 0.15, a chosen default) | BUILT (`quiet`, `nextAsks`; tests `derive.test.js`) |
| US-16-R27 cited research through a fetch port (`createResearch`: https pages a need declares, redirects not followed, 200 only, one unambiguous value, sources that disagree say nothing) and a verifier that reads the cited pages again once a day (200 hit, 404 or 410 reopens the need, any other outcome changes nothing) | BUILT against a fake fetch (`research.js`; tests `research.test.js`) |
| US-16-R28 Tell me more explains with the card's why and cue and keeps the card; three presses teach the glossary | BUILT (`answer`) |
| US-16-R29 every card that would be shown is reviewed against the glossary on the tick, one item per leaking card, closed when the card is clean and reopened if it leaks again | BUILT (`reviewCards`, `reviewAll`, `elicitDutiesStep`) |
| US-16-R30 derivation before asking: records, tool probes, cited research, every attempt logged (`elicit_derivations`), no research value without a source, exhaustion required before an ask (`require_exhaustion`), on the tick at most once a day per need | BUILT (`derive`; tests `derive.test.js`, `duties-step.test.js`) |
| US-16-R31 later evidence returns an answered or derived need to open | BUILT (`contradict`; tests `derive.test.js`) |
| US-16-R32 value of information logged as a prediction, scored by `core/predict`, learned from settled outcomes across projects (a learned estimate, a need derived from three agreeing answers, a held default that stops the asking) | BUILT (`predict` port, `outcomes/migrations`; tests `outcomes.test.js`) |
| US-16-R10, R27, R29, R30 the tick duties: expiry across every project, the card review, derivation through the host's ports, reading researched sources again | BUILT as `elicitDutiesStep` (`duties-step.js`; tests `duties-step.test.js`), run on the organization's tick with `elicitAuditStep` (`core/org/buildout.js`; test `core/org/wiring.test.js`) |
| Live: red-team sweep by a model of another family on a schedule | PLANNED. Reason: a deployment must expose a model route (an Actions token with `models: read`, or a Workers AI binding). Reversible path built: `elicitAuditStep` with the route a port, the floor and one filed item (`ELICIT-AUDIT-MODEL-ROUTE`). Closing probe: `MODEL_ROUTE_PROBE` in `audit-step.js` returns more than 0 |
| Live: research against real pages | PLANNED. Reason: needs network access; the adapter, the no-source refusal, the attempt log and the verifier are built with fakes. Closing probe: `RESEARCH_PROBE` in `research.js` returns more than 0 |

Ports: `db`, `now`, `config`. Owner role: portfolio-manager. Closing probe: `node --test core/elicit/elicit.test.js`.
