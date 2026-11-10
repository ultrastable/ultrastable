# Ultrastable dashboard (DASH-1)

Owner dashboard plus a generic public holding page, one Cloudflare Worker (`worker.js`) with a D1 database (`schema.sql`).
Modeled on the QNFO fleet dashboard (qnfo-fleet-dashboard), cut down to the parts the platform claims.

## What it does
- **Email-me-a-code login** (`/owner`): a 6-digit code goes to the owner address only (no address input, so nothing to abuse). Codes are stored hashed, last 10 minutes, five wrong tries burn them, five requests per 10 minutes. Session cookie is HttpOnly, Secure, SameSite=Strict, 30 days.
- **Step-up for changes**: reading is free once signed in; anything that changes state needs a code from the last 15 minutes. The page asks for it in place and repeats the tap after Verify.
- **At-a-glance status**: checks for the database, owner mail, each of the three domains, the disclosure guard and GitHub, refreshed every 10 minutes by cron and on demand (`probe`).
- **Owner task queue**: items only the owner can do (marked identity-bound) come first, each with why and what happens if you wait. One tap each: Done, Snooze 3 or 7 days, Not doing, Hand to fleet / Fix it.
- **Fleet queue**: Hand to fleet writes a queue row (and labels the GitHub issue `fleet` when a token is set). Agents read and acknowledge it at `/api/fleet/queue` and `/api/fleet/ack` with a `FLEET_TOKEN` bearer (endpoint stays off until that secret exists).
- **Commands from the dashboard**: a registered-command line (`help`, `status`, `tasks`, `task`, `probe`, `done`, `snooze`, `dismiss`, `delegate`, `fix`, `sync`, `dispatch`, `note`, `notify-test`, `audit`, `undo`). The buttons run the same commands, so every action is audited and undoable. No arbitrary shell.
- **Audit log with undo**: every command is recorded with its result and, for state changes, how to reverse it.
- **Owner email notifications**: failing checks, new owner items (grouped) and a daily digest at 13:00 UTC, de-duplicated by key and logged on the page.
- **Disclosure guard**: a check that fetches the public home page and fails if it contains any mechanism word (list in `worker.js`). Enforces project rule PF-1 until the provisional is filed.

## Public side
`/` serves a generic holding page, noindex, and `robots.txt` disallows everything. The fuller site stays in `site/` (not deployed).

## Deploy (Cloudflare)
D1 `ultrastable-ops`, worker `ultrastable-dashboard`, bindings DB, SEND_EMAIL (destination restricted to the owner address), vars OWNER_EMAIL, MAIL_FROM, GITHUB_REPO; crons `*/10 * * * *` and `0 13 * * *`; custom domains ultrastable.io, ultrastable.app, ultrastable.net (and www.ultrastable.io). `wrangler.toml` has the shape; ids are filled in at deploy. Optional secrets: `GITHUB_TOKEN` (sync, label, dispatch), `FLEET_TOKEN`.

## Portability
The core touches the platform only through `env.DB` (SQL), `env.SEND_EMAIL` (mail) and `fetch`. A Google Cloud adapter (Cloud Run + Cloud SQL or Firestore + a mail API) supplies those three; nothing else is Cloudflare-specific.

## Hosting from GitHub
GitHub Pages cannot run this: it serves static files only, so there is no login, database, cron or mail. The static holding page alone could live on Pages; the dashboard needs a runtime. Staying on Cloudflare (or Cloud Run on GCP) for now.

## Tests
`node --test test/dashboard.test.mjs` (Node 22, uses node:sqlite as a D1 stand-in).
