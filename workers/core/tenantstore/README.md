<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/tenantstore: sandboxed, budget-capped tenant data

Implements US-SPEC-25 (tenant storage). One private store per tenant behind a `SqlPort`; every statement is metered; a spent budget refuses work instead of billing.

| Requirement | Status | Where |
|---|---|---|
| TS-1 US-25-R01 one private store per tenant, reached only through its own handle | BUILT: ids validated before routing; the store pins its first tenant id in `_tenant` and refuses another (R12) | `store.js`, `adapters/cloudflare/src/tenant-do.js` (`tenantStub`) |
| TS-2 US-25-R02 day and month budgets for reads, writes, requests, vector dimensions, refused past the cap | BUILT for the budgets and for callers whose refused statements stop at their caps; a refusal arms no alarm and writes no row. The worst case when a scanning write runs to completion before its caps are read (the Durable Object adapter) is PLANNED: the SQLite adapter refuses such a write on its plan before it runs | `budget.js`, `adapters/sqlite/tenant-sqlite.js`, test "write budget is a hard cap" |
| TS-3 US-25-R03 scans refused (per-query read cap), indexed reads stay cheap | BUILT for reads and for writes that scan or write too much (rolled back where the adapter can), and one statement per call (a text of several is refused with `multiple_statements` before it runs) | `store.js`, `sqlclass.js`, `adapters/sqlite/tenant-sqlite.js`, test "full-table scan" |
| TS-4 US-25-R04 rollups maintained on write, read as one row | BUILT | `rollup.js` |
| TS-5 US-25-R05 vector search in the tenant store, int8, capped by `maxVectors` | BUILT; the count is a one-row counter (R14) | `vector.js` |
| TS-6 US-25-R06 hot reads from a cache port, stale value served when the budget is spent | BUILT as a library; the deployed Worker has no `HOT_KV` binding | `store.js` `cached` |
| TS-7 US-25-R07 spend probe and worst-case bound from list prices | BUILT (estimates, see `prices.json` `as_of`); plan-aware (R17) | `spend.js`, `prices.js` |
| TS-8 US-25-R08 Durable Object adapter | BUILT, and deployed as `ultrastable-tenants` from the vendored copy `tenants/` (`ops/deploys.jsonl`); the copy is checked by `../tests/foundation/test_spec_25_tenant_copy.py` | `adapters/cloudflare/src/tenant-do.js`, `adapters/cloudflare/src/tenant-do.test.js` |
| TS-9 US-25-R09 promotion to a per-tenant Vectorize index past `maxVectors` | BUILT through a `VectorPort` with a fake index; the index and binding are an account step (gate `tenant-vectorize`, default: local mode and `vector_cap`) | `vectorport.js`, `core/discover` (the port shape) |
| TS-10 US-25-R10 cross-check of self-metered usage against platform analytics | BUILT as a pure comparison; the live platform reading (`../seed/worker/src/spend.js` `usageQuery`) is wired by the seed tick | `crosscheck.js`, `../seed/worker/src/spend.js` |
| TS-11 US-25-R11 core imports no platform | BUILT, asserted by a test over this directory | `tenantstore.test.js` |
| US-25-R12 / R13 one tenant per object; per-tenant halt and `HALT=1` | BUILT | `store.js`, `adapters/cloudflare/src/tenant-do.js` |
| US-25-R14 every statement the store issues is metered or exempt by a stated constant | BUILT | `vector.js`, `store.js` header |
| US-25-R15 storage ceiling and statement write cap | BUILT | `budget.js` `checkWrite`, `store.js` |
| US-25-R16 client handle for tenant apps | BUILT | `client.js`, `spend-route.js` |
| US-25-R17 plan-aware estimate with the worst case | BUILT | `spend.js` |
| US-25-R21 metering survives an eviction | BUILT: `TenantStore.flush()`; the Durable Object arms an alarm after the first unflushed operation of a burst (never sooner than `MIN_FLUSH_DELAY_MS`) and flushes from it; each alarm is charged to the tenant's own budget (its setAlarm row by `chargeAlarm`, its request and flush rows by `chargeFlush`), a refusal arms none, and `worstCaseDay` bounds five Free tenants inside the plan's daily limits for callers whose refused statements stop at their caps (see TS-2) | `store.js`, `budget.js`, `adapters/cloudflare/src/tenant-do.js` |
| TS-12 US-25-R22 a tenant Worker binds only its own stores | BUILT in the platform | `../foundation/tenantrepos.py` (`isolation`), `../tests/foundation/test_spec_25_tenant_storage.py` |
| TS-13 US-25-R23 the control plane acts only on the runtime's own tenant rows | BUILT in the seed | `../seed/worker/src/tenant.js`, `../seed/worker/test/spec-25-control-plane.test.js` |
| TS-14 US-25-R24 the storage decision and budgets are declared as data and bounded by the ceiling | BUILT in the platform | `../doctrine/tenant-storage.json`, `../foundation/tenantstorage.py`, `../tests/foundation/test_spec_25_tenant_storage.py` |
| Statement classification (R03, R15) and the Vectorize worst case (R07) | BUILT: a `WITH ... INSERT` is a write, also when a string holds `--` or `/*` (one left-to-right scan, `stripSql`); a `CREATE TABLE ... AS SELECT` is metered on the SQLite adapter; `worstCase` and `probe` cost Vectorize queried dimensions when a binding exists or a tenant is promoting; `maxVecDimsMonth`. Vectorize stored dimensions are not costed yet | `sqlclass.js`, `adapters/sqlite/tenant-sqlite.js`, `spend.js` |

Duration (GB-s) is modelled only when a caller passes `gbSeconds`; request-unit rounding is not modelled. The probe is an estimate, never a bill.

Wrangler (Cloudflare adapter): `durable_objects.bindings = [{ name = "TENANT", class_name = "TenantDO" }]` and `migrations = [{ tag = "v1", new_sqlite_classes = ["TenantDO"] }]`. Per-tenant budgets go in the `TENANT_BUDGETS` variable as JSON keyed by tenant id.

Test: `node --test --no-warnings core/tenantstore/*.test.js adapters/cloudflare/src/tenant-do.test.js`.
