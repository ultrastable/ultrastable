# core/impact

IMPACT-LOOP-1. A tenant-agnostic closed loop that raises a system's own impact and reach numbers: `record` keeps a daily series per metric, `assess` finds
met / rising / plateau / falling, `plan` asks the tenant's levers for bounded, deduplicated work items that each carry a prediction, `settle` grades those
predictions against later readings, and `weights` ranks levers by their kept rate. Pure functions; the tenant reads its metrics and files the items.
An item that failed twice is decomposed by its lever's `split` into smaller children (the `failures` argument), so an oversized item never blocks the loop. Tests: `impact.test.js`.
