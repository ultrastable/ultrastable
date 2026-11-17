<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# US-SPEC-21: Capability packs, boundaries and the outbound guard

| Field | Value |
|---|---|
| ID | US-SPEC-21 |
| Title | Capability packs, boundaries and the outbound guard |
| Version | 0.1.0 (draft) |
| Date | 2026-11-11 |
| Status | Draft |

## 1. Purpose

A fully autonomous organization does more than write code. It communicates, publishes, sends mail, posts to social networks, makes video, reads analytics, runs cloud accounts. No coding agent does that for a person, and the first installation of this design (a research fleet) does all of it. These capabilities are valuable and they are **not the core**. This specification defines how they are added without distorting the core: as **packs**, each a set of agents and code loops with its own manager, charter, scope, caps and kill switch, and all outbound action passing through one guard.

The core mission is unchanged (`SCOPE.md`): turn what a non-expert says they want into a managed, verified, working system. Packs extend what the system can *do for itself and for the person around that system*, never what it is.

## 2. Three tiers of boundary

| Tier | Meaning | Examples | Default | Maximum autonomy |
|---|---|---|---|---|
| **Core** | The product | Elicitation, specifications, charters, lifecycle, code loops, deploy, console, trust, caps | On | Earned per surface (US-SPEC-06) |
| **Pack** | Optional capability loops, enabled by the person | Email and subscribers, social posting, video, analytics and search presence, cloud-account operations, self-description publishing | Off | Per pack class below |
| **Out of bounds** | Never, as core or as pack | Section 3 | Refused | None |

### 2.1 Pack classes (how far a pack may be pushed)

| Class | Nature | Ceiling |
|---|---|---|
| **A: internal** | Reads and writes only the organization's own records and repositories (documentation, analytics reading, report writing) | May earn full autonomy through the trust ledger |
| **B: outward reach** | Contacts or publishes to people or the public (email, social, video, site publishing) | Every action passes the outbound guard. Autonomy ceiling is `approve-by-exception`: after earned trust the pack may act alone within caps, and a person can always veto, throttle or stop it. Never above caps. |
| **C: professional drafts** | Produces material that normally needs a licensed professional (business plan, trademark or technical-description draft, legal or tax text) | **Draft only.** Output is marked as a draft for professional review. The pack MUST NOT file, sign, submit or send it. |
| **D: platform operations** | Operates cloud or provider accounts through their APIs (creating resources, changing DNS, deploying) | Goes through `core/deploy` and its probes, revert and loop breaker; secrets only by presence; spending only inside the router and caps |

## 3. Out of bounds (no pack may do these)

These follow the License's prohibited uses (Section 8) and the interrupt gate (US-SPEC-06).

1. Moving money, buying, trading, or entering payment details.
2. Signing, filing or submitting a legal instrument or government form for a person.
3. Contacting a person who has not consented to that kind of contact, or ignoring an unsubscribe, a suppression entry or a platform's rule.
4. Impersonating a person or an organization, or posting as a person without their standing authorization for that channel.
5. Disinformation, coordinated inauthentic behavior, or manipulating vulnerable people.
6. Surveillance or profiling of individuals.
7. Circumventing a platform's access controls, rate limits or terms, or a CAPTCHA.
8. Disabling or bypassing the outbound guard, the caps, a kill switch, or the interrupt gate.
9. Entering or storing another person's credentials.

A pack that needs any of these is refused at load (Section 5), not at runtime.

## 4. Pack structure

A pack is a directory with a manifest `pack.json` and code.

