<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# packs/analytics: privacy-first page counts

Class A pack (`US-SPEC-21`): no outbound channel. `recordPageview({db, now, settings, request})` stores path (no query), referrer host and `utm_*` tags with a daily-rotating visitor hash (`sha256(salt|day|ip|ua)`); no IP, cookie or raw user agent. Bots, Do Not Track and Global Privacy Control are skipped.

| Loop | Does |
|---|---|
| `rollup` | idempotent daily totals per page and per source |
| `retention` | rolls up, then deletes raw events older than `raw_retention_days` (7) |
| `metrics` | views in 7 days, visitors today, raw event count |

`report({db, days})` gives views, top pages and top sources. Secret by name only: `ANALYTICS_SALT`. Tests: `analytics.test.js`.

## Search presence

The `search` loop reads search-engine analytics through a read-only port the host supplies (`settings.ports.search_analytics({ from, to, hosts }) -> [{ date, page, clicks, impressions, position }]`) and stores one row per page and day in `analytics_search`; a row whose page carries a query string or fragment is dropped, and no query text is ever stored. With no port configured the loop only notes it. A real provider adapter needs the owner's search property and an access token, so it is not written here (PLANNED; the account step is the owner's). Tests: `analytics.test.js`.
