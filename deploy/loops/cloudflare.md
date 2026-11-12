# Cloudflare Worker cron (the always-on host)

State found 2026-11-11: Worker `ultrastable-tick` exists with an every-10-minutes cron and has run 100+ ticks against D1 `ultrastable-org`, but that D1 only held the 8 seed-template items. Its code is `seed/worker/src` (`tick.js`, `index.js`).

Point it at the real records:

    python3 -m foundation launch --export-d1 .selfhost/records.sql
    # apply with the D1 connector, or: wrangler d1 execute ultrastable-org --remote --file .selfhost/records.sql

Health: `GET /health` on the worker returns the last tick. The credential surfaces are tested by `python3 -m foundation launch --probe` (API token and account id as bindings, or the Cloudflare connector in a Claude session). New worker code deploys through the connector or a manual workflow; the cron itself costs no Actions minutes.

## Moving to the dedicated account (2026-11-11)
Target account id `81e3a4efb4eb66e613529b87682911bb` is recorded in `deploy/cloudflare-accounts.json`. Missing credential: an API token for that account (Workers Scripts Edit, D1 Edit, KV Edit) bound as `CLOUDFLARE_API_TOKEN`, or the Cloudflare connector re-authorized on that account. With it: create D1 `ultrastable-org`, apply `seed/worker/migrations`, load `launch --export-d1`, deploy the worker, then flip the `state` field. The old account keeps ticking until then.
