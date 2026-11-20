<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/i18n: many languages for any server-rendered site (I18N-1)

`segmentsOf(html)` cuts a rendered page into translatable segments; `localizeHtml(html, { lang, dict, origin, path, live })` swaps in translations by `segKey`, rewrites internal links to `/<lang>/...`, sets `lang`/`dir`/canonical/hreflang and a machine-translation notice, and marks a page `noindex` (canonical to the source) when less than `minCoverage` of it is translated. `sitemapIndex` and `sitemapFor` write per-language sitemaps with alternates. `translateBatch({ generate, lang, segments })` asks a model and keeps only translations that pass `checkTranslation` (numbers, URLs, script, length, no refusal). `LANGS` lists 25 languages in rollout order. No storage or network here.

| Piece | Status |
|---|---|
| Segment extraction, localization, hreflang, sitemaps | BUILT |
| Deterministic translation checks | BUILT |
| Per-segment language tags for untranslated fragments | NOT COVERED (a mostly translated page keeps source text for the rest; the notice says so) |

Tests: `i18n.test.js`.
