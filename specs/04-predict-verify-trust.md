# 04 Predict, verify, trust, interrupt gate

## Purpose
Grant autonomy by evidence, and interrupt a person only when something cannot be undone.

## Concepts
- **Prediction**: before acting, the actor logs a checkable statement `<metric> <op> <number> within <N> h`.
- **Outcome**: after verification through an independent path, the result is recorded `verified | failed | silent_drop | hidden_failure`; the scorer grades the prediction later.
- **Trust**: computed per (surface, action class). `reliability = (verified_successes + 0.5 × 2) / (outcomes + 2)`; decays 0.01 per idle day (`autonomy/policy.json` `trust`).
- **Ladder**: observed → assisted → delegated → autonomous → self-directed → self-modifying → self-extending. Promote at ≥10 outcomes, reliability ≥ 0.8 and no hidden failure for 14 days; demote below 0.6 or on hidden failure, silent drop or gate bypass.
- **Interrupt gate**: pause only when an action is both irreversible and identity-bound (money, signing or filing, destroying unbacked data, sending as the owner, minting the owner's credentials) with no engineerable reversible path. First try backup, branch, draft, preview, canary. The card carries: what, why gated, default in effect, what the system prepared, closing probe. Then take the next item.

## Invariants
1. Trust widens only the system's own loop scopes, and only by a reviewed PR to the policy. It never reaches harness permissions, secrets, the interrupt gate or standing limits.
2. Standing limits always win: the harness's permission checks, classifier refusals, the secret lock, outreach consent and opt-out, the owner's override, another session's live claim.
3. A refusal is an input: state it with its reason, record it, take the next path; never reword or re-route the same action past the same check.
4. No agent reviews its own work; where possible a different model family verifies.

## Reference implementation
`seed/autonomy/policy.json`, `seed/worker/src/tick.js` (`reliability`, `score_predictions`, `accrue_trust`), consistency test `seed/tests/test_seed.py`, `platform/core/ultrastable/engine.py`.

## Status
BUILT; the QNFO ledger is RUNNING (self-scored, unaudited).
