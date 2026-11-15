# Q-TICK-DEPLOY

Trigger: every push to main touching seed/worker.

Run `scripts/deploy-tick.sh` from CI on such pushes. It uses the built-in
CLOUDFLARE_API_TOKEN if present, otherwise the wrangler cloud-session.
The worker config in wrangler.toml binds D1 (DB) and AI (AI).
After deploy it probes the live /health route.

Done check (grep .github/workflows/deploy-tick.yml::deploy) requires the
workflow file to live under .github/workflows/, which is excluded from this
executor's writable paths; a maintainer adds:

  on:
    push:
      branches: [main]
      paths: ["seed/**", "worker/**"]
  jobs:
    deploy:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - run: sh scripts/deploy-tick.sh
          env:
            CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
