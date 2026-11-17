<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# US-SPEC-18: Guided console

| Field | Value |
|---|---|
| ID | US-SPEC-18 |
| Title | Guided console |
| Version | 0.1.0 (draft) |
| Date | 2026-11-11 |
| Status | Draft |

## 1. Purpose

Two kinds of tool fail the intended user. Site and app builders are friendly but boxed in: what they cannot do, you cannot do. Coding agents are open-ended but assume you can open a command line and know what to ask. The intended user can state what they want, has used a search box and a chat prompt, and does not know what to ask for. The console sits between: **buttons first, prompt second, three small screens, no code, no looking under the hood.**

The console is a *view and a set of actions over the organization's records*, not a platform. It does not limit what the system can build; the system can build anything the specifications and scope allow. The console only decides what a person is shown and what they can press.

## 2. Principles

| ID | Principle |
|---|---|
| US-18-R01 | **The front end is the back end.** Every action in the console MUST write the same record a manager or agent would write (an item, a gate-card resolution, a recorded answer). Nothing exists only as UI state. |
| US-18-R02 | **Buttons first.** Every screen MUST be usable with no typing. The person is never required to know what to type. |
| US-18-R03 | **Prompt second.** A free-text box MUST be available on every screen. Whatever is typed MUST be stored verbatim (US-SPEC-16 R07) and become a work item for a manager, or a held scope-gate entry if it falls outside `SCOPE.md`. |
| US-18-R04 | **Suggestions, not blank boxes.** The prompt box MUST be accompanied by at most three suggested requests drawn from the current state. |
| US-18-R05 | **Bite-sized.** Three screens. At most three items per list. A fourth item is summarized as "and N more". One headline sentence states the overall state. |
| US-18-R06 | **Plain words.** All text MUST use the person's vocabulary (US-SPEC-16 R03). No identifiers, no internal role jargon in headlines or buttons. |
| US-18-R07 | **One safe default per decision.** A decision card MUST show what happens if the person does nothing. |
| US-18-R08 | **Open outputs.** The console MUST NOT be the only way to reach the data. Everything the person owns is available as files or records through the same interface an agent uses (Section 7). |
| US-18-R09 | **Default-deny access.** With no access secret configured the console MUST be off. State-changing requests MUST be same-origin only. The console MUST NOT set a secret or credential on the person's behalf; such steps are shown as cards that close when the step is observed done. |
| US-18-R10 | **No third-party requests.** The page MUST NOT load scripts, fonts or images from other hosts. Dynamic text MUST be inserted as text, never as markup. |

## 3. The three screens

| Screen | Question it answers | Content |
|---|---|---|
| **Now** | "Where are things?" | Headline; three numbers (open, done, stuck); up to three things being worked on; up to three stuck things with the reason |
| **Needs you** | "What does the system need from me?" | Up to three decision cards; each: what, what happens by default, buttons |
| **Progress** | "Is it working?" | Up to five recently finished things; how many of the system's own predictions were right; up to three places it now acts on its own |

Headline rule: if the last check did not finish, the headline says so first; else if any card is open, it counts them; else it says nothing needs the person.

## 4. Decision cards and buttons

| Card kind | Buttons | Effect |
|---|---|---|
| Manual step (a person can confirm it) | "I did it", "Use the default", "What does this mean?" | `done` or `default` closes the gate card and records the press; `explain` returns plain text |
| Secret or cloud step (the person must act outside the console) | "What does this mean?" only | Closes itself when the probe sees the step done (US-SPEC-06) |
| Elicitation Ask (US-SPEC-16) | The Ask's options, "Not sure", "Tell me more" | Answer is stored verbatim and mapped to a record change |

A button never performs an irreversible, identity-bound act. Those remain cards that only the person can complete outside the console.

## 5. First run: the walkthrough

The first screen a new person sees is a walkthrough, generated from the needs register (US-SPEC-16), not a fixed wizard. It differs for each person because their needs differ.

| Step | What happens |
|---|---|
| 1 | One question: "What do you want to exist, and for whom?" Free text, with an example. Stored as the idea record (A-INI-1). |
| 2 | The system derives what it can, then asks the highest-value Needs, one card at a time, with options and defaults (US-SPEC-16 5.1). |
| 3 | Setup steps that only the person can do (an account, a key) appear as cards with plain instructions; the rest of the setup proceeds without waiting. |
| 4 | The read-back (US-SPEC-16 R12): the written specification restated in the person's words, defaults first. |
| 5 | The console opens on Now. |

**US-18-R11.** The walkthrough MUST be resumable and MUST NOT block on any one card; unanswered cards fall back to defaults after their time (US-SPEC-16 R10).

**US-18-R12.** The walkthrough MUST end with the person seeing something that works (a live page, a running demo, or a clear statement of exactly what runs and what does not yet).

## 6. Per-person composition

