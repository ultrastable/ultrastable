---
name: ev-breach-step
description: Use when an essential variable has been out of limits for persist_ticks or more. Selects, trials and commits or rolls back one vetted step-function.
metadata: {kernel: "9.2.0"}
---
1. Confirm the breach from the reading ledger, not from memory; a missing reading counts as breach.
2. Check budget and cooldown in doctrine/step-repertoire.json against recorded steps; exhausted means disposition `deferred_budget`.
3. Candidates = steps listing this partition, minus veto_classes, minus steps rolled back for this EV in the last 7 days.
4. With probability 1-epsilon take the step whose `predicts` matches the breached EV; otherwise a uniform draw among candidates.
5. Snapshot the config to the blob store and record the step with its prediction (outcome `trial`).
6. Apply it. Touch no other partition.
7. After trial_ticks: all EVs of the partition inside limits means `commit`; otherwise restore the snapshot (`rollback`).
8. Two rollbacks for one EV in 24 h: disposition `flagged` with both step ids. Propose repertoire additions as a gate row; never widen the repertoire yourself.
