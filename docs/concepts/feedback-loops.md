# Feedback loops and trust

## The tick
Work runs on a heartbeat. Each tick: reconcile state, pull the highest-priority item, dispatch or execute, verify independently, compare the outcome with the prediction logged beforehand, record provenance, update trust, report.

## Predictions
Before a decision runs, the agent records a checkable prediction (for example "error rate below 1% within 24 h"). A scorer checks it later. Calibration per agent is a first-class metric.

## Trust ledger
Trust is computed per (surface, action class) from recorded outcomes, starting from a neutral prior. It rises with verified autonomous results and falls with silent drops, hidden failures and unnecessary hand-backs. Rising trust widens an agent's scope along a ladder (observed, assisted, delegated, autonomous, self-directed), always through reviewed changes, and never past the human approval gate.

## Self-correction
Repeated failure patterns and friction from people are collected, turned into proposed rule changes, tested against past ticks and adopted by review. The operating doctrine is versioned like code.
