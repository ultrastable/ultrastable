# Social accounts: owner cards (identity-bound)

The pipeline in `social/` is built and runs in dry-run now. Creating an account and minting its token are the owner's acts (they bind a public identity). Each card has a default in effect and a closing probe.

## Card SOC-1: Bluesky account
- Create the account (handle `ultrastable.io` is possible by DNS verification, or `ultrastable.bsky.social`); use `brand/logo/ultrastable-icon-512.png` as avatar and `brand/social/social-card.png` as banner; bio: "Coding agents write code. Ultrastable runs the system." Then Settings > App Passwords > create one.
- Add repo secrets `BLUESKY_HANDLE` and `BLUESKY_APP_PASSWORD` (names only; never paste values in chat).
- Default in effect: dry-run, nothing public.
- Closing probe: `gh secret list -R ultrastable/ultrastable` shows both names; then set `mode` to `live` in `social/gate.json` (a PR the fleet opens and merges once the probe passes); the next run prints `posted at://...`.

## Card SOC-2: Mastodon account
- Create the account on an instance that allows project/bot accounts; Preferences > Development > New application with `write:statuses` only.
- Secrets `MASTODON_INSTANCE` (hostname) and `MASTODON_TOKEN`.
- Default in effect and closing probe: as SOC-1.

## Not yet carded
LinkedIn company page and X (money) are added only when there is a reason; see `social/README.md`.
