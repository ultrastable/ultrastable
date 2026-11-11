# 01 Architecture and portability

## Purpose
Run the same organization on any platform that offers a store and a scheduler. The loops are the product; the cloud is a detail.

## Concepts
- **Core**: the tick and its steps. It sees only a **store** (a D1-style handle: `prepare(sql).bind(...).all()/.first()/.run()`) and a **scheduler** that calls `runTick(db, {config, env, now})`.
- **Adapter**: the thin layer that supplies those two things plus secrets, models, queues, object storage and identity for one platform.
- **Instance**: a manifest (`instances/<slug>/instance.json`) that names a system; the kernel is copied unchanged and instance values are written around it (docs/FOUNDATION.md).

## Layers
| Layer | Contents | Changes by |
|---|---|---|
| Kernel (`seed/`) | doctrine (`agents/AGENTS.md`), role files, `autonomy/policy.json`, schema, tick, bootstrap case library | reviewed PR |
| Foundation (`foundation/`) | manifest validation, new-system generator, credential ladder, preflight, minute budget | reviewed PR |
| Instance | name, goals, runtime, budget, brand | owner or fleet, by PR |

## Seams an adapter supplies
Scheduler, store, secrets (presence only, never values), models (a rung maps to a model), role runtime, queues and events, approval gate, object store, identity. The table with per-platform status is in [platform/docs/architecture.md](../platform/docs/architecture.md) §2.

## Platform order
1. **Cloudflare Workers** (first code base, JavaScript): Cron Trigger, D1, Workers secrets, Workers AI, R2. RUNNING (QNFO fleet), BUILT (seed worker).
2. **Google Cloud**: Cloud Run + Scheduler, SQLite volume then Cloud SQL, Secret Manager, Vertex AI. BUILT skeleton, not deployed.
3. **Self-hosted**: a node process plus SQLite. BUILT.
4. Others (AWS Lambda, etc.): PLANNED; any adapter that passes spec 12 conforms.

## Invariants
1. Core code MUST NOT import a provider SDK; adapters MAY.
2. The store schema is additive only; migrations never drop without an export first.
3. Secrets are referenced by binding name; no value is printed, committed or moved.
4. One tick at a time per organization; a second scheduler MAY run as a dead-man check (archive §27.5).

## Reference implementation
`seed/worker/src/tick.js`, `seed/worker/migrations/`, `platform/adapters/gcp/`, `platform/core/ultrastable/` (Python reference), `platform/cloudflare-reference/` (verbatim QNFO workers).

## Conformance
Tick steps run against a D1-shaped SQLite (`cd seed/worker && npm test`); adapter tests (`node --test platform/adapters/gcp/test/*.js`).
