# Confidentiality: what may leave this repository

**Status 2026-11-15: the project is open and the [Ultrastable License](../LICENSE) governs use** ([LICENSING.md](../LICENSING.md)); no patent is pursued (NO-PATENT-1). The tags below say what the public site and outreach copy lead with (SAFE NOW) and what stays internal operations data.

The code (`workers`) and documentation (`spec`, `license`) repositories are public under the license; the operations repository holds internal operating data (`ultrastable/workers` `docs/REPO-MAP.md`).

## Tags

| Tag | Meaning | May be sent to |
|---|---|---|
| **SAFE NOW** | Outcome-level, non-enabling: says what Ultrastable does for people, names no mechanism, schema, threshold, number from the system, or claim language. | Anyone: Google for Startups form, event applications, angels, customers, press, the site. |
| **AFTER RELEASE** | Names a mechanism (trust ledger, scored predictions, plussing capacity rule, interrupt-gate classification, self-amending policy) or gives architecture. | Anyone: the repositories are public under the license. |
| **NDA ONLY** | Real numbers from QNFO, architecture details, schemas, the priority function and archived drafts. | A named recipient under a signed NDA. Assume most investors will not sign one. |

## Two forms of everything that leaves

| Internal full version (this repo) | External non-enabling version (`external/`) |
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
| `README.md`, `docs/overview.md`, `platform/docs/architecture.md`, `platform/adapters/**` | NDA ONLY for operating detail; the public-facing parts are AFTER RELEASE |
| `docs/customer-story.md`, `docs/security-overview.md` | NDA ONLY |
| `business/google-startups/*` | NDA ONLY (answers inside are copied to `external/` in SAFE NOW form) |
| `business/marketing/strategy.md` | AFTER RELEASE for the plan; its Phase 1 wording is SAFE NOW |
| `external/*` | SAFE NOW |
| `ip/**` | Archived early drafts; NDA ONLY |
| `LICENSE` | AFTER RELEASE |

## NDA use (recommendation)

1. Send only `external/` files without an NDA.
2. For anything else, use a mutual NDA (a standard mutual NDA template; the fleet drafts it) and log each recipient and file in `ip/evidence-log.md`.
3. Do not put the repository, an archived draft or `docs/overview.md` into an application form, a public gist, a pitch-site upload or a public repo.
4. Accelerators and credit programs rarely sign NDAs; give them `external/` only.

## Items to settle first

- `QNFO/qnfo-workers` is public under the QNFO Unified License Agreement v2.1, which prohibits commercial use without a separate commercial license. Ultrastable uses the same hybrid idea in its own license.
- License decisions are recorded in [legal/LICENSE-DECISIONS.md](legal/LICENSE-DECISIONS.md); nothing else gates release.
- Keep `ultrastable.io` copy at outcome level (SAFE NOW) until release.
- Entity and IP assignment (issue #1) must be done before any application, investor conversation or release: the author personally owns the code today.
