# First run: nobody types a token

Goal: a non-coder gets the loops ticking without minting a credential. Routes, best first (all listed in `deploy/routes.json`):

1. **Run the loop right now, no account at all:** `python3 -m foundation launch --commit`. This is the credential-free route; it always works.
2. **One command that signs in through the browser:** `sh deploy/first-run/first-run.sh`. `wrangler login` opens Cloudflare, you click Allow; the script creates the D1 database, loads the real records and deploys the tick Worker on the account named in `deploy/cloudflare-accounts.json`. If any step fails it says so and still runs route 1.
3. **Deploy to Workers button** (`https://deploy.workers.cloudflare.com/?url=<repo url>`): needs a public repository; this repo is private until the owner publishes it, so the button is wired when that happens (gap SG-10 probe).
4. **A Claude session with the Cloudflare connector authorized on the account** does the same steps.

The dashboard's "Start the loops" button is the same as route 2 behind a click; it is built once route 2 is verified on a real account.
