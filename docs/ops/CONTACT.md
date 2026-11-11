# Where contact email goes

Machine-readable registry: [contact.json](contact.json). It is checked on every `python3 -m foundation doctrine --check`: an `@ultrastable.*` address that appears anywhere in the repo but not in the registry fails the check, so this page cannot drift from the code.

## What exists today (read from the Cloudflare API, 2026-11-11)
Email Routing is enabled on the `ultrastable.io` zone. Two forward rules are live and enabled; the catch-all is disabled, so mail to any other address is dropped.

| Address | Goes to | Used for |
|---|---|---|
| `pilot@ultrastable.io` | the owner's Gmail (rule "pilot inbox") | the public contact on the org profile, the site, one-pagers and every README: pilots, partners, commercial licensing, and security reports for now |
| `hello@ultrastable.io` | the owner's Outlook (rule "hello@ultrastable.io to owner") | general inbound and funding-programme forms |

Outbound: the owner dashboard sends sign-in codes, failing-check alerts and the 13:00 UTC digest from `owner@ultrastable.io` through the Email Sending binding, restricted to the owner address, so those arrive in the owner's own inbox. Outreach (`outreach@ultrastable.io`) is dry-run until a sending identity is registered; nothing is sent as the owner without the outreach gate.

## How the owner sees it
1. Replies and inbound land in the Gmail and Outlook inboxes above. Nothing is stored in this repo.
2. The dashboard `/owner` page lists anything needing the owner as a card with a default in effect and a closing probe; the daily digest summarizes it. See [dashboard/README.md](../../dashboard/README.md) and the live-from-code demo in [demos/self/index.html](../../demos/public/self-dashboard.html).
3. Funding replies are processed by `outreach/outreach.py reply` and show in `outreach/STATUS.md`.

## Not yet true, stated plainly
- `security@ultrastable.io` is named in `platform/core/docs/security.md` but has no rule. A session tried to add it on 2026-11-11 and the permission check refused the account routing change, so it is recorded here and every `SECURITY.md` points at `pilot@` until a rule exists.
- `founder@`, `social@` and `budget@` are planned sender identities with no inbox.

## Next step and closing probe
Add forward rules for `security@` (and `press@` if wanted) to the same verified destination as `pilot@`, from a session whose permissions allow routing changes or by the owner in Cloudflare > Email > Email Routing. Closing probe: the API rule list shows an enabled `security@` rule and a test mail arrives; then set its `status` to `live` in `contact.json`.