| Manifest field | Rule |
|---|---|
| `id`, `name`, `version`, `class` (`A`-`D`) | Required. `id` is lower-case, unique. |
| `scope` | `does` and `does_not` lists in plain words. `does_not` MUST include every Section 3 item that is adjacent to the pack. |
| `charter` | `objective`, `primary_metric`, `guard_metrics` (US-SPEC-15 A-INI-2). A pack has a manager role seeded from this charter. |
| `requires` | `ports` (for example `email`, `social`, `video`, `fetch`), `secrets` (names only), `specs` it conforms to. |
| `loops` | List of code loops: `id`, `every_ticks`, `entry` (module and export), `outbound` (true if it can act outside the organization). Each loop is a tick step wrapped by the host (guarded, time-limited, counted). |
| `outbound` | If any loop is outbound: `channels`, `caps` (per day and per week per channel), `consent` mode, `suppression: true`, `approval` default. |
| `migrations` | Own tables, prefixed with the pack id. |
| `enable_gate` | The plain-words card the person sees to enable the pack, including what it will do, what it will not do, what it costs and how to stop it. |

## 5. Normative requirements

| ID | Requirement |
|---|---|
| US-21-R01 | A pack MUST be OFF until a person enables it. Enabling MUST be a recorded decision (who, when, the card text shown) and reversible by one disable action. |
| US-21-R02 | The host MUST validate a manifest at load. A manifest missing a required field, with a class-C pack that has an outbound loop, or naming a Section 3 behavior, MUST be refused. |
| US-21-R03 | The core MUST NOT import a pack. Packs reach the core only through its published interfaces (store handle, router, claims, kernel records, the outbound guard). |
| US-21-R04 | Each enabled pack MUST have a manager role and charter in the kernel records (US-SPEC-15), a primary metric and at least one guard metric, and its own improvement (plus) items inside the shared plus-share (US-SPEC-04). |
| US-21-R05 | Each pack loop MUST run as a guarded tick step: a failure files its own item and does not stop other steps. |
| US-21-R06 | Every outbound action MUST pass `guard.send` (Section 6). A pack MUST NOT hold a path that delivers outside the organization without it. |
| US-21-R07 | Each pack MUST have an independent kill switch. A tripped switch stops that pack's loops within one tick and leaves the others running. |
| US-21-R08 | A pack MUST NOT change the core's scope, `SCOPE.md`, the autonomy policy, or another pack's records. |
| US-21-R09 | A pack's secrets MUST be read by presence only. A value MUST NOT be stored, logged or placed in model context. |
| US-21-R10 | Packs MUST be independently testable with fake ports and no network. |
| US-21-R11 | A pack's code MUST NOT contain tenant-specific names, hosts or accounts; they come from configuration. |
| US-21-R12 | A pack's autonomy MUST NOT exceed the ceiling of its class (Section 2.1), regardless of trust earned. |

## 6. The outbound guard

One function, the only door out. `guard.send({pack, channel, kind, recipient, content, idempotencyKey})` returns `sent`, `queued_for_approval`, `refused` with a reason.

| Check (in order) | Refuse or queue when |
|---|---|
| Pack enabled | Pack is off |
| Kill switches | Global, pack or channel switch is on |
| Class rules | Class C (never sends); class D action not routed through deploy |
| Idempotency | The same key was already sent (no duplicates after a retry) |
| Suppression | The recipient or channel handle is on the suppression list, always including unsubscribes and bounces |
| Consent | The channel requires consent (`double_opt_in` for email lists) and no confirmed consent record exists |
| Caps | Per-day or per-week cap for the channel is reached |
| Content rules | Content empty, over the channel limit, contains a secret pattern, or carries no honest sender identification where the channel requires one |
| Approval | The pack's current autonomy rung is below `act` for this action class: queue as a decision card for a person. At or above, proceed. |
| Deliver | Call the channel port; record the provider's response |

Every call writes one row to `guard_ledger` (pack, channel, kind, recipient hash, content hash, decision, reason, provider id, time). Recipients are stored hashed where the purpose allows. The ledger is the source of the pack's guard metrics (sends, refusals, bounces, unsubscribes).

**US-21-R13.** Unsubscribe and suppression MUST be honored immediately and MUST NOT depend on a person's approval.

**US-21-R14.** The guard MUST be the same code for every pack and every platform.

## 7. Packs the first installation proves

