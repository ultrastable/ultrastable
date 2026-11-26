<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/router: cost-aware model ladder

Implements the model ladder of `US-SPEC-09` (with the Models seam of US-SPEC-14). A role asks for a rung (`small`, `medium`, `large`) and optional capabilities (`tools`, `json`, `long-context`, `vision`); the router maps that to a provider and model from configuration, falls back in order, enforces spend caps, honors kill switches and records every call.

Ports: `db` (D1-style), `fetch` (injected), `now`, `config`, `env` (only the presence of each provider's key variable is checked; key values are used solely as a request header and are scrubbed from stored or returned errors).

```js
import { createRouter } from './router.js';
const router = createRouter({ db, fetch, now: Date.now, config, env });
await router.route({ role: 'doer', rung: 'medium', capabilities: ['tools'], item_id, kind: 'doer' });
await router.call({ ...same, messages: [...] });
await router.spend('day');
await router.setSwitch('all', true, 'drill');
// fetch-style: handle(request, { router }) serves GET /spend?period=, POST /route
```

Configuration: see `example-config.json` (generic `provider-a`/`provider-b`). A provider with `kind: "github_models"` (`key_env` names the repository token, optional `org` and `max_prompt_chars`) is the free rung on the code host. Migrations: see the table below.

## Requirement status

BUILT means implemented here, or in the module named, and covered by a passing test. Every model port is a fake in the tests; nothing here is RUNNING.

| Requirement | Status | Where |
|---|---|---|
| US-09-R01 per-loop on/off row, actions stop and measurement continues | BUILT | `caps/index.js` (`setSwitch`, `isOn`, `guardLoop`), `caps/caps.test.js`. Wiring each loop of `core/org` through `guardLoop` is the composition root's change (PLANNED). Other switches: provider and global rows here, `core/claims`, `core/deploy`, `core/ghcost` |
| US-09-R02 global switch stops claims, renewals, deploy and secret leases | BUILT in `core/claims` (`killed()`); `caps/index.js` `killSwitchPort` feeds it and the router | `core/claims/claims.test.js`, `caps/caps.test.js` (T02) |
| US-09-R03 bounded drill that ends with the switch off, with an age metric | BUILT | `caps/index.js` (`drill`, `drillAgeHours`; a drill refuses to run while the global switch is already on), `caps/caps.test.js`, `recurrence.test.js`. Running it on a schedule in an organization is PLANNED |
| US-09-R04 per-iteration bounds on steps, tokens, wall-clock time and spend | BUILT | `caps/bounds.js` (`createBounds`), `router.call({ bounds, deadline_ms })`, `caps/bounds.test.js` |
| US-09-R05 no paid call while a cap is breached; the overage is the top task | BUILT | hard cap refuses, files a `router_gate_records` row and a priority-0 `SPEND-<scope>` item, closed when spend is below the cap |
| US-09-R06 never raise a cap or clear a breach by deletion | BUILT | Router never writes caps or deletes calls (`caps/spec-citations.test.js`) |
| US-09-R07 cap steers down, never ends task while free path exists | BUILT | soft cap steps down one rung; hard cap serves only free models. The runner's own cap guard (`core/runner/selfdoer.js`) is another module and still skips a step at its USD cap |
| US-09-R08 capability first | BUILT | model `capabilities` list is the passed-canary set; with a `matrix` port (`createRouter({ matrix })`) only admitted models of `request.task_class` are offered (`caps/upstream.test.js`) |
| US-09-R09 escalation on measured signal | BUILT in `core/ladder` (`cascade`) | Here provider errors fall back in order; a retired model (HTTP 410) is skipped for 7 days and its provider's next rung serves |
| US-09-R10 cost/escalation/cache/tool-call metrics | BUILT | `router_calls`, `spend()`; `core/ladder` (`costPerTask`, `cacheHitRate`, `toolCallValidity`) |
| US-09-R11 model floor guard | BUILT in `core/ladder/floorguard.js` (source and bundle) | |
| US-09-R12 decision-model agreement gate | BUILT in `core/ladder` (`admit`, table `ladder_model_admission`) | The router consults the matrix through the `matrix` port |
| US-09-R13 review and proposal in different families | BUILT | reviewer excludes doer families of the same `item_id`; refuses with `no_distinct_family` |
| US-09-R14 tier from budget | BUILT | `selectTier(budget, tiers)`; all three columns asserted in `caps/spec-citations.test.js` (T05) |
| US-09-R15 loop breaker | BUILT in `core/kernel/failure.js` (`recordAttempt`) | cited by `caps/spec-citations.test.js` |
| Resolved upstream and the inverted-guard check | BUILT | table `router_upstream`, `caps/upstream.js` (`guardAllowed`, `costChangeProbe`, `mismatches`) |
| Infrastructure calibration: EMA baselines, adaptive thresholds, daily, weekly stress and monthly cleanup, verified reversible adjustments | BUILT | `calibration.js`, `calibration.test.js`; see `CALIBRATION.md` |
| GitHub Models free rung | BUILT | `providers/github-models.js`, `github-models.test.js` |

Layers in this repository: draft-then-verify, the persisted capability matrix, shadow sampling, the demotion step, the L0 handler registry, the L1 semantic cache, the L4 free-only ensemble, the L5 exemplar bank, the L7 budget scheduler and the cost-per-task view are in `core/ladder` (see its README); L1 exact cache with dedupe is `core/airouter`. A trained distilled specialist stays PLANNED.

Migrations: `core/router/migrations/0001_router.sql`, `core/router/migrations/0002_calibration.sql`, `core/router/migrations/0003_upstream.sql`, `core/router/migrations/0004_baseline.sql`; `core/router/caps/migrations/0001_caps.sql` is a module of its own that the composition root registers.

## Workers AI provider (keyless first rung)

A provider with `kind: "workers_ai"` calls the Workers AI binding (`env.AI.run(model, { messages, max_tokens })`), injected as the `ai` port. It needs no key and no payment: set `key_env` to `null`, give the models zero prices, and name the model ids in config. Usage is still written to `router_calls` (tokens as reported, or estimated at 4 characters per token), cost is 0, so the yield module sees it. A binding error takes the normal fallback path to the next provider.

```json
"edge": { "kind": "workers_ai", "key_env": null, "family": "open-weights",
  "models": { "small": { "id": "<model id>", "capabilities": ["json"], "usd_per_1k_in": 0, "usd_per_1k_out": 0 } } }
```

Quality guard: `router.rung_roles` maps a provider kind to the roles it may serve. Default for `workers_ai`: triage, review, reviewer, management, manager. The doer role is refused (`role_not_allowed`) unless config adds `"doer"`. When the runner has ready work and only such a provider exists, it files the decision card "a stronger model is needed for code changes" and blocks the item instead of opening a poor pull request. `runnerNeeds` treats the `AI` binding as satisfying the provider requirement.
