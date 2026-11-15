---
# Level 1: a customer-shaped system bootstrapped on Ultrastable. Demo child that reports to its parent (tenant 0).
org_name: Demo Child
slug: demo-child
owner: Rowan
owner_contact: set-in-secret-store
parent: ultrastable
parent_health_url: https://ultrastable-ultrastable.q08.workers.dev/health
workers_dev: true
public_health_only: 1
---

# Idea

A compliance desk that tracks changes to the rules a product is subject to, updates controls and evidence, and reports what is out of date every week. It exists to prove a system built on Ultrastable reports to its parent.

# System test

- Loop: new rule published, control updated, evidence re-checked, no person in the middle
- Measure: controls out of date, target 0
- Upkeep: rules change every week
- Run cost: 5 USD a month for the back end

# Who it is for

- A compliance owner

# First outcomes

- Controls and evidence are never more than a week out of date

# Constraints

- Budget per month: 5
- Nothing public except the runtime's own /health
