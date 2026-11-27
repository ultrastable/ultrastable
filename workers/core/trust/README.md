<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/trust: trust ledger, ladder and interrupt gate

Implements the parts of `US-SPEC-06` the seed tick does not: event weights, decay toward the prior, a windowed severe count, per-executor trust, recorded transitions applied only by a different agent's merge, the gate card queue, reversibility engineering, standing limits above any rung, and the policy validator in JavaScript. The seed tick (`core/src/tick.js`) keeps computing `trust_ledger`; this module reads it and writes its rung only in `applyRungChange`. Ports: `db`, `now`, `policy` (the content of `autonomy/policy.json`), `config`. Migration: `migrations/0001_trust.sql` (tables `trust_*`). Consumers: `step({ db, policy, config, now })` is the tick surface; proposals are `items` of kind `ladder`, rerouted cards are `items`.

```js
import * as trust from './index.js';
trust.assertPolicy(policy);                                         // boot: an invalid policy throws
await trust.step({ db, policy, now });                              // scores, proposals, reroutes
await trust.authorize(db, { surface, action_class, target, executor, required_rung, limits, reversible_forms, card }, { policy, now });
await trust.applyRungChange(db, { item_id, merged_by, policy, now }); // the merge of a reviewed change
await trust.recordEvent(db, { surface, action_class, executor, event: 'hidden_failure' }, { now });
```

Config (`config`): `severe_window_days` (default: the policy's `no_hidden_failure_days`, 14; `null` = all time), `decay_per_unit` (default: the policy's `decay_per_idle_day`), `decay_unit` (`day` or `tick`), `event_weights`, `mode` (`threshold` or `banded`), `bands`, `opened_by`.

## Requirement status

BUILT means implemented here and covered by a passing test in `trust.test.js`. Nothing here is RUNNING.

| Requirement | Status | Where |
|---|---|---|
| US-06-R01 ledger keyed by pair, recomputed from outcomes | BUILT | `recompute` (`trust_scores`); the seed tick keeps `trust_ledger` |
| US-06-R02 no outcomes gives the baseline | BUILT | `reliability` |
| US-06-R03 formula and prior stated in the policy | BUILT | `settings` refuses a policy that does not state them |
| US-06-R04 rung never above the surface ceiling | BUILT | `recompute`, `applyRungChange`, `effectiveRung` |
| US-06-R05 the tick changes no rung; a crossing opens a ladder item | BUILT | `recompute` (item id carries the date on a repeat crossing) |
| US-06-R06 rung change merged by a different agent | BUILT | `applyRungChange` |
| US-06-R07 severe outcomes demote; window stated | BUILT | `severe_window_days` |
| US-06-R08 irreversible and identity-bound: gate card at any rung | BUILT | `authorize` |
| US-06-R09 card needs closing probe and default; manual never closed by the tick | BUILT | `openCard`; closing is the seed step `probe_gates` |
| US-06-R10 only presence of a secret recorded | BUILT in `core/deploy` | test "US-06-R10, US-06-T06"; a gate card for a missing credential closes by `env:<NAME>` (test "US-06-T05") |
| US-06-R12 money, legal, outreach, secrets below execute | BUILT | `validatePolicy`, `assertPolicy` |
| US-06-R11 an invalid policy blocks the boot | BUILT | `validatePolicy`, `assertPolicy` here; both bootstrappers (`bootstrap/bootstrap.py` and the seed's) validate the policy before the idea, mark stage `read` blocked, file `BOOT-READ` and exit 2 |
| US-06-R26 no provisioning while an invalid policy blocks `read` | BUILT in the bootstrappers | `provision` and `start` return blocked in apply mode (tests `tests/test_bootstrap_hardening.py` and the seed's `../seed/tests/test_policy_guard.py`) |
| US-06-R27 a denied action is refused before the reversibility step | BUILT | `authorize`; `validatePolicy` flags denied with `reversible` or `reversible_path` |
| US-06-R13 standing limits outrank rung and score | BUILT | `authorize`, `recordRefusal`, `maySubmit` |
| US-06-R14 reversibility engineering before classifying irreversible | BUILT | `authorize({ reversible_forms })`, `trust_reversibility_attempts` |
| US-06-R15 step without an identity-bound line rerouted; metric | BUILT | `openCard`, `rerouteUnbound`, `cardsWithoutIdentityLine` |
| US-06-R16 reversible in-scope question answered by the default | BUILT | `adoptDefault` (`trust_adoptions`) |
| US-06-R17 transitions recorded with evidence | BUILT | `trust_transitions` |
| US-06-R18 queue multiplier | BUILT | `queueMultiplier`, `rankItems` (one read for many items, ties keep input order); no queue uses them yet |
| US-06-R24 a ladder item is closed by applying the rung its reviewed merge carried | BUILT | `settleLadder`, `ladder-loop.test.js` |
| US-06-R25 an action on a policy surface is authorized before it executes | BUILT | `deployAuthorizer` (port for `core/deploy`), `trust.test.js` and the deploy tests |
| US-06-R19 per-executor trust, minimum of executor and pair | BUILT | `effectiveRung`, `trust_executor_rungs` |
| Event weights, decay toward the prior, lower confidence bound, banded ladder (section 3 alternatives) | BUILT | `recordEvent`, `decayToward`, `wilsonLower` (promotion also requires it with `config.promote_on = 'lower_bound'`), `rungForScore` |
| Mirror rule | BUILT as a function | `mirrorProblems(policy, harnessDeny, { shell_surfaces })` (a gated action on a shell surface with no `harness_deny` is reported too), `harnessDenyFrom(settings)`; the caller supplies the settings file |
| US-06-T05, T06 boot without a credential; planted secret | BUILT for the card and the deploy path | `trust.test.js`, `core/deploy/deploy.test.js`; the boot exit code is in the bootstrapper tests |
| Cards without an identity-bound line, with a trigger (US-06-R15) | BUILT | `checkHealth` files one item per day |
