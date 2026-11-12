# Owner card OWNER-CF-AND-MODEL

**IDENTITY-BOUND:** API credentials on the owner's accounts can only be minted by the owner.

**What:** store these as GitHub repo secrets on `ultrastable/ultrastable` (names only, never paste values into the repo):
1. `CLOUDFLARE_API_TOKEN`: created in the Ultrastable Cloudflare account (id `81e3a4efb4eb66e613529b87682911bb`) with Workers Scripts Edit, D1 Edit, Workers KV Edit; to also read the old account for the transfer, create it as a user token covering both accounts.
2. `ANTHROPIC_API_KEY`: from the Anthropic console; the executor and the lane's LLM review use it.
3. Optional, for Worker-triggered runs: Worker secrets `GITHUB_DISPATCH_TOKEN` (fine-grained, Contents+Actions write on this repo) and var `GITHUB_REPO=ultrastable/ultrastable`.

**Default in effect:** the daily Actions schedule runs the executor and records `no-model-credential`; the tick keeps running on the old account; no asset is moved.

**Closing probe:** `python3 scripts/cf_account.py probe` reports `target_reachable: true` (workflow `cf-account`), and an executor run logs `pr-opened` in `loop-evidence`.
