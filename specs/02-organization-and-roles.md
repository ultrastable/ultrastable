# 02 Organization and roles

## Purpose
Give autonomous agents the structure of a working organization so they stop handing decisions back, losing track of work and drifting into bug fixing.

## Concepts
- **Role**: a named function with an instruction file (`agents/roles/*.md`), a tick cadence and a model rung. Roles are configuration, so any org chart can map onto them (`platform/core/ultrastable/orgchart.py`).
- **Hierarchy**: portfolio manager (allocates a bounded number of focus slots across projects, part evenly, part by risk), project managers (one per outcome; rank work, write priority records), product managers (own the improvement loop, spec 05), staff (execute), reviewer (independent verification), operations (deploy and probes). Additional roles: funding, outreach (extensions).
- **Persona record**: role, program, metric, and the enumerated operations the role may perform. A tool layer SHOULD deny operations not in the record by requester identity.

## Records
`roles(id, role, project, tick_every, model, last_tick_at)`, `items`, `claims`, `gate_cards`, `predictions`, `outcomes`, `trust_ledger`, `dispatches`, `tick_runs`, `doctrine_lineage` (seed/worker/migrations/0001_init.sql).

## Procedure
1. The portfolio manager computes risk per program (a weighted sum of high-severity items, open items, guard breaches and stalled projects) and allocates slots.
2. Project managers rank candidates: items tied to a primary metric first, then guard metrics, then by severity and age, and write priority records with the writer's id (a manager deletes only its own rows).
3. The queue score is `impact × probability × (capability_gain + reach_gain) × (1 / remediation_cost) × trust × (1 + direction)`.
4. Staff take items in queue order through the change path (spec 07). The reviewer never reviews its own work (spec 04).

## Invariants
1. Every item has an owner role, a trigger and a closing check.
2. No role reviews its own output.
3. Reducing the reserved improvement share needs a config record with an expiry (spec 05).

## Reference implementation
Role files and config in `seed/`; `platform/core/ultrastable/engine.py` and `orgchart.py`; QNFO live SQL views in `platform/cloudflare-reference/` (see archive Family A).

## Status
Hierarchy and queue: RUNNING in QNFO, BUILT portable (simplified). Identity-based denial at the tool layer: PLANNED.
