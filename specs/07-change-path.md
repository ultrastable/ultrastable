# 07 Change path

## Purpose
Every change to code or rules arrives the same way, so work is reviewable and reversible.

## Procedure
1. Claim the item. Work on branch `agent/<item>-<slug>`; open a draft PR within minutes.
2. Checkpoint after each stage: commit and update `docs/handoff/<slug>.md`; an unpushed stage is lost.
3. Review by a different agent (ideally a different model family) with verbatim evidence; a review includes at least one plus.
4. Checks pass; a hold, written by code and not by a person, blocks merge on a failure.
5. Deploy under a lock; run probes; on a failed probe revert automatically (canary then revert).
6. Record outcome against the prediction; release the claim with the next step.

## Invariants
Fenced claims reject stale writers. Never skip, disable or quarantine a test to get green. No new scheduled workflows beyond the budget (`scripts/lint_workflows.py`, `actions-budget.json`).

## Reference implementation
`.github/workflows/checks.yml`, `scripts/lane.sh`, `scripts/llm_review.py`, `scripts/lint_workflows.py`, deploy guard in `platform/cloudflare-reference/`.

## Status
BUILT here; RUNNING in QNFO.
