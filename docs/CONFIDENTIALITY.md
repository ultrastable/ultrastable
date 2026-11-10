# Confidentiality: what may leave this repository

**Status 2026-11-10: the provisional patent is NOT filed.** This repository is private and stays private. Treat every file as internal unless it is tagged SAFE NOW and lives in `external/`.

## Tags

| Tag | Meaning | May be sent to |
|---|---|---|
| **SAFE NOW** | Outcome-level, non-enabling: says what Ultrastable does for people, names no mechanism, schema, threshold, number from the system, or claim language. | Anyone: Google for Startups form, event applications, angels, customers, press, the site. |
| **AFTER FILING** | Names a mechanism (trust ledger, scored predictions, plussing capacity rule, interrupt-gate classification, self-amending policy) or gives architecture. | Anyone, but only after the provisional is filed; then mark "patent pending". |
| **NDA ONLY** | Real numbers from QNFO, architecture details, schemas, the priority function, patent drafts and claims. | Counsel, or a named recipient under a signed NDA. Assume most investors will not sign one. |

## Two forms of everything that leaves

| Internal full version (this repo, private) | External non-enabling version (`external/`) |
|---|---|
| `docs/overview.md` | `external/overview.md` |
| `docs/customer-story.md` | `external/customer-story.md` |
| `docs/security-overview.md` | `external/security-summary.md` |
| `business/google-startups/application-kit.md` | `external/google-startups-answers.md` |
| `business/google-startups/one-pager.md`, `deck-outline.md` | `external/one-pager.md` |

Rule: write the internal version first; the external version is derived by deleting mechanisms, numbers and architecture, never by rewording them. If a sentence would help a competitor rebuild the system, it does not go in `external/`.

## File register (this package)

| File | Tag |
|---|---|
| `README.md`, `docs/overview.md`, `platform/docs/architecture.md`, `platform/adapters/**` | NDA ONLY (repo is private; AFTER FILING for the public-facing parts once filed) |
| `docs/customer-story.md`, `docs/security-overview.md` | NDA ONLY |
| `business/google-startups/*` | NDA ONLY (answers inside are copied to `external/` in SAFE NOW form) |
| `business/marketing/strategy.md` | AFTER FILING for the plan; its Phase 1 wording is SAFE NOW |
| `external/*` | SAFE NOW |
| `ip/**` | NDA ONLY, owner and counsel only |

## NDA use (recommendation, not legal advice)

1. Send only `external/` files without an NDA.
2. For anything else, use a mutual NDA drafted by counsel **[LAWYER]** and log each recipient and file in `ip/evidence-log.md`.
3. Do not put the repository, a patent draft or `docs/overview.md` into an application form, a public gist, a pitch-site upload or a public repo.
4. Accelerators and credit programs rarely sign NDAs; give them `external/` only.

## Items to settle first

- `QNFO/qnfo-workers` is public under the QNFO User License Agreement v2.1, which prohibits commercial use without a separate commercial license. The key combination has not been publicly disclosed as a whole; the patent attorney is asked what exactly was public and when. File as early as practical.
- Keep `ultrastable.io` copy at outcome level (SAFE NOW) until filing; review it against this guide before each change.
- Entity and IP assignment (issue #1) must be done before any application or investor conversation: the author personally owns the code today.
