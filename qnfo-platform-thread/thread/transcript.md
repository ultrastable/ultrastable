# Thread record: "Position QNFO as autonomous development platform"

Copied 2026-11-10 from the Personal Brand project thread (started 2026-11-10 07:22 UTC) so nothing lives only in chat.
Owner messages are verbatim. Agent replies are verbatim for results; progress checklists are given in their final state.

## Owner messages (verbatim)

**07:22 Rowan:** There's another aspect of this that I realize is really the key. So vibe coding is a thing, but what I'm trying to do with an autonomous system, and it doesn't just have to be for research, it could be for anything, is if you look at the fleet dashboard and the platform, this is really an autonomous development platform. And I don't know if anybody's doing that, so maybe you need to do some research and see how we position ourselves as sort of iterative vibe coding or autonomous development platform. And maybe that's something I haven't sold enough of for QNFO, but the back end is becoming really sophisticated entirely on its own.

**07:24 (relayed follow-up):** What is the actual product, what should it be called, and how do we spin it off as a standalone startup product that QNFO and the Qniverse run on? Product definition, 3-5 candidate names with domain, GitHub org and trademark checks, a recommendation, and a code-level separation plan (product core vs QNFO apps, QNFO as customer zero).

**07:27 Rowan:** https://ai.lounge.ai/news/anthropic-says-ai-systems-now-speed-up-its-own-model-development

**07:28 (relayed):** Chat is ephemeral. Deliver everything as merged PRs, issues, code and deployed changes. Keep replies minimal. Anything Rowan must do becomes a dashboard task.

**07:40 Rowan:** Always practice what you preach and implement in code always. The system shall always function as the system describes itself.

**08:11 (relayed):** Link this personal brand to the separate "ultra stable" brand project, so Rowan's name is tied to the autonomous development platform. The personal brand stays personal; the platform is what gets branded. Cross-links, "Built by Rowan, systems researcher" credit, schema/author metadata, sameAs links. Config-driven link targets.

**08:30 (relayed):** "try again": search everywhere for the Ultrastable repos/domains; if found, link both ways.

**08:48 Rowan:** At a minimum, all files, all artifacts, all code, all agents, all text, everything needs to be in the local, ultrastable directory. Even if you can't create it, I don't know why you can't create a local repo, but all files need to be in there. Nothing can remain in this thread that isn't already in that directory.

**08:50 Rowan:** push everything to https://github.com/ultrastable/ private repos

## Agent results (verbatim)

**07:28, on the Anthropic article:** Read it. Anthropic says its models now write over 80% of the code merged into its own codebase. It also says the system hasn't reached fully autonomous self-improvement, and it warns that human control gets harder as it gets closer. All of their numbers are self-reported. That helps your pitch in two ways: it confirms the trend (software that builds its own software is real, and the big labs are doing it internally), and it names the gap you can fill: what happens to oversight when the system steers itself? Your fleet is a small example that can be checked from the outside. It picks its own work, records how often its predictions come true, and keeps a list of the ways it fails.

**08:01:** The platform's claims are now checked in code. qnfo.org/platform shows 7 of 7 claims passing, read from the fleet's live records. The same 7 checks also run every hour as failure detectors. If a claim stops being true, the page shows it failing and the fleet files it as a failure to fix. The product questions and the four owner-only steps (domain, trademark, GitHub organisation, forming the company) are on fleet.qnfo.org/focus.

**08:23:** Your name and the platform now point at each other. qnfo.org/platform says "Directed by Rowan Brad Quni-Gudzinas", carries author metadata, and links to your site, ORCID, GitHub and LinkedIn. Your website, GitHub profile and CV all link back to it. qnfo.org/platform stands in as the product's home for now. Three tap questions on fleet.qnfo.org/focus (where the product should live, which GitHub org, whether to show your name) update the platform page on their own.

## Final checklists

1. Position QNFO's platform as a product of its own: research the landscape; gather evidence from qnfo-workers and live D1; define the product and pick a name (Ultrastable; partial domain/GitHub/trademark checks); product page, repo split check, owner questions and cards (QNFO/qnfo-workers #10156); brand doc, CV and PDF, website, GitHub profile merged (resume #11, rwnq8.github.io #10, rwnq8 #7). Done.
2. Back every claim with a live check: qnfo.org/platform and hourly claim contracts (#10172), fixed the 4 probes that could not run (#10182), migration fix (#10171). Verified 7 of 7 passing live; issue closed. Done.
3. Link personal brand and Ultrastable: platform page credits Rowan with author schema and profile links (#10190, live); credit and name driven by owner answers with no deploy; website, GitHub profile and CV link to the platform (resume #12, rwnq8.github.io #11, rwnq8 #8). Done.
4. Put Ultrastable on its own domain: found ultrastable.io, .app and .net in the Cloudflare account (bought 2026-11-10); ultrastable.io serves the platform page, .app and .net redirect (#10200, merged). Hostname attach and pointing the personal surfaces at ultrastable.io were still running when this copy was made.

## Decisions recorded in the thread
- Category: self-governing development platform. Name: Ultrastable (W. Ross Ashby, Design for a Brain, 1952); alternate Homeostat.
- Pitch: "Vibe coding writes the code you ask for. Ultrastable decides what to build next, ships it, proves it live, and keeps score of how often it was right."
- Rowan "directs" the platform; "designed and directs" only after a yes on the product-design-credit question.
- Evidence quoted (2026-11-10): 3,880 merged PRs since 2026-08-10 (624 by the code loop, 416 by Copilot), 1,056 decisions scored with 771 matched, 39 live workers. Honest gaps: one installation, 563 open issues, self-scored predictions.
- Never claim customers, revenue or a company until the owner cards close.
