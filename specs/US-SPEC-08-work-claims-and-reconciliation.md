<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# US-SPEC-08: Work items, work claims and reconciliation

| Field | Value |
|---|---|
| ID | US-SPEC-08 |
| Title | Work items, work claims and reconciliation |
| Version | 0.1.0 (draft) |
| Date | 2026-11-11 |
| Status | Draft |

## 1. Purpose

Many agents (and people) act on the same organization at once. Work claims keep two of them from doing the same work or overwriting each other. Reconciliation ensures no work item leaves the active set without a recorded reason. The principal queue holds the few steps only a person can take.

## 2. Terms

| Term | Definition |
|---|---|
| Work item | A record with identifier, title, owner role, trigger, done check, closing probe, priority, status, disposition. |
| Trigger | Identifiers of other items (or a named gate) that must be done first. |
| Work claim | An exclusive, time-limited hold on an item or a path. |
| Token | An opaque value proving the holder. |
| Fence | A monotonic integer per path, increased on each grant; a write presents the current fence. |
| Reaper | The process releasing expired claims. |
| Principal queue | The set of open gate cards. |
| WBS code | Optional dotted identifier `<portfolio>.<program>.<project>.<phase>[.<task>]`. |
| Doer | The step that works a claimed item in the tick that dispatched it. |
| Parked | Status `blocked` with a blocker that names why and what closes it. |
| Loop-breaker | The rule that stops dispatching an item after repeated dispatches with no outcome. |

## 3. Item state machine

```mermaid
stateDiagram-v2
  [*] --> Backlog: 2102 created
  Backlog --> Ready: 2104 triggers all done
  Backlog --> Blocked: 2116 a trigger not done
  Blocked --> Ready: 2122 trigger completes
  Ready --> InProgress: 2108 claimed
  InProgress --> Ready: claim expires
  InProgress --> PrincipalQueue: 2120 next step identity-bound
  InProgress --> Review: 2110 doer asserts done with evidence
  Review --> InProgress: 2112 closing probe fails (rework+1)
  Review --> Done: 2114 closing probe passes, evidence stored
  Backlog --> Superseded: 2118
  Blocked --> Cancelled: 2118
  PrincipalQueue --> InProgress: probe sees principal's step
  Done --> [*]
```

An item leaves the active set only as `done`, `superseded` or `cancelled`, each with a disposition. A rework count at or above a threshold (default 3) escalates as a root-cause item. On Done, items naming this identifier as a trigger are re-evaluated. A reviewer is a different executor from the doer and, where two families exist, a different model family.

## 4. Work claims

```mermaid
sequenceDiagram
  participant A as Agent
  participant L as Claim service
  participant R as Resource
  A->>L: 1002 request claim(path, intent, holder)
  alt live claim held by another
    L-->>A: 1006 refuse (review theirs or take next item)
  else free
    L-->>A: 1008 token, expiry (default 2h), fence = previous+1
  end
  A->>R: 1010 write(token, fence); heartbeat renews
  R->>R: 1012 accept only live token and current fence
  A->>L: 1016 release(outcome)
  L->>L: reaper releases expired; metric counts orphans (target 0)
```

A holder paused past its expiry cannot overwrite the next holder's work, because its fence is stale (step 1014). Secret operations take a separate lease. A global kill switch makes the claim service refuse new claims, renewals, deploy leases and secret leases (US-SPEC-09).

**Seed form.** Claims are per item: `claims(item_id PK, agent, claimed_at, heartbeat_at)`. The tick's reaper deletes claims whose heartbeat is older than the time-to-live (default 120 minutes) and returns the item to `ready`. A runtime claims, releases and counts only its own tenant's rows (US-01-R12), so another tenant's claims do not use up a role's work-in-progress cap.

### 4.1 The doer (seed)

In the seed the `execute` step runs right after `dispatch`, on the server, and ends every claimed item in one of four states, each with an outcome row as evidence. Rules run first and need no model; a model is asked only to file successor items and to triage items no rule covers, under a cap on calls per tick (5 by default, over at most 16 items).

