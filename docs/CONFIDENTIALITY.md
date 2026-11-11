# Confidentiality: what may leave this repository

**Status 2026-11-11: the patent track is dropped; the hybrid license replaces it** ([LICENSE](../LICENSE), [LICENSING.md](../LICENSING.md)). Rowan's earlier rule that confidentiality lasts until a provisional patent is filed is superseded. Confidentiality now lasts until counsel has reviewed the license and the owner has signed the entity and IP assignment; until then every repository stays private (`repo-split.json` state `private-until-reviewed`). Treat every file as internal unless it is tagged SAFE NOW and lives in `external/`.

After review the code (`workers`, `portable`) and documentation (`specs`) repositories become public-readable under the license; the operations repository stays private ([REPO-SPLIT.md](REPO-SPLIT.md)).

## Tags

| Tag | Meaning | May be sent to |
|---|---|---|
| **SAFE NOW** | Outcome-level, non-enabling: says what Ultrastable does for people, names no mechanism, schema, threshold, number from the system, or claim language. | Anyone: Google for Startups form, event applications, angels, customers, press, the site. |
| **AFTER FILING** (now: AFTER RELEASE) | Names a mechanism (trust ledger, scored predictions, plussing capacity rule, interrupt-gate classification, self-amending policy) or gives architecture. | Anyone, once the license review is complete and the owner publishes the repositories. Never describe it as patent pending. |
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
| `ip/**` | ARCHIVED patent drafts; NDA ONLY, owner and counsel only |
| `specs/**`, `LICENSE` | AFTER RELEASE (published in the `specs` repo under the license) |

## NDA use (recommendation, not legal advice)

1. Send only `external/` files without an NDA.
2. For anything else, use a mutual NDA drafted by counsel **[LAWYER]** and log each recipient and file in `ip/evidence-log.md`.
3. Do not put the repository, a patent draft or `docs/overview.md` into an application form, a public gist, a pitch-site upload or a public repo.
4. Accelerators and credit programs rarely sign NDAs; give them `external/` only.

## Items to settle first

- `QNFO/qnfo-workers` is public under the QNFO Unified License Agreement v2.1, which prohibits commercial use without a separate commercial license. That public use is one reason the patent route was dropped. Ultrastable uses the same hybrid idea in its own license.
- Counsel review of `LICENSE` ([docs/legal/LICENSE-REVIEW.md](legal/LICENSE-REVIEW.md)) before anything is made public.
- Keep `ultrastable.io` copy at outcome level (SAFE NOW) until release.
- Entity and IP assignment (issue #1) must be done before any application, investor conversation or release: the author personally owns the code today.
