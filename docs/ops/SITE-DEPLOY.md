# Site deploy (ultrastable.io)

Worker source: `site/worker.js` (about 27 KB). Images live in a KV namespace `ultrastable-site-assets` (binding `ASSETS`), sources in `site/assets/`, so the script is small enough to upload inline.

Routes: `/`, `/product`, `/how`, `/proof`, `/team`, `/faq`, `/contact`, `/pilot`. New pages are generic by design and tested for banned wording in `site/site.test.mjs`.

## Paths (no GitHub Actions minutes needed)
1. **Cloudflare connector from a session** (works today): upload the images to KV (`PUT storage/kv/namespaces/<id>/values/<file>`), then PUT the worker with the KV binding in the metadata. Large payloads must be copied in chunks of about 3 KB and verified by SHA-256 inside the sandbox (an unverified copy failed once, BG-27). KV namespace id `eade26c7862a4f4cad4827baeb29e04e`; both images are already stored.
2. **`deploy/deploy-site.mjs`** run by a person or by the `deploy-site` workflow. The workflow is manual only, 5-minute timeout, and skipped unless repo variable `DEPLOY_SITE_ENABLED` is `true`, so it can never produce a failing run. It needs secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

Closing probe: `curl -s https://ultrastable.io/team` returns the team page and `curl -sI https://ultrastable.io/social-card.png` returns `image/png`.
