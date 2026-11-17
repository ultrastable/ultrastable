<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# US-SPEC-25: Tenant storage, vector search and hard budgets

| Field | Value |
|---|---|
| ID | US-SPEC-25 |
| Title | Tenant storage, vector search and hard budgets |
| Version | 0.1.0 (draft) |
| Date | 2026-11-16 |
| Status | Draft |

## 1. Purpose

Every tenant app (a sandboxed system run on Ultrastable, including Ultrastable itself) needs private storage, fast reads, vector search and a bill that cannot run away. Cloudflare has no native spend cap, so the cap is part of the storage layer. Builds on US-SPEC-14 (portability seams), US-SPEC-09 (caps) and US-SPEC-24 (cost control). All dollar figures are ESTIMATES from public list prices on 2026-11-16 (`core/tenantstore/prices.json` carries the date and sources); they are never a bill.

## 2. Decision

One design: **a tenant's data lives in one private SQLite store behind the `SqlPort` (on Cloudflare, one SQLite-backed Durable Object per tenant), metered by a `BudgetGuard`, with write-time rollups, vectors in the same store, R2 for blobs and KV or cache for hot reads.** Shared D1 is retained only for the small fleet control plane (registry, trust ledger, queue), not for tenant data.

## 3. Options compared (estimates; latency figures are typical, not measured here)

| Option | Cost shape (Workers Paid) | Latency shape | Isolation | Verdict |
|---|---|---|---|---|
| DO SQLite, one per tenant | rows read 25 B/mo and rows written 50 M/mo included, then USD 0.001 and 1.00 per million; requests 1 M/mo then 0.15 per million; 5 GB then 0.20 per GB-month. Duration (GB-s) is billed while active and not modelled here | queries run in-process next to the data, sub-millisecond for indexed reads; one hop to reach the object | hard: separate object and file per tenant | **chosen** |
| D1 per tenant | same rows rates; storage 0.75 per GB-month beyond 5 GB; 100,000 databases included | network hop to the database on every query, typically tens of ms | good | fallback and control plane only |
| One shared D1 | same rates | same hop, plus contention and scans across tenants | none by construction | rejected for tenants (this is how the scans grew) |
| Vectorize | queried dimensions = (queries + stored vectors) x dimensions, 50 M/mo included then 0.01 per million; stored 10 M included then 0.05 per 100 M; 50,000 indexes included | purpose-built ANN, a service hop | one index per tenant is possible | spill target past `maxVectors`, PLANNED |
| Embeddings in the tenant store | rows read, trivial at list prices; CPU is the real cost (about 20,000 x 384 int8 per query, an estimate of tens of ms) | no extra hop | same as the store | **default for up to `maxVectors` (20,000)** |
| R2 | 0.015 per GB-month, 10 GB free, Class A 4.50 and Class B 0.36 per million, egress free | object latency | per-tenant prefix | blobs, archives, cold rollup history |
| KV or Cache | reads 10 M/mo then 0.50 per million; writes 1 M/mo then 5.00 per million | edge-local, eventually consistent | per-tenant key prefix | hot read-through only, never the record |
| Rollups | cuts a scan of N rows to one row; cost falls roughly N-fold | one primary-key lookup | n/a | **required for any loop that reads aggregates** |

Finding that shapes the design: at list prices raw row reads are cheap (the 29 B reads in 30 days seen on one QNFO database would be about USD 4 over the 25 B included, an estimate). The failures were the free plan's 5 M reads per day, which that database exceeded about 190 times over (29 B / 30 days is about 967 M per day), and latency from scans. So the design bounds reads per statement and per day, and moves aggregates to write time, rather than merely buying more reads.

## 4. Requirements

Normative; ids are stable.

- **TS-1** Each tenant MUST have a private store reachable only through its own handle; a tenant id MUST be validated before routing.
- **TS-2** Each store MUST meter reads, writes, requests and vector dimensions per day and per month in its own tables, and MUST refuse work with `budget_exceeded` once a limit is spent. The next period resumes by itself.
- **TS-3** A statement that reads more than `perQueryReads` rows MUST be refused and charged. Indexed lookups are the normal path; scans are defects with a recorded disposition.
- **TS-4** Aggregates read by loops (counts by status, last run per job) MUST be maintained as rollups on write and read as one row.
- **TS-5** Vector search MUST run inside the tenant store up to `maxVectors`, exact cosine over int8-quantized embeddings, and MUST fail with `vector_cap` rather than grow silently.
- **TS-6** Hot reads MAY be served from a cache port and SHOULD serve the stale value when the budget is spent.
- **TS-7** A spend probe MUST turn tenant usage into a projected monthly estimate with the price date, status ok, warn or breach against the owner's ceiling, and the worst case implied by the budgets.
- **TS-8** A Durable Object adapter MUST implement the `SqlPort` and abort a runaway cursor.
- **TS-9** Past `maxVectors` a tenant SHOULD be promoted to its own Vectorize index through a `VectorPort`.
- **TS-10** Self-metered usage SHOULD be cross-checked against the platform's own analytics; a divergence over 20 percent is a finding.
- **TS-11** Core code MUST NOT import a platform; platform code lives in adapters. The SQLite adapter (`adapters/sqlite/tenant-sqlite.js`) runs the same contract on any host.

## 5. Budget profiles and the hard bound

Two profiles (`core/tenantstore/budget.js`). **Free** (the deployed default): per tenant per day 1 M reads, 15,000 writes, 15,000 requests, so five tenants stay inside the Workers Free plan's account-wide Durable Object limits of 5 M rows read, 100,000 rows written and 100,000 requests per day; the bill is USD 0 and a spent budget refuses work instead of billing. **Paid** (applies only if the owner upgrades): day 20 M reads, 200 k writes, 200 k requests; month 400 M, 3 M, 3 M. With five tenants at the full paid monthly budget the estimate is about USD 7.10 (USD 5.00 base plus 14 M requests over the included 1 M at 0.15), under the owner's USD 8 ceiling; a test fails if that stops being true. Metering is held in memory and flushed every 25 operations, so it does not burn the plan's rows-written allowance. A tenant raises its cap only by a reviewed change to its budget row.

## 6. Conformance and status

| Req | Status | Evidence |
|---|---|---|
| TS-1 to TS-8, TS-11 | BUILT, and RUNNING on the ultrastable Cloudflare account as `ultrastable-tenants` (self-test passes) | `workers/core/tenantstore/tenantstore.test.js`, `workers/adapters/cloudflare/src/tenant-do.js` (tested against a fake; not deployed to a real account) |
| TS-9, TS-10 | PLANNED | no file yet |
