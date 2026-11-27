<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/packs: capability packs and the outbound guard

Implements `US-SPEC-21`. A pack is an optional set of code loops (email, social, analytics, ...) with its own manager, charter, caps and kill switch. It is OFF until a person enables it, and everything it sends outside the organization goes through one function, `guard.send`. Core never imports a pack.

## Wiring

```js
import { createPacks, MIGRATIONS_DIR, loadManifest } from './core/packs/index.js';

const packs = createPacks({ db, now, config: { packs: { example: { recipients: [...] } } }, channels: { fake: fakeChannelPort } });
await packs.register(loadManifest(dir), { dir });       // validates; refuses at load (R02)
await packs.enablePack('example', { by: 'person', cardText });   // the console decision card (R01)
await runTick(db, { config, extraSteps: [...L2_EXTRA_STEPS, ...await packs.packSteps()] });   // enabled packs only
```

`channels` is the port the guard delivers through: `{ <name>: { send({pack, channel, kind, recipient, content, idempotencyKey}) -> { id }, maxLength?, senderId? } }`. `importer` (default: Node dynamic import) loads loop modules; a Worker host injects its own. Apply `core/packs/migrations/` after the seed and kernel migrations; a pack's own migrations are applied by the host through the canonical migration path.

## How a person enables a pack

`packs.routes({ authorize, bounceSecret })` returns `{ handle(request) }`, the person-facing surface (US-21-R30): `GET /packs` shows each pack's `enable_gate` text as a decision card (what it does, will not do, costs, how to stop), the last channel probes and the ceiling; `POST /packs/<id>/enable { cardText }` records the person's "yes" (the actor `authorize(request)` names becomes `by`; no actor is a 401). The text must equal the manifest's card, so what was shown is what is recorded. That writes `packs_registry` (who, when, card text shown, decision id), a `kernel_decisions` row with revert path `disablePack(id)`, the pack's program charter and metrics (primary and guard), a manager role `pack-manager-<id>` and a first plus item, and, for an outbound pack, the live-trial gate card (US-21-R25). `POST /packs/<id>/disable` stops the loops on the next tick and the guard refuses the pack's sends at once. Queued sends wait as gate cards; `GET /packs/queue` lists them and `POST /packs/queue/<id>/approve|reject` decides them. `GET|POST /packs/switches` engages a kill switch. Every mutation is a row in `packs_actions`. The host mounts the route behind its own login; the same calls exist as functions (`enablePack`, `guard.approve`, `setSwitch`).

## How to write a pack

A directory with `core/packs/example/pack.json` and code. See `example/` (class B, a `noop-notify` loop, a fake channel).

