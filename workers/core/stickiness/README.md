# core/stickiness

STICKY-1: a reason to come back, for every app, tenant and platform. Tenant-agnostic and pure. A caller passes entries that already exist and gets back freshness, breadth, depth and diversity (`measure`), a plan that names the metric each action should move with a checkable prediction (`plan`), a daily series and its trend (`record`, `trend`), feeds and a "what's new" page that marks what is new since the reader's last visit (`toRss`, `toJsonFeed`, `fromJsonFeed`, `whatsNew`) and a social queue in plain words for the core social module (`queue`). A system with no entries is unmeasured, never fresh, and a missing audience count is never read as a return rate.

| Piece | Status | File | Test |
|---|---|---|---|
| measure, plan, record, trend, toRss, toJsonFeed, fromJsonFeed, whatsNew, queue | BUILT | index.js | stickiness.test.js |
