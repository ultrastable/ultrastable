---
name: observer-probe
description: Use weekly per partition to inject one bounded, reversible disturbance and record whether EVs recover, so stability claims are tested rather than assumed.
metadata: {kernel: "9.2.0"}
---
1. Pick a disturbance from `probes` in doctrine/step-repertoire.json for this partition.
2. Record the probe in the ledger before injecting; never in a path marked `no_probe`.
3. Observe EVs for trial_ticks. Record `recovered` or `not_recovered` and the time to recovery.
4. `not_recovered`: disposition `flagged`; the partition's ultrastability claim is unverified until a later probe recovers.
