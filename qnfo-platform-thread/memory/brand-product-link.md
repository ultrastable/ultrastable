---
name: brand-product-link
description: How Rowan's personal brand is linked to the Ultrastable platform (2026-11-10) and where the link targets live
metadata:
  type: project
  modified: 2026-11-10T08:23:46.967Z
---
Done 2026-11-10 (QNFO/qnfo-workers #10190, rwnq8/resume #12, rwnq8.github.io #11, rwnq8 #8).
- Interim product home: https://qnfo.org/platform (no separate Ultrastable repo/domain is visible to sessions).
- Platform page credit, name and JSON-LD creator come from D1 qnfo-audit `product_profile` (product 'ultrastable'); gateway 3.65.0 reads it.
- Owner answers on fleet.qnfo.org/focus (owner_asks kinds product-name, product-design-credit, product-home, product-github, product-credit-public) update product_profile via trigger owner_asks_product_profile_au, no deploy.
- Personal surfaces (website nav + JSON-LD, GitHub profile badge, CV, BRAND.md section 9) link to qnfo.org/platform.

**How to apply:** when the Ultrastable domain/repo exists, change product_profile home_url/repo_url and the static links in the personal repos. See [[profile-packages]].
