# Path: GitHub

GitHub is a mirror and a convenience, not the system of record. Items live in `docs/issues/`; `.github/workflows/issues.yml` mirrors them. Review, merge and CI run there today (gap SG-1; closing probe `file:seed/worker/src/forge.js`). Minimal Actions minutes: `checks.yml` is the only PR gate; no new scheduled workflows (`actions-budget.json`, `scripts/lint_workflows.py`).
