---
consumer: doctrine/decision-ledger.json
---
# ULTRASTABLE-LITE-1: the `/webmention` receiver is written and not yet served

Read from the code on main on 2026-11-26, so the words match what runs:

- `site/lite.js` (merged as #2566 for the item Q-IMPROVE-webmention) defines the receiver for `POST /webmention`. It requires `source` and `target`, requires the target host to be one of the site's own, fetches the source page, requires that the page links to the target, and records the source in `site_data` under the collection `webmentions`.
- Nothing mounts it. `site/worker.js` does not import `site/lite.js`, so no request reaches the handler and `/webmention` answers like any unknown path. The file also does not parse as an ES module as written: it uses `await` inside a function that is not `async`.
- The closing probe of Q-IMPROVE-webmention (`grep:site/worker.js::webmention`) therefore cannot pass. The item was closed on the change to `site/lite.js` alone.

Disposition: `docs/issues/Q-LITE-webmention-wire.json` carries the fix (make the handler `async`, mount it for `POST /webmention` in `site/worker.js`, test it, then bring this note up to date) with a probe that reads the router. The executor takes it in driver order. Until it lands, this note is the statement of what the route does.
