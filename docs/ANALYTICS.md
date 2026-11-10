# Analytics standard (ANALYTICS-1)

Every Ultrastable-built system measures itself from day one. The standard lives in `seed/analytics/` and ships with every seed; the dashboard imports the same file.

| Part | Where |
|---|---|
| Collector, beacon, scoreboard, registry | `seed/analytics/analytics.js` |
| Schema (`hits`, `analytics_meta`) | `seed/analytics/schema.sql` (also `seed/worker/migrations/0002_analytics.sql`, `dashboard/schema.sql`) |
| Add to any site | `<script defer src="https://HOST/a.js"></script>`; add HOST to `ANALYTICS_HOSTS` |
| Owner view | `/owner` Web analytics panel, `analytics` command, daily digest |
| Agent view | `GET /api/analytics` with bearer `ANALYTICS_TOKEN` (seed worker) |
| Backlog item | `KIT-7` (bootstrap) |

Privacy: first-party, cookieless, no IP stored, visitor id is a per-day hash that cannot be linked across days, Do Not Track and Global Privacy Control honored, no third-party script.

Scoreboard (judged by `hit`, not by raw value): targets `pageviews_7d`, `visitors_7d`, `referral_share_7d`, `pageviews_30d`, `referral_30d`; guards `collector_selfcheck` (synthetic hit every 10 min), `bot_share_7d`. Rule: a new metric is registered with a trigger or a named exemption together (enforced by test). A breach is an item with an owner, a prediction and a closing probe; it is never closed by loosening the trigger.

Verify: `cd seed/worker && npm test`; live: the `collector_selfcheck` metric reads 1 after the first cron tick.
