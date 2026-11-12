# Executor on Actions, Worker dispatches; staged account transfer

Date: 2026-11-12
Kind: decision
Session: thread-cf-bootstrap

The agent-executor (foundation/executor.py) runs on GitHub Actions with the Cloudflare tick Worker dispatching it; target account 81e3a4ef... was unreachable from every surface (docs/failures/2026-11-12-target-account-unreachable.md); transfer is staged and reversible via scripts/cf_account.py and deploy/transfer/plan.json.
