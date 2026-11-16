---
consumer: foundation/tenantstorage.py
---
# Tenant storage (TENANT-STORAGE-1)

> Ultrastable is the foundation for any autonomous system.

Normative text: `US-SPEC-25` in the spec repo. Data and migration plan: `doctrine/tenant-storage.json`. Code: `core/tenantstore` and its adapters in the workers repo. Estimates use list prices dated in the data file.

Each tenant app owns one SQLite-backed Durable Object (the sandbox), metered by a budget guard that refuses work past its day and month limits, so the Cloudflare bill has a computable ceiling: five tenants at full budget is about USD 7.10 on the USD 5 Workers Paid base (estimate). Aggregates are rollups written with the data, vectors live in the tenant store up to 20,000 and then spill to a per-tenant Vectorize index, blobs go to R2, hot reads to KV or Cache. The control plane stays in one small D1.
