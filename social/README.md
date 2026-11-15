# Automated social posting

**Ultrastable is the foundation for any autonomous system.**

Ultrastable creates and destroys its own parts to stay stable: inside its boundary the system has complete control to build, replace, delete and rebuild itself, and the boundary, not a permission prompt, keeps a failure from reaching anything outside it (`python3 -m foundation doctrine --check`).

A system is autonomous if it has self-referential loops and the ability to close them. Knowing without being able to act is useless, so the system is privileged to close its own loops (`python3 -m foundation loops --verify`).

Ultrastable runs on itself: its roadmap, issues, managers, trust ledger, plussing budget and specs are run by the same code it gives everyone else, from this repository alone, with any tools (`python3 -m foundation selfhost`).

Tag: SAFE NOW content only. Runs from `.github/workflows/social-post.yml` (daily, one post at most). Control is data: [gate.json](gate.json) (kill switch, mode, rate limits, paused channels), [accounts.json](accounts.json) (channels), [guard.json](guard.json) (rules), [calendar.json](calendar.json) (queue), `state.json` (what was posted).

## Decision (2026-11-10): direct APIs, Bluesky and Mastodon first; Buffer not used
| Option | Verdict |
|---|---|
| **Bluesky** (app password, AT Protocol) | Chosen. Free, no app review, token is revocable, plain HTTPS. |
| **Mastodon** (access token on any instance) | Chosen. Free, no review, idempotency key prevents double posts. |
| LinkedIn company page | Next adapter. Posting API needs an approved developer app and a company page; owner card when wanted. |
| X | Later. API is paid per use; sign-up and billing are identity-bound (money). Not worth it before there is an audience. |
| Buffer | Skipped for now. It adds a third party between us and the account and a paid plan, and I could not verify its current API limits from a primary source (search returned only third-party summaries, 2026-11-10). It can be added as an adapter later; the queue and guard do not change. |
| GitHub Actions cron | The scheduler for everything above; no extra service to run. |

## How a post is made
1. `scripts/social_generate.py` extracts sentences from the allowlisted SAFE NOW files in `guard.json` and schedules each guard-clean one.
2. Guard (`scripts/social_lib.py`): the text must be a **verbatim excerpt** of an allowlisted source (so nothing is invented), must clear every blocked pattern (QNFO, research, patent/filing/disclosure, finances, customers, mechanisms, figures, outside links), contain no numbers, fit each channel's length, and be standalone.
3. `scripts/social_post.py` posts the oldest due item, once per day and four per week at most. No human review; the guard is the review. Any guard failure stops that post and fails the run.
4. Kill switch: set `"kill": true` in `gate.json`. Per-channel: `paused_channels`. Going live: `"mode": "live"` plus channel secrets.

AFTER FILING content stays blocked until `provisional_filed` is true (recorded with a filing receipt in `ip/evidence-log.md`). Tests: `scripts/test_social.py` (runs in `checks`).