| State | Meaning | Claim |
|---|---|---|
| done | The done check was verified here: a later tick completed the failed step, a loop-breaker target has a doer again, the closing probe (one read-only query) returned more than 0, or a successor was filed. Outcome `verified`. | Released |
| parked | Status `blocked` with a blocker that names why and what closes it: owner-only (identity-bound, behind one gate card), probe-gated (closes when its probe is green), needs a reviewed change to the policy file, or the model's triage verdict with a first step. Outcome `parked`. | Released |
| superseded | The same failure is tracked by a newer item, or the target no longer exists. Outcome `superseded`. | Released |
| waiting | No doer can act this tick (no model available for an item only a model can triage). | Kept; it expires by the time-to-live |

Owner-only items are matched by rule on the title and done check and parked behind the single card `GATE-OWNER-ITEMS`, whose probe closes it when no owner-only item is left parked; they are never dispatched again. Parked items whose check the tick can read are re-verified every tick and close without a new dispatch. The dispatch row records the model that answered or `rules (no model)`.

### 4.2 Loop-breaker and age (seed)

An item dispatched a configured number of times (default 3) with no outcome is set `blocked` with the blocker `loop-breaker: dispatched <n> times with no outcome`, its claim is deleted, a `failed` outcome is recorded and `LOOPBREAK-<id>` is filed for operations at priority 0. When the doer works the `LOOPBREAK` item it returns the target to `ready` and closes the loop-breaker with that evidence.

An item `open` or `ready` for more than 120 minutes is raised to priority 5 unless it is already more urgent, and one `AGE-120M-<date>` item a day asks operations for the cause. The count of claims the reaper released unworked in 24 hours is a metric with target zero, shown on the health route.

## 5. Reconciliation

Each tick compares the active set with the previous tick and with the records of each consuming loop. An item that left the active set without a disposition (done with evidence, remediated, or backlogged with a trigger and closing probe) is recorded as a silent-drop incident and reopened. For each loop run the accounting invariant holds: `scanned = executed + failed + needs_human + no_action`; a gap above zero opens an incident, reopens the unaccounted items and blocks closure of their parents. Where several stores hold issues, a visibility ratio (open items in all stores divided by open items visible to operations tools) fires above a threshold (default 2).

## 6. Principal queue

A step routed to the principal is checked for an identity-bound line. A card without one is rerouted to the staff; the step is executed by them. A card with one is held with its default and closing probe, and closes automatically when the probe observes the step done. The number of open cards without an identity-bound line is a metric with target zero.

## 7. Normative requirements

- **US-08-R01 [L1]** At most one live claim MUST exist per item.
- **US-08-R02 [L1]** A claim MUST expire without a heartbeat within a configured time-to-live, and the reaper MUST return the item to `ready`.
- **US-08-R03 [L1]** An item whose trigger is not done MUST NOT be dispatched.
- **US-08-R04 [L1]** An item MUST NOT leave the active set without a disposition. Reconcile MUST reopen it and record a `silent_drop` outcome.
- **US-08-R05 [L1]** A gate card MUST close itself when its closing probe passes.
- **US-08-R06 [L1]** A holder MUST renew its claim by heartbeat while working.
- **US-08-R07 [L2]** A path-level claim MUST carry a token, an expiry and a fence equal to the previous fence for the path plus one.
- **US-08-R08 [L2]** A protected resource MUST accept a write only for the live token and current fence.
- **US-08-R09 [L2]** An agent facing a live claim by another holder MUST NOT duplicate the work; it MAY review the claimed change or take the next item.
- **US-08-R10 [L2]** Every queue pull SHOULD be recorded with puller, item and route.
- **US-08-R11 [L2]** Each consuming loop MUST report scanned and per-bucket counts per run; reconcile MUST test the accounting invariant and open an incident on a gap.
- **US-08-R12 [L2]** An item with rework count at or above a threshold MUST escalate as a root-cause item.
- **US-08-R13 [L2]** The number of orphaned claims MUST be a metric with target zero.
- **US-08-R14 [L2]** An interrupt-eligible step MUST leave the doer path and become one gate card.
- **US-08-R15 [L3]** Side effects crossing the claim boundary SHOULD carry idempotency keys.
- **US-08-R16 [L1]** Where the tick works its own dispatches, every claimed item MUST end the tick done, parked with a blocker that names what closes it, superseded with evidence, or waiting with its claim kept, and each of the first three MUST write an outcome row. A parked or done item MUST release its claim.
- **US-08-R17 [L1]** An item open or ready beyond an age bound (default 120 minutes) MUST be raised in priority and the cause MUST be filed as one item per day. No item ages silently.
- **US-08-R18 [L1]** An item dispatched a bounded number of times (default 3) with no outcome MUST be blocked and replaced at the head of the queue by one item that asks for a different approach.
- **US-08-R19 [L1]** The number of claims released unworked by the reaper in 24 hours MUST be a metric with target zero.
- **US-08-R20 [L1]** Identity-bound items the doer recognizes MUST be parked behind one gate card for all of them and MUST NOT be dispatched again; the card MUST close itself when none is left parked.

