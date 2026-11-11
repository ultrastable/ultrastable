# Ultrastable brand kit

One page every Ultrastable surface follows. **Ultrastable is its own brand, separate from QNFO.** QNFO appears only as the test case that shows the system works, never in the look, and Ultrastable is never framed as research.

## Thesis (use in long-form copy)
Vibe coding is a start, not a system. A system is many agents with separate duties running code loops that check, report and improve themselves. Ultrastable is multi-agent, self-referential loops, not a prompt and not a single code agent. Source: `doctrine/positioning.json` (`loops_thesis`), `docs/product/why-multi-agent-loops.md`.

## Positioning
Ultrastable is an autonomous system that sets up and runs any organized effort from one idea: a company, an open-source project, a community, a lab, anything you can describe. From one idea it bootstraps the building blocks the effort needs (development, branding, an IP-protection filing package, a plan, search and analytics presence, funding outreach and promotion) and then keeps improving itself. For-profit and open source (ultrastable.org) both stay open; the choice is the owner's and can be made later. QNFO, an independent research programme, is the research-kind test case and appears only as that. It is self-directed, with light, non-burdensome input: you can steer it any time, but it manages itself, so you do not need a development team, a patent lawyer or a marketing firm to get started. Anything can be bootstrapped; the sky is the limit.

Not claimed: financial back-end (accounting, payments, banking). Out of scope for now. Legal and patent output is a working draft for professional review, not legal advice.

## Name and headline
**ultrastable**, one word, never "ultra-stable". Wordmark is lowercase; in running text use "Ultrastable". Domains and handles lowercase: `ultrastable.io` (canonical), `.app`, `.net`, org `ultrastable`.

**Headline (keep): Coding agents write code. Ultrastable runs the system.**
Sub-line: *From one idea to an organization that improves itself.*

## Voice
Confident, plain, practical, a little bold. Speak to builders with ideas, not to researchers. Say what it does for them. No academic or research language, no hype words, no unverifiable numbers. Label what is running versus planned when detail matters.

## Public versus private (until the provisional patent is filed)
Public copy says what Ultrastable does for people, never how. No mechanisms, thresholds, schemas, architecture or numbers from the system. Only `external/` files and `public-profile/` are public-safe. See `docs/CONFIDENTIALITY.md`.

## Color (deliberately unlike QNFO's blue-on-white)
| Token | Hex | Use |
|---|---|---|
| **Signal** (brand) | `#FF5B1F` | mark, headline accent, primary buttons |
| Sun | `#FFC857` | highlights, small accents |
| Moss | `#12342A` | dark brand surface, banners |
| Night | `#0B1A15` | deepest background |
| Cream | `#F6F1E7` | page background, text on dark |
| Ink | `#14120F` | text on light |
| Mist | `#C9D4CC` | secondary text on dark |
| Stone | `#5B574F` | secondary text on light |
Dark mode: Night page, Moss cards, Cream text, Signal accent. Signal on Night and Ink on Cream pass WCAG AA; do not put Signal text on Cream below 24 px (use Ink).

## Typography
Display and headings: **Fraunces** (serif), fall back to Georgia. Body and UI: **IBM Plex Sans**, fall back to `system-ui`. Code: `ui-monospace`. Headings 700 with tight tracking; generous line height on body. The serif is the main visual break from QNFO's all-sans look.

## Logo
A solid triangle (stable ground, the thing that stays up) with a sun dot beside the peak (the sky is the limit). No tile, no container. Files in `logo/`: `ultrastable-primary.svg/.png` (mark + lowercase wordmark), `-dark.svg`, `ultrastable-icon.svg` and `-512.png` (avatars), `ultrastable-mono.svg`, `ultrastable-mono-white.svg`, `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`. Clear space: half the triangle's width. Minimum 16 px. Never recolor outside the tokens above, outline, rotate or add effects.

## Layout language
Large serif headlines, wide margins, flat color blocks, square-ish corners (4 to 8 px radius), one orange action per screen. No rounded-card grids with blue accents, no dashboards-as-hero, no charts on the front page.

## Social and banners
`social/social-card.svg/png` (1280x640, Open Graph and GitHub preview), `social/readme-banner.svg/png` (1280x320). Rebuild PNGs: `node brand/tools/render.js` (Playwright).

## Applying it
| Surface | How |
|---|---|
| Repo README | banner, one-line descriptor, status; `templates/README-template.md` |
| Issues, PRs | `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md` |
| Docs | `templates/doc-template.md` |
| Site and dashboard | tokens above, Fraunces headings, favicon, `social-card` as Open Graph image (applied in `dashboard/worker.js` and `site/worker.js`) |
| Email | `templates/email-template.html` |
| Org profile | `public-profile/`; QNFO cross-link `public-profile/qnfo-crosslink.md` |
| External copy | `external/` |
