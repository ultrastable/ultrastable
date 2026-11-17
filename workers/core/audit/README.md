<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/audit: a lean, tamper-evident record of every autonomous action (AUDIT-1)

Every deploy, merge, model vote, entry change, outreach send and owner decision is one event in one append-only log. Each event carries the hash of the one before it, so changing, removing or reordering any event breaks every hash after it. Tenant-agnostic; ports are `db` (D1-style), optional `bucket` (R2-style), `now`, `config`.

## How it stays small (free tier)

| Layer | Holds | Size control |
|---|---|---|
| `audit_events` (D1) | the last `hot_days` (default 2) of events, one row each, primary key only (an append writes one row) | rolled out daily |
| `audit_days` (D1) | one anchor row per finished UTC day: count, Merkle root, chain hash, kind counts | one row per day, forever |
| batch (R2 if `bucket`, else one gzip base64 cell in `audit_days.blob`) | the day's events, gzip | deleted after `archive_days` (default 400); the anchor stays |

An event keeps a redacted summary (280 characters at most) and the sha-256 of its payload. The payload itself is never stored. At 1,000 events a day the hot table is about 2,000 rows and the table of days grows by one row a day.

## What can be proved

- `verify()` recomputes the anchor chain from the first day, every hot event, and a rotating sample of archived batches (the newest `deepDays` plus a cursor that walks the rest). It reports problems; it never repairs. A broken chain files an `incident` event in the tick step.
- `proof(seq)` returns a Merkle path from one event to its day root. A holder of the event text derives its hash and checks the path with `applyPath`.
- Limits, stated plainly: the log is tamper-evident, not tamper-proof. Someone who can rewrite the database and every later anchor can forge a consistent history, so publish `summary().head.hash` somewhere outside the database (the public summary route does) and compare. After `archive_days`, individual events can no longer be proved, only their day.

## Interface

`createAudit({db, bucket, now, config})` returns `append(event)`, `appendMany`, `roll()`, `verify()`, `summary()`, `proof(seq)`, `events()`, `day(d)`, `digestLoopBeats()`, `step()` (tick step), `handle(request, {authorize})`.
Event: `{actor, kind, subject, summary, ref, payload, at?}`. `kind` matches `^[a-z][a-z0-9_.-]{1,40}$` (for example `deploy`, `merge`, `model_vote`, `entry_change`, `outreach_send`, `owner_decision`, `incident`).

Routes under `/audit`: public `GET /summary.json`, `GET /verify`, `GET /proof?seq=N`; with authorization `GET /events`, `GET /day/<day>`, `POST /event`.

`digestLoopBeats()` reuses `loop_beats` instead of copying it: each finished hour of each loop becomes one `loop_digest` event that names the beat ids it covers.

Org wiring: `config.audit.enabled = true` adds the `audit` tick step and the routes; set `config.audit.bucket_binding` (default `AUDIT_BUCKET`) to use R2. Authorization is `Authorization: Bearer <AUDIT_TOKEN or CONSOLE_TOKEN>`.

## Status

| Requirement | Status |
|---|---|
| hash-chained append, verify, tamper detection (edit, delete, reorder) | BUILT, `audit.test.js` |
| daily Merkle roll-up, R2 or D1 batch, retention, proofs | BUILT, `audit.test.js` |
| loop_beats digest, tick step, public summary and routes | BUILT, `audit.test.js` |
| external anchoring of the head hash | NOT COVERED (the head is published by the summary route only) |