## 8. Failure modes

| Failure | Effect | Mitigation |
|---|---|---|
| Executor reports "scanned 25, executed 0, failed 0, ..." | 25 items unaccounted (observed in QNFO) | Accounting invariant |
| Detect, dispatch once, never verify, re-detect | Endless loop with no repair | Closing probe; reconcile |
| Holder pauses past expiry | Overwrites next holder | Fence (R08) |
| Seed claims lack fence and token | A stalled holder that wakes could still write | PLANNED path-level claims |
| Orphaned claim | Item stuck | Reaper (R02) and metric (R13) |
| Dispatch writes a claim and nothing acts on it | The reaper releases it and it is claimed again, with no outcome ever (observed in the seed: 288 dispatches, 0 outcomes) | In-tick doer (R16), loop-breaker (R18), released-unworked metric (R19) |
| An item sits ready for hours | Silent aging | Age bound (R17) |
| A waiting claim outlives its time-to-live | Released and dispatched again | Intended: the loop-breaker then changes the approach (R18) |

## 9. Conformance tests

- **US-08-T01** Insert two claims for one item. Pass: second rejected.
- **US-08-T02** Make a claim 3 hours old with TTL 120 minutes, run a tick. Pass: claim deleted, item `ready`.
- **US-08-T03** Mark an item `done` with no disposition. Pass: reopened, one `silent_drop` outcome.
- **US-08-T04** Seed A (ready) and C (trigger A, open). Pass: C not dispatched until A is done with a disposition.
- **US-08-T05 [L2]** Holder 1 takes fence 7, expires; holder 2 takes fence 8; holder 1 writes with fence 7. Pass: rejected.
- **US-08-T06 [L2]** Run a loop that scans 25 and books 0. Pass: incident opened, 25 items reopened.
- **US-08-T07** Dispatch an identity-bound item, a failed-step item whose step has since completed, and an item no rule covers with no model available. Pass: the first is parked behind one gate card, the second is done with a `verified` outcome, the third is still claimed; no claim remains on the first two.
- **US-08-T08** Seed items ready for 3 hours at priorities 40 and 1 and one ready for 30 minutes. Pass: the first is at priority 5, the others unchanged, and one `AGE-120M-<date>` item exists after two ticks.
- **US-08-T09** Dispatch an item three times with no outcome. Pass: it is `blocked` with a loop-breaker blocker and `LOOPBREAK-<id>` exists at priority 0.

## 10. Reference implementation status

Paths that start with `core/` are in the `workers/` directory; paths that start with `seed/` are from the repository root.

