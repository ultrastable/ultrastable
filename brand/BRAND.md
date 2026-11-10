# Ultrastable brand kit

One page every surface follows: site, repos, docs, dashboards, email, social. Source of truth for the look; change it here by PR.

## Name
**Ultrastable**, one word, capital U, no space, no hyphen ("ultra-stable" is wrong), never all caps. Domains and handles are lowercase: `ultrastable.io` (canonical), `.app`, `.net`, GitHub org `ultrastable`.

## Tagline
**Software that stays up.** Short form for avatars and headers. Descriptor line: *Autonomous software development, built to keep running.*

## Voice
Plain, precise, calm. Say what is running and what is not. No hype words (revolutionary, game-changing), no exclamation marks, no unverifiable numbers. Short sentences, active verbs. Label claims RUNNING, BUILT or PLANNED when detail matters.

## Public versus private (until the provisional patent is filed)
Public copy stays generic and non-enabling: what Ultrastable is and why, never how the internals work (loops, managers, improvement budgets, trust gating). Only the descriptor line, tagline, domains and the facts in `public-profile/` may be used publicly. Everything else is private. See `docs/CONFIDENTIALITY.md` where present.

## Color
| Token | Light | Dark | Use |
|---|---|---|---|
| Ink | `#14181F` | `#EEF1F5` | text |
| Ink 2 | `#4A5360` | `#A9B3C1` | secondary text |
| Surface | `#FFFFFF` | `#161B22` | cards |
| Background | `#F7F8FA` | `#0E1116` | page |
| Line | `#D9DEE6` | `#2C3541` | borders |
| **Blue (brand)** | `#0B5FFF` | `#6EA0FF` | accent, links, logo tile |
| Night | `#0E1116` to `#14264D` | | banners and social card gradient |
| Good / Bad | `#0A7A3D` / `#B3261E` | `#4CC38A` / `#FF8A80` | status only |

These match the site's CSS variables, so site and brand are already one system. Contrast: Ink on Background and white on Blue pass WCAG AA.

## Typography
Inter for brand artwork and headings; fall back to `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` (what the site uses). Monospace: `ui-monospace, SFMono-Regular, Menlo, Consolas`. Headings 700, body 400, tracking -0.5 to -2 on display sizes.

## Logo
A U-shaped cradle holding a dot: a system settled in a stable resting point. Files in `logo/`:
- `ultrastable-primary.svg` (+ `-dark.svg` for dark backgrounds, `.png`): tile plus wordmark. Default.
- `ultrastable-icon.svg`, `ultrastable-icon-512.png`: tile alone, for avatars. Org avatar uses this.
- `ultrastable-mono.svg`, `ultrastable-mono-white.svg`: one-color for print, stamps, dark photos.
- `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`.
Clear space: half the tile width on all sides. Minimum size: 16 px tile. Do not recolor the tile, stretch, rotate, add shadows or put it on busy photos.

## Social and banners (`social/`)
`social-card.svg/png` 1280x640 (Open Graph, GitHub social preview). `readme-banner.svg/png` 1280x320 for READMEs. Rebuild PNGs: `node brand/tools/render.js` (needs Playwright).

## Applying it
| Surface | How |
|---|---|
| Repo README | banner image first, then one-line descriptor, then a status line. Template: `templates/README-template.md` |
| Issues and PRs | `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md` (applied to this repo) |
| Docs | title, one-line summary, status label, owner; `templates/doc-template.md` |
| Site and dashboards | brand tokens above; add `<link rel="icon" href="/favicon.svg">`, Open Graph image `social-card.png`; shared header uses the tile plus wordmark |
| Email | `templates/email-template.html`; plain text fallback below it in the same file comment |
| Org profile | `public-profile/` (see its README); QNFO cross-link draft: `public-profile/qnfo-crosslink.md` |
| Dashboard | owner dashboard and holding page use the favicon and tile plus wordmark header (`dashboard/worker.js`) |
