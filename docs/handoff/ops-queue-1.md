# OPS-QUEUE-1 handoff

Session: session_0156nqDuqSRhg3XdymKRy7AC

- Cause: a cost breach on the analytics DB (ultrastable-ops, not read by any tick step) held dispatch and execute lean, so issues stayed open.
- Fix: budgets with `gates_tick:false` are advisory (`seed/worker/src/costsample.js`); new failure mode `work-queue-stalled` in `seed/autonomy/failure-modes.json`.
- /ops: items carry an app label and filter (`site/controlplane.js` `tenantOf`).
- Closing probe: `selfaudit:work-queue-stalled`.