- Item-level claims, reaper, triggers, silent-drop reconciliation, gate-card probes (R01 to R05, T01 to T04): BUILT in `core/src/tick.js` and `seed/worker/src/tick.js` (`reconcile`, `reap_claims`, `probe_gates`, `dispatch`) with `core/migrations/0001_init.sql` and `seed/worker/migrations/0001_init.sql`; tests in `core/test/tick.test.js` and `seed/worker/test/tick.test.js`: "items that left the active set without a disposition are reopened and counted as silent drops", "stale claims are released", "gate cards close when their probe shows the owner step is done". The same steps for rows of another tenant are tested in `seed/worker/test/tenant-isolation.test.js`.
- The doer (section 4.1, R16, R20, T07): BUILT in `seed/worker/src/doer.js` (`executeStep`), tests in `seed/worker/test/doer.test.js` ("owner-only items are parked behind one gate card and never re-dispatched", "the owner gate closes itself when no owner-only item is left", "a TICKFAIL item closes when a later tick completed the step", "without the AI binding a generic item waits with its claim kept (loop-breaker still applies)", "model calls per tick are capped"). The core tick's `execute` step settles only items whose closing probe it can read (`core/test/self-doer.test.js`).
- Loop-breaker (section 4.2, R18, T09): BUILT in `seed/worker/src/selfaudit.js` (`loopBreak`), tests in `seed/worker/test/selfaudit.test.js` and "a LOOPBREAK item unblocks its target and closes; the target then reaches the doer" in `seed/worker/test/doer.test.js`.
- Age bound (R17, T08): BUILT in `seed/worker/src/tick.js` (`age_sla`), tests "US-08-R17: an item open or ready past 120 minutes is raised to priority 5 and one AGE-120M item a day names the cause to find; a younger or more urgent item is left alone" and "US-08-R17: with nothing past 120 minutes no cause item is filed" in `seed/worker/test/tick.test.js`. The bound is a constant in the step, not configuration.
- Released-unworked metric (R19): BUILT in `seed/worker/src/doer.js` (`claimsReleasedUnworked24h`), read as a built-in metric in `seed/worker/src/tick.js` and on `/health` in `seed/worker/src/index.js`; test "claims_released_unworked_24h counts reaper releases of unworked claims" in `seed/worker/test/doer.test.js`.
- Disagreements with the QNFO design: each tick's own `claims` table is per item and has no token, expiry column or fence (expiry is derived from `heartbeat_at`), and no tick step renews the heartbeat: the seed's doer settles an item in the tick that dispatched it, and a claim it keeps for a waiting item is released after the time-to-live, which the loop-breaker then answers. Tokens, expiry, fences and heartbeat renewal are in the claims module below, which mirrors item claims into the core table. The tick sets the status `blocked` to park an item (section 4.1) or to break a dispatch loop; the Review and PrincipalQueue states are not implemented as states.
- Path-level claims with token, expiry and fence (R07, R08), heartbeat renewal (R06), shepherd refusal (R09), queue pull record (R10), rework escalation (R12), orphan metric (R13), one gate card per interrupt-eligible step (R14), idempotency keys (R15): BUILT in `core/claims/index.js` with `core/claims/migrations/0001_claims.sql`; tests `core/claims/claims.test.js` (named by requirement and test id: T01 to T06). Advisory except where the protected resource calls `check`; contention is proven on one SQLite handle, not on a scale-out store. The same mechanisms are RUNNING in QNFO, coordinating its own code loop and a hosted coding agent.
- Path-level claims, tokens and fences in the seed tick: PLANNED. The seed Worker does not load `core/claims`; a stalled holder of an item claim that wakes could still write. Work item `Q-SPEC-08-seed-fenced-claims`.
- Accounting invariant as an automatic gate (R11): BUILT in `core/claims/gate.js` with `core/claims/migrations/0002_gate.sql`; tests `core/claims/gate.test.js`. A gap opens an incident, reopens the unaccounted items, blocks closure of every ancestor of an unaccounted item, reopens a parent closed around the gate, and holds the loop's gate shut until a later run balances. Parent links are declared to the module; the core item schema has no parent column. The item-set form `entered = open + closed + superseded` is BUILT in `core/remediation/index.js` (`reconcileItems`, test `core/remediation/remediation.test.js`). Observed in QNFO as a failure case.
- Visibility ratio across issue stores (section 5): BUILT in `core/claims/gate.js` (`visibilityRatio`, threshold 2, test `core/claims/gate.test.js`) against a stores port; adapters that read a real second tracker are PLANNED.
- Principal queue with reroute rule (section 6): BUILT in `core/claims/gate.js` (`routeToPrincipal`, `cardsWithoutIdentityLine` as the target-zero metric, `rerouteCards`; test `core/claims/gate.test.js`), beside the core gate cards with probes. Rerouting of cards filed by other modules is opt-in (`reroute_cards`) because such cards carry their identity-bound line only as text. RUNNING in QNFO.
- Running the gate from the composition root: BUILT for the step (`core/org/buildout.js` step `claims_gate`, test `core/org/org.test.js`); the reroute is opt-in by `reroute_cards`. Stores for the visibility ratio supplied by the host: PLANNED.
