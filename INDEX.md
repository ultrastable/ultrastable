# Ultrastable: where everything is (single index)

All of it lives in this open repository: https://github.com/ultrastable/ultrastable

**Right now:** [NEEDS-YOU.md](NEEDS-YOU.md) is the only page that asks a person for anything (four links, each with its default). Live state: the owner dashboard at `/owner` on ultrastable.io and `python3 -m foundation cockpit`. Memory: `docs/PROJECT-MEMORY.md`. The work itself runs by itself: a scheduled Claude session picks the top issue every three hours; the Cloudflare tick and the daily executor workflow are the other routes.

| What | Where on GitHub |
|---|---|
| Roadmap (Now / Next / Later / After release) | Milestones: https://github.com/ultrastable/ultrastable/milestones . Narrative in `ROADMAP.md` |
| Tasks and next steps | Issues: https://github.com/ultrastable/ultrastable/issues (every issue carries a milestone) |
| Project board | **Not possible from the agent sessions used so far**: GitHub Projects boards need the GraphQL API, which those sessions block. Milestones are the roadmap view; create a board in the UI once and add the issues if a board is wanted (issue tracks it) |
| Intellectual property | `docs/ip/IP-REGISTER.md` (register); the Ultrastable License governs use |
| Business plan, customers, competition, funding | `business/` , `research/market-read.md` , `docs/positioning` files |
| Product design and positioning | `docs/qnfo-origin/product-design-full.md` , `docs/product-and-positioning.md` |
| Website code and deploy | `site/` , `deploy/deploy-site.mjs` |
| Core extraction map | `core-manifest/boundary.json` |
| Hand-off and state | `HANDOFF.md` , `docs/ARTIFACTS.md` (live systems inventory) |
| Everything from the QNFO platform thread: product doc, boundary check, claim checks, platform page source, migrations, tests, the 12 merged PRs as patches, D1 snapshot, thread record | `qnfo-platform-thread/` (README, MANIFEST.md with commit for each file, `python qnfo-platform-thread/verify.py`) |
| Every issue grouped by area, refreshed hourly from GitHub | `docs/ISSUES-BY-AREA.md` (`tools/build_index.py`, `.github/workflows/index.yml`) |
| What needs a person | `NEEDS-YOU.md` (cards no longer exist; `outreach/STATUS.md` lists the funding programmes) |

Rule for every session: write results here (code, docs, issues, milestones) and update this index. Nothing is canonical in a chat.
