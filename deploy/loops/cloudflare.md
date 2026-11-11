# Cloudflare Worker cron (the always-on host)

State found 2026-11-11: Worker `ultrastable-tick` exists with an every-10-minutes cron and has run 100+ ticks against D1 `ultrastable-org`, but that D1 only held the 8 seed-template items. Its code is `seed/worker/src` (`tick.js`, `index.js`).

Point it at the real records:

    python3 -m foundation launch --export-d1 .selfhost/records.sql
    # apply with the D1 connector, or: wrangler d1 execute ultrastable-org --remote --file .selfhost/records.sql

Health: `GET /health` on the worker returns the last tick. The credential surfaces are tested by `python3 -m foundation launch --probe` (API token and account id as bindings, or the Cloudflare connector in a Claude session). New worker code deploys through the connector or a manual workflow; the cron itself costs no Actions minutes.
