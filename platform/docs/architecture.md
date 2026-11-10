# Architecture: portable core, thin cloud adapters

Tag: NDA ONLY (AFTER FILING for a public version). Honest status labels: **BUILT** = code in this repo with passing tests; **RUNNING** = runs in production today; **PLANNED** = designed, not built.

## 1. Principle

The loops are the product; the cloud is a detail. The core knows nothing about any provider. It sees one thing: a **store** with the D1 surface (`db.prepare(sql).bind(...).all() / .first() / .run()`), plus a **scheduler** that calls `runTick`. Anything that offers those two runs the whole organization.

```
            +----------------------------- portable core (seed/worker/src/tick.js) ----------------------------+
            | reconcile | reap claims | probe gates | score predictions | accrue trust | dispatch | plus share  |
            +-------------------------------------------^------------------------------------------------------+
                                                        | Store (D1-style handle)        Scheduler -> runTick()
        +-----------------------+--------------------------+----------------------------+
        | Cloudflare adapter    | Google Cloud adapter     | Self-hosted / local        |
        | Worker + Cron + D1    | Cloud Run + Scheduler    | node server + SQLite file  |
        | RUNNING (QNFO), BUILT | + volume/Cloud SQL       | BUILT (same as GCP code)   |
        | (seed worker)         | BUILT (skeleton, tested) |                            |
        +-----------------------+--------------------------+----------------------------+
```

## 2. The seams (what an adapter must supply)

| Seam | Contract | Cloudflare | Google Cloud | Status |
|---|---|---|---|---|
| Scheduler | Call `runTick(db, {config, env, now})` on a cron; one tick at a time | Cron Trigger | Cloud Scheduler -> `POST /tick` on Cloud Run (shared-token header plus Google OIDC) | CF BUILT+RUNNING; GCP BUILT, not deployed |
| Store | D1-compatible handle over the schema in `seed/worker/migrations` | D1 | SQLite file on a Cloud Storage volume (single instance); Cloud SQL (Postgres) is the scale-out path | CF RUNNING; GCP SQLite BUILT; Postgres PLANNED |
| Secrets | Core sees only whether a secret exists, never the value | Worker secrets | Secret Manager (`TICK_TOKEN`, API keys) | BUILT (presence-only); Secret Manager wiring in `deploy.sh` |
| Models | Role asks for a rung (small/medium/large); adapter maps rung to a model | Workers AI or API | Vertex AI (Gemini, and Claude on Vertex) or API | PLANNED (executor is roadmap BS-4) |
| Role runtime | One instance per manager/staff role | Durable Objects / Agents SDK | Cloud Run jobs or Agent Engine | PLANNED |
| Queues, events | Work claims, dispatch | D1 table | table now; Pub/Sub later | table BUILT |
| Approval gate | Open card until a person answers; never auto-closed | Worker + notification | Cloud Run + notification | card table BUILT; notifier PLANNED |
| Object store | Exports, evidence, probe artifacts | R2 | Cloud Storage | PLANNED |
| Identity | Who may call the tick and the dashboard | Cloudflare Access | IAM / Identity-Aware Proxy | tick token BUILT; dashboard auth PLANNED |

## 3. What is proven and what is not

Proven by tests (`node --test platform/adapters/gcp/test/*.js`, `cd seed/worker && npm test`): the same `tick.js` runs every step against D1-shaped SQLite behind an HTTP service with token-gated `/tick` and a `/health` that reports the last tick. Not yet proven: a deployment on a real Google Cloud project (needs a project, billing and the owner's credentials; `platform/adapters/gcp/deploy.sh` is written, unrun), the Postgres dialect (the schema uses `datetime('now')` and `AUTOINCREMENT`; a thin dialect layer is needed), concurrency beyond one instance (SQLite on an object-store volume is single-writer; `deploy.sh` pins max-instances to 1), model execution on either cloud.

## 4. Google Cloud plan (for the Google for Startups kit)

| Phase | Deliverable | Done check |
|---|---|---|
| G0 (now) | Cloud Run adapter skeleton, tests, deploy script | tests pass in CI (done) |
| G1 | Deploy to a GCP project with Start-tier credits; Scheduler ticks every 10 minutes for 7 days | `/health` ok, 1,000 ticks, no silent drop |
| G2 | Cloud SQL Postgres store behind the same handle; two instances, claims correct under contention | contention test passes |
| G3 | Vertex AI model ladder (Gemini rungs) for staff roles; reviewer on a different model family | doer and reviewer differ, outcomes scored |
| G4 | Dashboard and approval notifications on Cloud Run with IAP | owner clears a gate card from a phone |
| G5 | Bootstrap from an idea on GCP: `seed` provisions the project resources end to end | idea file in, running org out, no manual step |

## 5. Why this shape

- A buyer is not locked to a vendor, and Ultrastable can honestly pitch both clouds.
- The dependency surface is tiny (one SQL handle), so porting is a day, not a rewrite. The risk is the SQL dialect, tracked as G2.
- Lessons from AIOS carried in: the tick never dies (each step is guarded and a failed step files its own item), inputs are verified, errors are never swallowed (`docs/bootstrapping/aios-lessons.md`).
