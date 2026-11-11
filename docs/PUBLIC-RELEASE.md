# Public release: license, repositories, and what stays private

Decision date: 2026-11-11 (owner). Supersedes the patent-first plan in `ip/provisional/` and `docs/CONFIDENTIALITY.md`.

## Decision

1. **No patent.** The idea was disclosed publicly through QNFO (`QNFO/qnfo-workers` public since 2026-08-10), which ended most foreign patent rights and started the US one-year clock. A patent was judged not worth pursuing. The architecture is instead published as dated specifications, which also act as prior art against anyone else patenting it.
2. **Hybrid license.** Free for non-commercial use; any use that makes or saves money needs a commercial license and shares revenue with the Licensor. Source-available, not open source. Text: `ultrastable/license`, adapted from the QNFO Unified License Agreement v2.1 (Section 12 and the Supplemental Terms).
3. **The code base stays public-capable, not private.** Repositories are created private, and the owner flips them public after the license is reviewed.

## Repositories (GitHub org `ultrastable`)

| Repo | Contents | Visibility now | Target |
|---|---|---|---|
| `ultrastable/license` | `LICENSE` (USL-1.0), `COMMERCIAL-TERMS.md` (rate card), `FAQ.md`, copy-check script | private | public |
| `ultrastable/workers` | Code: Cloudflare Worker tick, schema, bootstrapper, template, GCP adapter, Python reference runtime, extraction plan | private | public |
| `ultrastable/spec` | Architectural specifications (`US-SPEC-*`) and documentation, derived from the former provisional specification | private | public |
| `ultrastable/ultrastable` | System of record: roadmap, issues, business, funding, investor, IP history, brand. **Not released.** | private | private |
| `ultrastable/.github` | Org profile | public | public |
| `ultrastable/{docs,seed,business,ip,platform,site}` | Superseded duplicates | private | archive |

## Where the code is

- Working code for the product (tick, schema, bootstrap, adapters, Python runtime): moved from this repo into `ultrastable/workers`. The copies here (`seed/`, `platform/`) remain as history and stop being edited.
- The core of the production system is 19 workers still inside `QNFO/qnfo-workers` (public, QNFO-ULA v2.1). `ultrastable/workers/extraction/README.md` lists them and the phases P1 to P4 for moving them.

## Honest limits of this approach

- Without a patent, a clean-room reimplementation of the ideas is not infringement. Protection is copyright in the code and text, the trademark (not yet filed), the license contract (binding on those who accept it), and the commercial offer (support, updates, hosted service, conformance). License Section 7.2 reaches implementations made by someone who used the Specification; it cannot reach someone who never saw it.
- The license was drafted by an AI assistant and has not had legal review. Sections 5, 7.2, 15 and 17 need counsel.
- Entity and trademark are not in place. The Licensor is currently Rowan Brad Quni-Gudzinas personally; License Section 19 allows assignment to the future entity.

## Before flipping public (checklist)

1. Counsel reviews `ultrastable/license` (Sections 5, 7.2, 15, 17).
2. Owner confirms the numbers in `COMMERCIAL-TERMS.md` (5% standard, Founder tier to USD 50,000, internal USD 12,000).
3. Run `node scripts/check-copies.mjs` in `ultrastable/license`: all copies identical.
4. Secret scan on `workers` and `spec` (`gh secret-scanning` or gitleaks) is clean.
5. Grep `spec` for the exclusions: patent, claim, invention, NDA, investor, funding.
6. File the "Ultrastable" trademark (class 9 and 42) and register the domain used in the license.
7. Flip `license`, `workers`, `spec` public: `gh repo edit ultrastable/<repo> --visibility public --accept-visibility-change-consequences`.
8. Update the QNFO case study and `rwnq8.github.io` to point at the public repos.