The three screens are the default composition. A profile (a data file in the organization's record, set from walkthrough answers) MAY change: which metrics the person sees, the level of detail ("brief" or "more"), the language, the check cadence, and extra cards a program defines. A profile MUST NOT remove the Needs-you screen, hide an open decision card, or weaken US-18-R05 to R10.

## 7. One interface for people and agents

The console's data and actions are a small HTTP interface. It is the same interface a coding agent or script uses.

| Operation | Method and path | Notes |
|---|---|---|
| Read the three screens as data | `GET /api/console` | JSON |
| Resolve a decision card | `POST /api/console/card` `{id, choice}` | `choice`: `done`, `default`, `explain` |
| Submit a request in words | `POST /api/console/ask` `{text}` | Stored verbatim; becomes an item or a held scope-gate entry |

People who are comfortable with code may use an agent against the same records and the same interface. Neither route is privileged; both are logged.

## 8. Portability

The console is a function from a request and a store handle (US-SPEC-14) to a response. It uses only standard web request and response objects and the store's four operations. It therefore runs unchanged on any platform that can host a web handler and a store: Cloudflare Workers with D1, Google Cloud Run with a SQLite or SQL store, a self-hosted server. Production deployments SHOULD place an identity-aware proxy (for example Cloudflare Access or Google Identity-Aware Proxy) in front of it and treat the console's own access key as the inner lock.

## 9. Failure modes

| Failure | Control |
|---|---|
| Dashboard sprawl: too many numbers | R05; a fourth list item becomes a count |
| The prompt box becomes the only way in | R02 |
| A button hides an irreversible act | Section 4 last paragraph; R09 |
| Person's words rewritten before storage | R03 verbatim storage |
| Scope creep through the prompt | Out-of-scope requests held (`SCOPE.md`; US-SPEC-15 R12) |
| Console leaks to a stranger | R09 default-deny, same-origin writes, no third-party requests, identity-aware proxy |
| Lock-in to the console | R08 |

## 10. Conformance tests

| Test | Pass condition |
|---|---|
| T18-1 | With no access secret configured, every console path returns "off" and no data. |
| T18-2 | A wrong key is refused; a cross-origin or origin-less write is refused. |
| T18-3 | Each list on each screen holds at most three items; extras appear as a count. |
| T18-4 | Pressing "I did it" closes a manual card and writes an action record; the same press on a secret card changes nothing and explains. |
| T18-5 | Typed text is stored verbatim; an out-of-scope request creates a held item and no dispatchable work. |
| T18-6 | `GET /api/console` returns the same facts the Now screen shows. |
| T18-7 | The same handler passes T18-1 to T18-6 on two different platform adapters. |

## 11. Reference implementation status


| Capability | Status |
|---|---|
| Three-screen console, decision-card buttons, typed requests with scope hold, default-deny access, same-origin writes, no third-party requests | BUILT (`core/src/console.js`, `core/src/console-ui.js`, `core/migrations/0002_console.sql`; 4 tests in `core/test/console.test.js`; R02, R03, R04 and R08 cited in `core/walkthrough/console-rules.test.js`) |
| Same handler on Google Cloud Run | BUILT (`adapters/gcp/server.js`; 1 test). Not deployed on Google Cloud. |
| Console fleet view in QNFO (operator console with queue, decisions, prompted-recall questions) | RUNNING in QNFO; not generalized |
| Walkthrough generated from the needs register (steps 1 to 5, resumable from the records, never blocked on one card, ending with what runs and what does not yet: R11, R12) | BUILT as a module (`core/walkthrough/index.js`, `core/walkthrough/catalog.json`; tests in `core/walkthrough/walkthrough.test.js`) |
| Elicitation Ask cards as decision cards with the options, "Not sure" and "Tell me more"; each press stored verbatim and written as a record | BUILT (`core/walkthrough/index.js`, `core/walkthrough/walkthrough.test.js`) |
| Read-back screen: defaults first, each statement correctable by a button, a correction re-runs the affected artifact, an unconfirmed read-back does not hold work | BUILT (`core/walkthrough/index.js`, `core/walkthrough/walkthrough.test.js`) |
| Per-person profile (metrics shown, detail, language, cadence, extra cards) set from walkthrough answers, refused when it would remove the Needs-you screen, hide a decision card or lengthen a list | BUILT (`core/walkthrough/index.js`, `core/walkthrough/walkthrough.test.js`) |
| Walkthrough, Ask cards and profile inside the served console page | PLANNED: the module exports its routes and the composed screens, and `core/src/console.js` and the page script in `core/src/console-ui.js` do not call them yet; text is English only |
| Identity-aware proxy deployment guide | BUILT as data that code runs (`core/doors/proxy-guide.json`, `core/doors/proxy.js`; tests in `core/doors/proxy.test.js`): each step names the check that observes it done, a step the person must do is a decision card that closes when observed, and the signed headers of Cloudflare Access and Google Identity-Aware Proxy are verified |
| A deployment behind a real identity-aware proxy; the console accepting the Google header as a sign-in | PLANNED: the first needs a live account; for the second the verification is built and the console calls only the Cloudflare Access check today |
