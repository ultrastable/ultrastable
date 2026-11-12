# First run: nobody types a token, and nothing runs on a person's computer

Goal: the loops tick without anyone minting a credential. Server-side only (owner, 2026-11-12): every route below runs on a server-side platform. Routes, best first (all listed in `deploy/routes.json`):

1. **GitHub Actions with its built-in token (the credential-free route).** `.github/workflows/loop.yml` runs `python3 -m foundation launch --failover --commit --push` every day and on dispatch. GitHub mints the workflow token for each run and revokes it afterwards, so no person creates, stores or renews anything. It takes over when no other host has written evidence for 12 hours (`instances/ultrastable/loops.json`).
2. **Deploy to Workers button** (`https://deploy.workers.cloudflare.com/?url=<repo url>`): one click in a browser; Cloudflare builds and deploys on its own servers. It needs a public repository; this repo is private, so the button is wired when it is published (gap SG-10 probe).
3. **A cloud-hosted Claude session with the Cloudflare connector authorized on the account** creates the D1 database, loads the real records (`python3 -m foundation launch --export-d1`) and deploys the tick Worker on the account named in `deploy/cloudflare-accounts.json`.
4. **The `cf-account` workflow** (`.github/workflows/cf-account.yml`, `scripts/cf_account.py`) does the same steps when a Cloudflare token covering the account is bound as a repository secret.

The browser sign-in script that ran `wrangler login` on a person's computer was removed on 2026-11-12: it was a route through a computer the system does not run on.
