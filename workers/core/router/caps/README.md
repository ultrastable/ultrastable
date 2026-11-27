<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/router/caps

Switch rows, the global switch port, the bounded drill and the iteration bounds of US-SPEC-09 (R01 to R05, R07).

| File | What it holds | Requirement |
|---|---|---|
| `index.js`, `migrations/0001_caps.sql` | `setSwitch`, `isOn`, `guardLoop` (actions stop, measurement continues), `killSwitchPort` (read by `core/claims` and `core/router`), `drill` and `drillAgeHours` | US-09-R01, R02, R03 |
| `bounds.js` | `createBounds`: steps, tokens, wall-clock time and spend for one iteration | US-09-R04 |
| `upstream.js` | the resolved-upstream guard (`guardAllowed`, `costChangeProbe`) | US-09 section 4, US-24-R53 |

Registering `core/router/caps/migrations` as a module in `core/org/modules.js` is the integrator's change. Nothing here is
wired into `core/org` yet: the composition root chooses which loops run under `guardLoop`.

Related mechanisms elsewhere in the repository (not duplicated here): `core/claims` `killed()`, `core/deploy` kill switch and
breaker, `core/ghcost` workflow switch, the platform halt check (HALT-1) and the platform manager register.
