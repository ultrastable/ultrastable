# Failure: the loops had one host and one credential path (2026-11-11)

What happened: Rowan supplied a new Cloudflare account to run Ultrastable on itself. The session could not reach it: the connector was authorized only for the old account and no token was available. The only paths written were "give me a token" or "re-authorize the connector". A non-coder cannot do either, and the start of the loops should have needed no person at all.

Root cause: the launch was designed around the host that was available (Cloudflare) instead of around the loop. One host plus one credential kind equals a single point of failure, and the fallback hosts existed only as prose.

Fix (this change): the command is the contract and every host calls it; hosts fail over on silence without coordination (`foundation/failover.py`); a credential-free route always exists (`deploy/first-run/`, `deploy/routes.json`); `scripts/check_routes.py` fails CI for any loop or deploy path with one route or without a credential-free route. Lesson recorded in `doctrine/LESSONS.md`; gap SG-10.

Still open: the move to the new account (account `81e3a4efb4eb66e613529b87682911bb`) waits on the browser sign-in route; the old account keeps ticking. Closing probe: `deploy/cloudflare-accounts.json` target state `running`.
