<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/walkthrough: first run, Ask cards, read-back, profile

US-SPEC-18 sections 4 to 6. Tests: `walkthrough.test.js`, `console-rules.test.js`.

| Requirement | Status |
|---|---|
| Walkthrough generated from the needs register (`catalog.json` is the default catalog), steps 1 to 5 | BUILT (`current`, `submitIdea`); step 3 cards ride beside every step |
| US-18-R11 resumable, never blocked on one card | BUILT: the step is computed from the records on every call |
| US-18-R12 ends with exactly what runs and what does not yet | BUILT (`whatWorks`) |
| Elicitation Ask cards as decision cards with buttons (section 4) | BUILT (`answer`, `compose`) |
| Read-back screen (US-16-R12, R13, R14) | BUILT (`renderReadBack`, `correct`, `confirmReadBack`) |
| Per-person profile set from answers, with the limits of section 6 | BUILT (`profile`, `setProfile`, `validateProfile`, `compose`) |
| US-18-R01, R02, R03, R04, R08 cited against `core/src/console.js` | BUILT as tests |
| Mounted in the served console | BUILT: `core/org/surfaces.js` mounts `handle(request, { person })` inside the signed-in console (owner-only), tested in `core/org/surfaces.test.js`. `screens(person, data)` is added to `GET /api/console` as `screens` (additive) |
| The page script of the console drawing the walkthrough steps, Ask cards in Needs you, the read-back step, "and N more" counts and the owner link button | BUILT (`core/src/console-ui.js`; test `core/test/console-ui.test.js`, which runs the page script in a fake DOM) |
| Plain words for roles, surfaces, action classes and levels on the screens, raw values kept under `raw` (US-18-R06) | BUILT (`plain.js`, `plain-words.json`; tests in `console-rules.test.js`) |
| Languages: the fixed strings of the page keyed in `messages.json`, a person's dictionary applied with English fallback per string, right-to-left direction | BUILT (`i18n.js`; tests in `walkthrough.test.js` and `core/test/console-ui.test.js`). No dictionary other than English is shipped: producing one needs a model route (core/i18n `translateBatch`) and a reviewer; closing probe: `messagesFor('<lang>', config.dictionaries).translated > 0` on a deployment |
| The person's time zone (quiet period in local time, US-16-R16) | BUILT (`walkthrough_settings`, migration `migrations/0002_walkthrough_settings.sql`; test `core/elicit/derive.test.js`) |
| The read-back reaches the lifecycle gate (`onReadbackShown`, `onReadbackConfirmed`) | BUILT as ports; wiring them to `recordReadback` in `core/kernel/lifecycle.js` is an integration request |

Ports: `db`, `elicit`, `now`, `config`. Owner role: product-manager. Closing probe: `node --test core/walkthrough/walkthrough.test.js`.
