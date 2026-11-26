<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/staff: virtual staff, their authority and their lane

Implements the requirements of `US-SPEC-02` (R01, R03, R05 to R12, R14 to R19; R13 is the register of the platform seed) and the manager operations, queue score and origination of `US-SPEC-03` s4. It sits on `core/kernel` (it reads `kernel_focus`, `kernel_item_meta`, `kernel_metrics`, `kernel_allocations`) and never changes it.

```js
import { runTick } from '../src/tick.js';
import { L2_EXTRA_STEPS } from '../kernel/index.js';
import { registerPersona, createToolLayer, staffStep } from './index.js';
await registerPersona(db, { id: 'pgm-ops', role: 'program-manager', program_id: 'OPS', scope: 'program OPS', instruction_source: 'agents/roles/product-manager.md',
  authority: ['promote', 'restore', 'close_with_evidence', 'supersede', 'assign_doer', 'originate', 'score'] });
await runTick(db, { config, extraSteps: [...L2_EXTRA_STEPS, staffStep({ readFile, research })] });   // after the kernel's 'l2' step
const tools = createToolLayer({ db, now, config: config.staff, ports: { readFile, research } });
await tools.act('pgm-ops', 'promote', { item_id: 'A', prediction: 'm >= 1 within 24 h' });            // a person filling the role calls the same thing
```

Ports: `db`, `now`, `config.staff` (see `DEFAULTS` in `index.js`), `readFile(path)` (anchor validation and instruction files), `research(request)` (origination; returns text with the fields TITLE, WHY, code-task, code-anchor, EDIT; `research.js` builds one over a model), `instructionFor(role, program)` and `instructionExists(path)` (default personas). Migrations: `core/staff/migrations/0001_staff.sql` and `core/staff/migrations/0002_staff_claims.sql` (apply after the seed and kernel migrations).

## Requirement status

BUILT means implemented and covered by a passing test in this directory. Nothing here is RUNNING.

| Requirement | Status | Where / note |
|---|---|---|
| US-02-R01 a role is a record naming role, scope and instruction source; the roles table has a tick interval and a model | BUILT | `registerPersona`, `roles.test.js` |
| US-02-R05 enumerated decision authority; only listed operations are applied | BUILT | `registerPersona` (list required, role ceiling), `act` (refusal recorded in `staff_denials`, nothing changed) |
| US-02-R06 operation recorded with id, item, from, to, evidence; reversible by recording the reverse | BUILT | `staff_actions`, `reverse`: priority, status and doer are restored (a removed claim is restored from `staff_action_claims`), an originated item is cancelled with a disposition, an allocation is refused with its reason |
| US-02-R07 one brief per persona per tick it runs | BUILT | `writeBrief`, `runManagers`, `missingBriefs` |
| US-02-R08 program manager within its own program; portfolio manager demotes machine-filed items across programs | BUILT | `ROLE_CEILING`, lane check in `act` |
| US-02-R09, US-02-T03 no origination in, and no read of, another plane; enforced by the tool layer from the requester's identity | BUILT | `items`, `readStore`, `originate`. The layer guards the tools it offers; a caller holding the raw `db` handle is outside it, so the composition root must hand agents the tool layer and not the handle |
| US-02-R10 managers never target control-plane files | BUILT | `isControlPlane` in `assign_doer` and `originate`; the default list covers the tick implementations and the guards the repository protects; `control_plane_extra` adds to it (`controlplane.test.js`) |
| US-02-R11 a role filled by a person: same records, predictions, briefs, trust outcome | BUILT | `filled_by: 'person'`; the tick never acts for a person |
| US-02-R12, US-02-T09 role instruction files carry a never list | BUILT checker, PLANNED content | `rolefile.js`, `rolefile.test.js`. The six files in `agents/roles/` are protected paths and do not yet carry the three items; the todo test turns green when they do |
| US-02-R14, US-02-T06 refusals have a kind, change nothing, and a quiet duty leaves no row for a failed precondition | BUILT | `act` (`quiet`, `dry`), `staff.test.js` |
| US-02-R15 each operation reads back, writes a trust outcome and, with a prediction, a decision | BUILT | `act` |
| US-02-R17 default personas for the portfolio and every active program | BUILT | `seed.js`, `seed.test.js`; `staffStep` seeds first unless `config.staff.seed_personas` is false |
| US-02-R18 a person performs a role through a screen | BUILT handlers | `screen.js`, `screen.test.js`. PLANNED: mounting them in the console |
| US-02-R19 research agent behind origination | BUILT over a model port | `research.js`, `research.test.js` (fake model); the first real call is on a deployed account |
| US-02-R03, US-02-T08 item-level reviewer independence; family resolution | BUILT | `review.js`, `review.test.js`; `modelFamily` in `core/kernel/lifecycle.js` |
| US-04-R04 a review proposes a plus or says none was proposed | BUILT | `recordReview`, `reviewsWithoutPlus` |
| US-02-T01, US-02-T02, US-02-R02, US-02-R04 dispatch by `owner_role`; a new role row needs no code change | BUILT | the seed tick; asserted in `staff.test.js` |
| US-01-R07 score rows carry their writer; a persona deletes only its own | BUILT | `staff_priority_scores`, `deleteScore` |
| US-03 s4 queue score, both worked examples | BUILT | `queueScore`, `scoreItem`, `rankQueue`. Focus items take the full factors; any other item needs an assessment. `direction` is an input (default 0): inferring it is L3 |
| US-03 s4 operations: promote, restore, close with evidence, supersede, demote, assign a doer (anchor exactly once) | BUILT | `HANDLERS` in `index.js` |
| US-03 s4 origination: once a day, fewer than 3 open roadmap items, five fields, daily cap 4 | BUILT | `originate`, `parseProposal`. The research agent is a port (`research.js` builds one over a model) |
| US-03 s4 reroute parked tasks | BUILT elsewhere | `rerouteCards` in `core/claims/gate.js`; asserted in `core/claims/gate.test.js` |
| US-02-R05 for the kernel's own allocation | NOT COVERED | the kernel allocates by rule; this module logs that allocation as the portfolio persona's operation when `allocate` is on its list, and says so in the brief when it is not, but does not stop it |
| Read-only probe of the staff step | BUILT | `staffProbe` in `seed.js` |
