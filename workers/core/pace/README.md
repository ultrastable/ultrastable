# core/pace

Speed at near-zero cost, tenant-agnostic. A tenant lists its loops (cadence, cost per run in named resources, runs and outputs in the recent window) and the free daily limits of those resources. `plan()` returns the cadence each loop should run at: idle loops back off, productive loops speed up while every resource stays under 60% of its free limit, event-triggered loops poll only as a fallback. `metrics()` gives progress per run and cost per day; `breaches()` returns what a tenant loop files as items; `rank()` orders work by reach x impact x probability per unit cost.

| Piece | Status | File | Test |
|---|---|---|---|
| usage, metrics, plan, rank, breaches | BUILT | index.js | pace.test.js |
