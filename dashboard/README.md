# Ultrastable dashboard (DASH-1)

Owner dashboard plus a generic public holding page, one Cloudflare Worker (`worker.js`) with a D1 database (`schema.sql`).
Modeled on the QNFO fleet dashboard (qnfo-fleet-dashboard), cut down to the parts the platform claims.

## What it does
- **Email-me-a-code login** (`/owner`): a 6-digit code goes to the owner address only (no address input, so nothing to abuse). Codes are stored hashed, last 10 minutes, five wrong tries burn them, five requests per 10 minutes. Session cookie is HttpOnly, Secure, SameSite=Strict, 30 days.
- **Step-up for changes**: reading is free once signed in; anything that changes state needs a code from the last 15 minutes. The page asks for it in place and repeats the tap after Verify.
- **At-a-glance status**: checks for the database, owner mail, each of the three domains and GitHub, refreshed hourly by cron and on demand (`probe`).
- **Owner task queue**: items only the owner can do (marked identity-bound) come first, each with why and what happens if you wait. One tap each: Done, Snooze 3 or 7 days, Not doing, Hand to fleet / Fix it.
- **Fleet queue**: Hand to fleet writes a queue row (and labels the GitHub issue `fleet` when a token is set). Agents read and acknowledge it at `/api/fleet/queue` and `/api/fleet/ack` with a `FLEET_TOKEN` bearer (endpoint stays off until that secret exists).
- **Commands from the dashboard**: a registered-command line (`help`, `status`, `tasks`, `task`, `probe`, `done`, `snooze`, `dismiss`, `delegate`, `fix`, `sync`, `dispatch`, `note`, `notify-test`, `audit`, `undo`). The buttons run the same commands, so every action is audited and undoable. No arbitrary shell.
- **Plain-English console agent (CONSOLE-AGENT-1)**: a line that is not a registered command goes to `agent.js`, a short tool loop on the Workers AI binding (the adapters of the tick worker's code agent, cheapest first). It reads with `sql` (one SELECT over `hits`, `tasks`, `checks`, `audit`, `fleet_queue`, `notifications`, `analytics_meta`; never `sessions` or `otp`; at most 100 rows) and runs registered commands. Any session can ask; commands that change things run only with a code emailed in the last 15 minutes, through the same audited, undoable path, and the page says whether the session is read-only or can change things. It always ends in a text answer: a synthesis pass over its tool results, then a digest of them. At most 60 requests an hour. Tests: `test/agent.test.mjs`.
- **Audit log with undo**: every command is recorded with its result and, for state changes, how to reverse it.
- **Owner email notifications**: failing checks, new owner items (grouped) and a daily digest at 13:00 UTC, de-duplicated by key and logged on the page.

- **Web analytics (ANALYTICS-1)**: first-party, cookieless, counted server-side on the holding page and by `/a.js` + `/a/e` beacon for any registered host. Panel on `/owner`, `analytics` command, daily digest section, owner email on a metric breach (`hit = 1`), 10-minute collector self-check as a guard. Module and metric registry: `seed/analytics/analytics.js` (shared with the seed worker, so every new org inherits it). Test: `seed/worker/test/analytics.test.js`.

## Public side
`/` serves a generic holding page, noindex, and `robots.txt` disallows everything. The fuller site stays in `site/` (not deployed).

## Deploy (Cloudflare)
D1 `ultrastable-ops`, worker `ultrastable-dashboard`, bindings DB, AI (Workers AI, for the console agent), SEND_EMAIL (destination restricted to the owner address), vars OWNER_EMAIL, MAIL_FROM, GITHUB_REPO; cron `*/10 * * * *` (the daily digest rides the first tick of 13:00 UTC, CRON-GRID-1); custom domains ultrastable.io, ultrastable.app, ultrastable.net (and www.ultrastable.io). `wrangler.toml` has the shape; ids are filled in at deploy. Optional secrets: `GITHUB_TOKEN` (sync, label, dispatch), `FLEET_TOKEN`.

## Portability
The core touches the platform only through `env.DB` (SQL), `env.SEND_EMAIL` (mail) and `fetch`. A Google Cloud adapter (Cloud Run + Cloud SQL or Firestore + a mail API) supplies those three; nothing else is Cloudflare-specific.

## Hosting from GitHub
GitHub Pages cannot run this: it serves static files only, so there is no login, database, cron or mail. The static holding page alone could live on Pages; the dashboard needs a runtime. Staying on Cloudflare (or Cloud Run on GCP) for now.

## Tests
`node --test test/dashboard.test.mjs` (Node 22, uses node:sqlite as a D1 stand-in).
