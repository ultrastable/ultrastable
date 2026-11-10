# Tenant isolation design (PL-3, issue #37)

Goal: one organization's data never reaches another's. Status: design for review; the current core is single-tenant (see `platform/core/docs/security.md`, "Not yet done").

## Model
- **Tenant = org.** Every row in the product schema belongs to exactly one org. Single-org installs keep the current schema; multi-tenant hosting adds an `org_id` column to every table in `store.py`, part of each primary key.
- **Preferred isolation: database per tenant.** One SQLite file or Postgres schema per org, chosen by the org id in the request token. A bug in a query cannot cross tenants because the connection itself is scoped. Shared database with `org_id` is the fallback, enforced with Postgres row-level security keyed on a per-connection setting.
- **Identity.** Each tenant gets its own bearer token (hash stored, never the value) mapped to one org id; the server resolves org id before any query. No token, no tenant, no read.
- **Secrets.** Per-tenant bindings in the platform secret manager; agents never receive values (existing rule).
- **Executors.** A dispatch carries only that org's item and repository scope; agent credentials are minted per org and per repository, never shared.
- **Ledgers.** Trust, predictions and amendments are per org. Cross-org learning uses only explicit opt-in aggregates (counts, never rows).
- **Backups and export.** Per-tenant backup files; deleting a tenant deletes its database file or schema and its secret bindings.

## Tests required before any second tenant
1. Token for org A requesting org B's item ids returns 404.
2. A shared-database run with row-level security on: a query without the setting returns zero rows.
3. Two engines ticking concurrently write only to their own store.

## Defaults and probe
Default in effect: single tenant per deployment; no multi-tenant hosting is offered or claimed. Closing probe: the three tests above exist in `platform/core/tests/` and pass in CI.
