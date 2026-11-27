---
consumer: seed/worker/src/control.js
---
# Credits

> Ultrastable is the foundation for any autonomous system.

Ultrastable stands on published work. Each entry names the source and the code that uses it.

| Source | What Ultrastable takes from it | Code |
|---|---|---|
| W. Ross Ashby, *Design for a Brain* (1952, 2nd ed. 1960); *An Introduction to Cybernetics* (1956) | the ultrastable system: essential variables with limits and a second, step-function loop; requisite variety | `foundation/ultrastability.py`, `seed/worker/src/goals.js` |
| W. Ross Ashby, *Journal* (1928 to 1972, 7,189 pages) with its keyword and subject card indexes, published by The W. Ross Ashby Digital Archive, https://ashby.info (copyright The Estate of W. Ross Ashby; cited by page, not reproduced) | the veto of every essential variable, the step-function search, requisite variety read from the work queue, reducibility and time to adapt, joining and joint rest, cylindrance, the black-box protocol; each concept and its journal pages are in `doctrine/ashby-concepts.json` | `seed/worker/src/ashby.js`, `seed/worker/src/goals.js`, `seed/worker/src/regulation.js`, `foundation/ashbymap.py` |
| K. J. Astrom and R. M. Murray, *Feedback Systems* (Princeton, 2008; 2nd ed. 2021) | damping and anti-windup: a controller that reverses itself must slow down | `seed/worker/src/control.js` (`dampedCooldown`) |
| B. Beyer, C. Jones, J. Petoff, N. R. Murphy (eds.), *Site Reliability Engineering* (O'Reilly, 2016), ch. 3-4 | service level objectives and error budgets | `seed/worker/src/control.js` (`errorBudget`), `/goals` |
| B. Beyer et al. (eds.), *The Site Reliability Workbook* (O'Reilly, 2018), ch. 5 | multiwindow, multi-burn-rate alerting (14.4x/1 h, 6x/6 h, 1x/3 d) | `seed/worker/src/control.js` (`BURN_RULES`) |
| D. R. Swanson, "Fish oil, Raynaud's syndrome, and undiscovered public knowledge" (1986) | literature-based discovery (ABC closure) for novel connections | `workers/core/connect` |
| M. Chen et al., "Evaluating Large Language Models Trained on Code" (HumanEval, 2021); OpenAI Evals (2023) | golden-set regression evals for the code executor's patch step | `foundation/evals.py`, `evals/executor/apply_edit.json` |
| SLSA v1.0 (OpenSSF, 2023); GitHub, "Security hardening for GitHub Actions"; OpenSSF Scorecard, Pinned-Dependencies | actions pinned to full commit SHAs, shrink-only baseline | `foundation/actionpins.py`, `doctrine/supply-chain.json` |
| J. O. Kephart and D. M. Chess, "The Vision of Autonomic Computing", IEEE Computer 36(1), 2003 (MAPE-K) | the tick's monitor, analyse, plan, execute steps over shared knowledge (D1) follow this loop shape | `seed/worker/src/tick.js` (`STEP_ORDER`) |
| S. Beer, *Brain of the Firm* (1972) and *The Heart of Enterprise* (1979) (Viable System Model) | not yet implemented; the recursion of systems in VISION.md (layers) is the nearest match | `docs/doctrine/VISION.md` |
| N. Rosenthal and C. Jones, *Chaos Engineering* (O'Reilly, 2020); Netflix Chaos Monkey | exercised failure paths and canary revert | `platform/cloudflare-reference/scripts/canary_revert.py` |
