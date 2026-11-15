# Ultrastable brand kit

One page every Ultrastable surface follows. **Ultrastable is its own brand, separate from QNFO.** QNFO appears only as the test case that shows the system works, never in the look, and Ultrastable is never framed as research.

## Thesis (use in long-form copy)
Vibe coding is a start, not a system. A system is many agents with separate duties running code loops that check, report and improve themselves. Ultrastable is multi-agent, self-referential loops, not a prompt and not a single code agent. Source: `doctrine/positioning.json` (`loops_thesis`), `docs/product/why-multi-agent-loops.md`.

## Positioning
**Ultrastable is the foundation for any autonomous system.** The sentence is owned by `doctrine/positioning.json`; the brand lint (`python3 -m foundation doctrine --check`) fails when a repo's front page lacks it.

Four claims, in this order, on every front page:
1. **Foundation for any autonomous system.** An organization of virtual managers and staff that runs projects, scores its own decisions, earns wider autonomy from its track record, and interrupts a person only for steps that cannot be undone.
2. **It runs on itself.** Its roadmap, issues, managers, trust ledger, plussing budget and specs are run by the code it gives everyone else (`python3 -m foundation selfhost --verify`). Self-reference is the proof, and the demo is `demos/self/`.
3. **Source-available, hybrid license.** Free for non-commercial use; commercial use needs a Commercial License with revenue share (LICENSING.md). 
4. **Code is the only memory.** If it is not in a repo, it does not exist.

Perception becomes reality: the way we position this is what it becomes and how it is developed, so positioning lives in code and is lint-enforced, not retyped. Ultrastable is its own brand, separate from QNFO; QNFO is only the customer-zero story. Not claimed: financial back-end (accounting, payments, banking). Legal output is a working draft for professional review, not legal advice.

## Name and headline
**ultrastable**, one word, never "ultra-stable". Wordmark is lowercase; in running text use "Ultrastable". Domains and handles lowercase: `ultrastable.io` (canonical), `.app`, `.net`, org `ultrastable`.

**Headline (keep): Coding agents write code. Ultrastable runs the system.**
Sub-line: *From one idea to an organization that improves itself.*

## Voice
Confident, plain, practical, a little bold. Speak to builders with ideas, not to researchers. Say what it does for them. No academic or research language, no hype words, no unverifiable numbers. Label what is running versus planned when detail matters.

## Public versus private
The project is open: the repositories are public and the Ultrastable License governs use. Nothing public holds secrets or owner data.

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

## Generated images (code, not hand-drawn)
`brand/brand.json` is the source; `python3 brand/tools/generate.py` draws `brand/generated/` (banner, org banner, loop, architecture, self-reference, repo map, one 1280x640 social card per repo) and `node brand/tools/render-generated.js` renders the PNGs. `python3 brand/tools/sync_repos.py --apply <parent>` writes each repo's README block, CONTRIBUTING.md, SECURITY.md and `assets/brand/` images; `python3 brand/tools/sync_settings.py` writes descriptions and topics into `github/org-settings.json`. The lint fails on a stale file. The hand-set logo files in `logo/` stay; the generator reuses their geometry.

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
