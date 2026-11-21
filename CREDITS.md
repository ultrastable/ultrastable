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
