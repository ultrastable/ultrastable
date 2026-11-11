# 11 Models and routing

## Purpose
Use the cheapest model that is capable enough, and never let a model judge its own work.

## Concepts
- **Ladder**: rungs small, medium, large; each role asks for a rung and the adapter maps it to a model (`ultrastable.json` model ladder).
- **Capability before price**: a model is admitted only after it passes calibration; then cost orders the choices.
- **Cascade**: try the cheaper rung, verify, escalate on failure; a verifier from a different model family checks consequential work.
- **Caps and degradation**: spend caps degrade gracefully to a free fallback; context economics are measured.

## Invariants
Doer and reviewer differ (family where possible). No model sees a secret value. Model identity MUST NOT be written into committed artifacts. Spend is bounded by a configured budget with a kill switch.

## Reference implementation
`platform/core/ultrastable/agents.py` (different-family pairing, Vertex adapter), Workers AI proof (PR #88), QNFO router in `platform/cloudflare-reference/` (qnfo-ai); archive §35-37.

## Status
Routing RUNNING in QNFO; portable ladder BUILT, one real-model proof.
