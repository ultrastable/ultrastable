<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/ask: grounded natural-language questions (ASK-1)

A tenant passes documents `{ id, url, title, text }`; `buildIndex` makes a plain-JSON BM25 index (ship it as a generated module). `answer(question, { index, generate?, lang })` retrieves, asks the model port to answer only from the numbered sources, then **verifies the reply**: a sentence is kept only if it cites an existing source, every number in it occurs in a cited source, and (in the source language) at least half its words do. If nothing survives or there is no model, the answer is extractive (quoted passages with links); if nothing matches, it says so (`mode: none`). `handleAsk` is the JSON endpoint (GET/POST), `allow` the per-caller rate limit and daily model budget on a `{get,put}` store, `chatPort(ai, model)` a Workers AI port. A question in another language is translated for retrieval and answered in that language.

| Piece | Status |
|---|---|
| BM25 retrieval, unicode tokens, CJK bigrams | BUILT |
| Grounding check (citations, numbers, wording) | BUILT |
| Extractive and no-answer modes; never fabricates | BUILT |
| Rate limit, daily model budget | BUILT |
| Vector retrieval | NOT COVERED (BM25 plus query translation is enough at this size and costs nothing) |

Tests: `ask.test.js`.