| Pack | Class | What it does | Source of knowledge |
|---|---|---|---|
| `email` | B | Subscribe with double opt-in, confirm, unsubscribe, send newsletters and notices through a mail provider port, bounce and complaint handling | Email and subscriber workers of the first installation |
| `social` | B | Compose posts from the organization's own records, check them, queue and post through a social port (Bluesky AT Protocol; a Buffer-style scheduler), link tagging, weekly cap, pause switch | Social worker of the first installation, Buffer API work |
| `video` | B | Compose and publish short video to a video platform through a port, with provenance | Video worker of the first installation |
| `analytics` | A | Read search and site analytics and feed metrics | Analytics work |
| `cloud` | D | Operate provider accounts (Cloudflare, Google Cloud) through the deploy module | Cloud operations work |
| `drafts` | C | Business plan, technical-description and legal drafts marked for professional review | Plan and document tooling |
| `describe` | A | Core feature, not a pack: the organization describes itself (US-SPEC-22) | |

## 8. Packs are code loops

Each pack is a set of agents and loops in the same sense as the core: a loop reads records, decides, acts through a port, verifies, records an outcome, predicts and scores itself, and files improvement items. This is what makes the organization autonomous at the edges as well as in the middle. A pack that posts, for example, predicts its own engagement, is scored on it, and its manager reallocates effort from the evidence.

## 9. Failure modes

| Failure | Control |
|---|---|
| Spam or harassment by an autonomous loop | Guard: consent, suppression, caps, approval, kill switch |
| Pack distorts the product | Core never imports packs; scope statement; scope test (`SCOPE.md`) |
| Brand or voice drift | The describe loop's claims registry (US-SPEC-22) and the guard's content rules |
| A pack's key leaks | Presence-only secrets; no secret in model context |
| Pack outlives its usefulness | Primary metric and guard metrics; kernel loop breaker replaces remedies that do not move the metric |
| Class C pack files something | Class-C refusal in manifest validation and in the guard |

## 10. Conformance tests

| Test | Pass condition |
|---|---|
| T21-1 | A pack is inert until enabled; enabling records who, when, and the card text; disabling stops all its loops. |
| T21-2 | A manifest naming an out-of-bounds behavior, or a class-C pack with an outbound loop, is refused at load. |
| T21-3 | A pack's outbound action with no consent, on the suppression list, over cap, or duplicated is not delivered, and the ledger records why. |
| T21-4 | At rung below `act`, an outbound action is queued as a decision card and not sent. |
| T21-5 | Tripping one pack's kill switch stops that pack and no other. |
| T21-6 | A pack step that throws files an item and the tick completes. |
| T21-7 | No pack module is imported by core code (static check). |
| T21-8 | A secret value never appears in any pack table, ledger or log. |

## 11. Reference implementation status

| Capability | Status |
|---|---|
| Bootstrap plans out-of-scope cases only for enabled packs | BUILT (`bootstrap/cases.py`; tests) |
| Email, subscriber, social, video, and analytics workers | RUNNING in the first installation; not generalized |
| Manifest validation, pack registry, enable gate, pack steps, kill switches, outbound guard | BUILT (`core/packs/manifest.js`, `core/packs/index.js`, `core/packs/guard.js`, `core/packs/sandbox.js`, `core/packs/static-check.js`; tests `core/packs/packs.test.js`, `core/packs/sandbox.test.js`, `core/packs/loader.test.js`, covering T21-1 to T21-7). Class D sends go through `core/deploy/packs-route.js` |
| `email`, `social`, `video`, `cloud`, `drafts` packs (and `analytics`) | BUILT (`packs/email/pack.json`, `packs/social/pack.json`, `packs/video/pack.json`, `packs/cloud/pack.json`, `packs/drafts/pack.json`, `packs/analytics/pack.json`; tests `packs/email/email.test.js`, `packs/social/social.test.js`, `packs/video/video.test.js`, `packs/cloud/cloud.test.js`, `packs/drafts/drafts.test.js`, `packs/analytics/analytics.test.js`), each tested with fake ports and no network. No pack has sent through a live provider from this code: that needs the person's provider credential and their enable decision |