| Manifest field | Notes |
|---|---|
| `id` (`[a-z][a-z0-9_]*`), `name`, `version`, `class` A-D | Metric ids and table names start with `<id>_` |
| `scope.does`, `scope.does_not` | `does` is scanned for the out-of-bounds behaviors of s3 and refused |
| `charter` | `objective`, `primary_metric`, at least one `guard_metrics` (`{id, op, target, read_probe}`; probe is one SELECT) |
| `requires` | `ports`, `secrets` (NAMES only), `specs` |
| `loops` | `{id, every_ticks, entry: "./file.js#export", outbound}`; the export is `async ({db, ctx, now, pack, settings, guard, secrets}) => {}`; `secrets.has(NAME)` and `secrets.get(NAME)` read only the names the manifest declares (R20) |
| `hooks` | optional `{ bounce: "./file.js#export" }`: called after the core bounce intake applied an event on one of the pack's channels, with `{db, event, outcome, guard, secrets, settings}` (R21) |
| `covers` | optional lower-case bootstrap case tags the pack brings back when enabled (`bootstrap/cases.json`) |
| `outbound` | required when a loop is outbound: `channels`, `caps: {ch: {per_day, per_week}}`, `consent` (`none`/`single_opt_in`/`double_opt_in`), `suppression: true`, `approval` (`by_rung`/`always`), optional `hosts` (bare host names the pack's fetch may reach, R28) |
| `defaults` | Config defaults; real hosts, account ids and configured tenant names are refused (R11) |
| `enable_gate` | The plain-words card |

A loop reaches outside only through the `guard` it is given, bound to its own pack id. Class C packs have no outbound loop and the guard also never lets them send. Class ceilings (config `ceilings`, `act_rung`): A top rung, B `autonomous`, C `observed`, D `delegated`; earned trust above the ceiling is clamped. The act rung is `delegated` by default; below it, sends queue as a card.

## Requirements

| ID | Status | Where |
|---|---|---|
| US-21-R01 off until enabled, recorded decision, one-action disable | BUILT | `enablePack`, `disablePack`, `packSteps` (enabled only) |
| US-21-R02 manifest validated at load | BUILT | `validateManifest`, `register` |
| US-21-R03 core does not import a pack | BUILT (static check) | `assertCoreImportsNoPacks`, tested over `core/` and `adapters/` |
| US-21-R04 manager role, charter, primary and guard metric, plus items | BUILT | `enablePack` seeds roles and kernel records (kernel tables optional) |
| US-21-R05 guarded tick step per loop | BUILT | error filed as `PACKFAIL-*` item, timeout, run counts in `packs_runs` |
| US-21-R06 every outbound action passes the guard | BUILT: the host gives loops only a frozen `boundGuard` and a sandboxed db, and the source scan refuses ambient network access (R27) | `createGuard.send`, `sandbox.js` |
| US-21-R07 independent kill switch | BUILT | `packs_switches` (`global`, `pack:<id>`, `channel:<name>`) |
| US-21-R08 pack cannot change core or other packs | BUILT: loops get `sandboxDb` (writes only to `<id>` or `<id>_*`, `items`, `predictions`; no DDL, PRAGMA, registry, switches or consent tokens), a restricted ctx (no env or config) and a frozen bound guard; `register` scans pack source for escaping imports, fs, eval | `sandbox.js`, `sandbox.test.js` |
| US-21-R09 secrets by presence only | BUILT: manifests name secrets only, loops read them only through `secrets.has/get` (R20), content with secret patterns is refused, hashes are stored, and the host wrapper redacts secret values (declared names resolved in env, secret-looking settings, secret shapes; raw, URL-encoded and base64) from run rows, tick errors and notes, backlog item titles and delivery failure reasons | `SECRET_PATTERNS`, `redact.js`, `redact.test.js` |
| US-21-R10 testable with fake ports | BUILT: every shipped pack's tests also pass with `fetch` and `WebSocket` replaced by throwers | `packs.test.js`, `offline.test.js` |
| US-21-R11 no tenant names in code or defaults | BUILT (hosts, account ids, configured `tenant_names`) | `validateManifest`, `core/test/no-qnfo.test.js` |
| US-21-R12 autonomy ceiling by class | BUILT | `rungCeilings`, rung clamp in the guard |
| US-21-R13 unsubscribe and suppression immediate | BUILT | `guard.unsubscribe`, `guard.suppress` (also cancels queued items) |
| US-21-R14 one guard for every pack and platform | BUILT | same `createGuard` code, ports injected |
| US-21-R15 delivery feedback feeds suppression without a person | BUILT: hard bounce suppresses the channel, complaint and unsubscribe suppress `*` and cancel queued sends, soft bounces count to a limit inside a window, a retried event changes nothing, hashes only | `bounce.js`, `bounce.test.js` |
| US-21-R16 pack migrations applied once on enable, with a digest | BUILT: only the pack's own objects, read under the sandbox read rules (a view cannot expose a table the pack may not read); a failing or outside statement leaves the pack disabled and the database unchanged; an edited applied migration is refused (`migration_changed`) | `loader.js`, `loader.test.js` |
| US-21-R17 redaction of everything a pack loop leaves behind | BUILT: run rows, tick errors and notes, backlog items, the guard ledger and refusal reasons; raw, URL-encoded and base64 | `redact.js`, `redact.test.js` |
| US-21-R18 the platform's own actions keep the same boundary | BUILT in the platform: egress and reserved classes denied at any rung, trust widens inside only | `../foundation/boundary.py`, `../tests/foundation/test_spec_21_plugins.py` |
| s6 check order | BUILT (pack, switches, class, idempotency, suppression, consent, caps, content, approval, deliver); re-run at approval | `guard.js` |
| T21-1 .. T21-8 | BUILT | `packs.test.js` |
| US-21-R27 a pack holds no ambient network path | BUILT: the source scan refuses global `fetch`, `WebSocket`, `XMLHttpRequest`, `EventSource`, `sendBeacon`, `cloudflare:*`, tls, dns, http2, `eval` and `Function` in any form, `.constructor`, a unicode escape outside a string, and an import of anything it does not read (a `.cjs` file, a test file, `node_modules`, a bare package name); a loop or hook entry must be a scanned file | `sandbox.js`, `lex.js`, `manifest.js`, `egress.test.js` |
| US-21-R28 the fetch a pack receives reaches only its declared hosts | BUILT: `createEgressFetch({ fetch, hosts })`; manifest `outbound.hosts`; redirects are followed hop by hop only to allowed hosts | `egress.js`, `egress.test.js` |
| US-21-R29 earned trust per pack, bounded by class and policy | BUILT: outcomes on `pack:<id>`, `trust.refresh()` and `trust.apply()` (a different agent's merge); the shipped policy keeps class B at `assisted`, and `core/org/index.js` passes `config.packs.policy` or else `config.policy` to the packs (`core/org/wiring.test.js`) | `trust.js`, `trust.test.js` |
| US-21-R30 one person-facing surface | BUILT: `packs.routes(...)` | `routes.js`, `surface.test.js` |
| US-21-R20 secrets by presence accessor | BUILT: `secrets.has/get` limited to declared names, undeclared names recorded as `secret_not_declared` | `index.js`, `surface.test.js` |
| US-21-R21 delivery events reach the owning pack | BUILT: manifest `hooks.bounce`, called once per event after the core intake; hook failure files `PACKFAIL-<id>-hook-bounce-*` and leaves the suppression applied | `bounce.js`, `index.js`, `surface.test.js` |
| US-21-R22 act rung per action kind | BUILT: `config.act_rungs` | `guard.js`, `trust.test.js` |
| US-21-R23 other outbound paths deliver through the guard | BUILT: `packs.transport({ pack, channel })` for `core/outreach.dispatch` and `core/promote`; wiring those modules to it is the host's | `transport.js`, `surface.test.js` |
| US-21-R24 class D never deletes what it did not create | BUILT: manifest refusal of delete and personal-account behaviours; the plugin tier enforces the managed label and refuses DELETE | `manifest.js`, `egress.test.js`, `../seed/plugins/gcp/plugin.py` |
| US-21-R25 read-only channel probes and a live-trial gate | BUILT: `packs.probeChannels()`, `packs_probes`, gate card `pack-trial-<id>` closed through the tick by `item_done:PACKTRIAL-<id>`; the first real send with a provider credential stays the person's (PLANNED) | `probe.js`, `surface.test.js` |
| US-21-R26 sends are reserved before the provider is called | BUILT: one conditional INSERT into `guard_inflight` checks the key and both caps (sent plus in flight); released when the delivery ends, after the queue entry is settled; stale after `inflight_ttl_ms`; a decision claims its queue entry with one conditional update before it acts (a claim left by a crash is taken again after `inflight_ttl_ms`), so of an approve and a reject that start together, or one that starts while the key is in flight, exactly one decides and the other returns `decision_in_progress` and changes nothing | `guard.js`, `migrations/0006_guard_inflight.sql`, `packs.test.js` |
| US-21-R08 what a pack reads and changes | BUILT: no read of the trust ledger, roles, gate cards, suppression list, ownership ledger, schema (including `pragma_*` functions) or queue content; no string literal where SQLite reads a table name; comments and strings removed in one left-to-right scan shared with the tenant store; no parameter but a bare `?` (a numbered or named one would move the id a write binds); INSERT into `items`, INSERT or UPDATE-by-id on `predictions` only for ids in the pack's namespace, never an overwrite (no OR REPLACE, REPLACE INTO or upsert), and an UPDATE only of a prediction `packs_rows` records as the pack's | `sandbox.js`, `migrations/0007_packs_rows.sql`, `sandbox.test.js` |
| US-21-R27 token-level source scan | BUILT, best-effort: `lex.js` reads tokens and binds names by scope, so a string holding `//`, a destructured or aliased global `fetch`, or a `fetch` bound in another function no longer passes; whether a `/` is a regex or a division is read from a stack of what each open bracket is, as acorn's tokenizer reads it (after `)` of an if, for or while head, after a statement block or declaration, after `${`; never after a postfix `++`) | `lex.js`, `sandbox.js`, `egress.test.js` |
| US-21-R28 the host builds the egress fetch | BUILT: `packs.egressFetch(id, { fetch })` from the manifest's `outbound.hosts`, the fetch defaulting to the one the host gave `createPacks` (`core/org/index.js` gives its own); refusals recorded as `egress_refused` | `index.js`, `egress.js`, `egress.test.js` |
| Honest sender identification | BUILT when the channel port declares `senderId` | |
| Bounce and complaint intake | BUILT: `packs.bounces.ingest(payload, {channel, format})` and `handle(request, {secret})`; hard bounce suppresses the channel, complaint and unsubscribe suppress `*`, soft bounces count to a limit; events are idempotent by id; ledger `guard_bounces` keeps hashes only | `bounce.js`, `bounce.test.js` |
| Class D routing through `core/deploy` | BUILT: `createPacks({ deployRoute })` (see `core/deploy/packs-route.js`); the guard delivers a class D pack's sends only through the route, chosen from the pack class, so a `viaDeploy` flag in a request is ignored; no route means `class_d_requires_deploy` | `guard.js`, `core/deploy/packs-route.test.js` |
| Applying a pack's own migrations on enable, loading packs from a directory scan | BUILT: `enablePack` applies the manifest's migrations once (ledger `packs_migrations`, digest kept; only `CREATE`/`ALTER`/`INSERT` on `<id>` or `<id>_*` objects; failure leaves the pack disabled); `loadFromDir(root)` registers every valid pack | `loader.js`, `loader.test.js` |

Storage note: `guard_ledger` holds only hashes of recipient and content. `guard_queue` holds the raw recipient and content while a send awaits approval and clears both when decided. Consent is per recipient, channel and pack (`*` means any pack).
