---
consumer: seed/worker/src/control.js
---
# Credits

> Ultrastable is the foundation for any autonomous system.

Ultrastable stands on published work. Each entry names the source and the code that uses it.

| Source | What Ultrastable takes from it | Code |
|---|---|---|
| W. Ross Ashby, *Design for a Brain* (1952, 2nd ed. 1960); *An Introduction to Cybernetics* (1956) | the ultrastable system: essential variables with limits and a second, step-function loop; requisite variety | `foundation/ultrastability.py`, `seed/worker/src/goals.js` |
| K. J. Astrom and R. M. Murray, *Feedback Systems* (Princeton, 2008; 2nd ed. 2021) | damping and anti-windup: a controller that reverses itself must slow down | `seed/worker/src/control.js` (`dampedCooldown`) |
| B. Beyer, C. Jones, J. Petoff, N. R. Murphy (eds.), *Site Reliability Engineering* (O'Reilly, 2016), ch. 3-4 | service level objectives and error budgets | `seed/worker/src/control.js` (`errorBudget`), `/goals` |
| B. Beyer et al. (eds.), *The Site Reliability Workbook* (O'Reilly, 2018), ch. 5 | multiwindow, multi-burn-rate alerting (14.4x/1 h, 6x/6 h, 1x/3 d) | `seed/worker/src/control.js` (`BURN_RULES`) |
| D. R. Swanson, "Fish oil, Raynaud's syndrome, and undiscovered public knowledge" (1986) | literature-based discovery (ABC closure) for novel connections | `workers/core/connect` |
| M. Chen et al., "Evaluating Large Language Models Trained on Code" (HumanEval, 2021); OpenAI Evals (2023) | golden-set regression evals for the code executor's patch step | `foundation/evals.py`, `evals/executor/apply_edit.json` |
| SLSA v1.0 (OpenSSF, 2023); GitHub, "Security hardening for GitHub Actions"; OpenSSF Scorecard, Pinned-Dependencies | actions pinned to full commit SHAs, shrink-only baseline | `foundation/actionpins.py`, `doctrine/supply-chain.json` |
| J. O. Kephart and D. M. Chess, "The Vision of Autonomic Computing", IEEE Computer 36(1), 2003 (MAPE-K) | the tick's monitor, analyse, plan, execute steps over shared knowledge (D1) follow this loop shape | `seed/worker/src/tick.js` (`STEP_ORDER`) |
| S. Beer, *Brain of the Firm* (1972) and *The Heart of Enterprise* (1979) (Viable System Model) | not yet implemented; the recursion of systems in VISION.md (layers) is the nearest match | `docs/doctrine/VISION.md` |
| N. Rosenthal and C. Jones, *Chaos Engineering* (O'Reilly, 2020); Netflix Chaos Monkey | exercised failure paths and canary revert | `platform/cloudflare-reference/scripts/canary_revert.py` |
| B. Sharp, *How Brands Grow* (Oxford, 2010), Ehrenberg-Bass Institute (double jeopardy; mental and physical availability) | AUDIENCE-1: reach and breadth come before loyalty; small audiences are also less loyal, so the loop grows breadth and diversity of content and channels first | `seed/scripts/audience.py` (`breadth`, `content_diversity`) |
| K. Kelly, "1,000 True Fans", *The Technium* (2008) | AUDIENCE-1: a returning core (feed subscribers, followers) is the asset; measured as growth, never typed | `seed/scripts/audience.py` (stage `return`) |
| N. Eyal, *Hooked: How to Build Habit-Forming Products* (2014) (trigger, action, variable reward, investment) | AUDIENCE-1: each system declares a hook a reader acts on (a quiz, a tool, a live result) and fresh content is the external trigger; the variable reward is new results, not dark patterns | `seed/analytics/analytics.js` (`ultrastableEvent`), `doctrine/audience.json` (`hooks`) |
| A. Chen, *The Cold Start Problem* (2021); B. Balfour, "Retention curves" (Reforge, 2017) | AUDIENCE-1: retention is judged as a series that must flatten or rise, so return metrics are judged against their own reading N days earlier | `seed/scripts/audience.py` (`op: grows`) |
| A. Singhal, Google Search "freshness" ranking update (2011); IndexNow protocol (2021); WebSub (W3C Recommendation, 2018) | AUDIENCE-1: fresh content is found faster; every section has a freshness limit and a producer the loop runs when it goes stale, and feeds ping hubs | `foundation/audience.py` (`refresh`), `site/progress.js` (hub link) |
| F. F. Reichheld, *The Loyalty Effect* (Harvard Business School Press, 1996) | AUDIENCE-1: keeping readers compounds more than winning new ones; return stage targets ratchet up when they hold | `seed/scripts/audience.py` (`ratchet`) |
| Feed aggregators' fetcher convention ("N subscribers" in the user agent: Feedly, Inoreader, NewsBlur) | AUDIENCE-1: subscriber counts read from feed requests with no tracking | `seed/analytics/analytics.js` (`subscribersOf`) |
