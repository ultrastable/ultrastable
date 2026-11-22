---
# Level 1: a tenant system bootstrapped on Ultrastable from instance.json. Reports to its parent (tenant 0).
org_name: Second Tenant
slug: second-tenant
owner: Rowan
owner_contact: set-in-secret-store
owner_contact_backup: set-in-secret-store
parent: ultrastable
parent_health_url: https://ultrastable-tick.ultrastable.workers.dev/health
level: 1
---

# Idea

A small service that must keep running: it deploys itself on its own loop, probes its own health and files its own repairs, with no dependence on tenant 0's loops. It is generated from the seed kernel by `python3 -m foundation seedadmit --onboard instances/second-tenant/instance.json` and deployed by `deploy/deploy-seed.mjs` (SEED-DEPLOY-1) as the Worker `ultrastable-seed-second-tenant` with its own D1 database, after every platform deploy.

# System test

- Loop: its own cron tick every 10 minutes reconciles, measures and files breaches; a failed probe files its own repair, with no person in the middle
- Measure: health probe failures, target 0; tick heartbeat gaps over 20 minutes, target 0 (clock seed-second-tenant-tick)
- Upkeep: runtime, dependency and model changes keep arriving every month and reach it through every kernel merge
- Run cost: 5 USD a month for the back end

# First outcomes

- Deploy unattended on its own loop
- Probe its own health every cycle and file breaches
- Stay within a stated monthly budget
