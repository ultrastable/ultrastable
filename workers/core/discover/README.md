<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/discover: a knowledge graph and vector index that keep finding new connections (DISCOVER-1)

Every Ultrastable system has things it knows (problems, solutions, items, findings) and links between them. This module embeds them, keeps
the vectors, and on every run proposes connections nobody has drawn yet, screens them for novelty, and scores itself against what the system
later adopts. It is how a system answers questions in plain words (vector retrieval for `core/ask`) and how it generates its own next ideas.

Origin: QNFO's research graph (`qnfo-graph`: 12,903 nodes, 20,575 edges, 743 int8 embeddings, communities, bridge and link-candidate gaps)
and its novelty screen. What was kept and what was dropped:

| Kept | Dropped (the bottleneck it caused) |
|---|---|
| content-hashed embeddings, re-embedded only on change | the graph in a database read by scans (billions of rows read a month) |
| int8 vectors (4x smaller), exact cosine search | a metered vector query per lookup for a corpus small enough to search in memory |
| semantic plus explicit edges, communities | a model in the ranking loop (cost and drift); models only word the top few, labelled as such |
| bridge and link-candidate gaps, novelty labels (duplicate, partial, none) | one runner holding a lease; here the whole run is a pure function a CI job or a Worker can call |

## Pieces

| Piece | Status |
|---|---|
| `refreshEmbeddings`: incremental, bounded per run, a failed batch never erases a good vector | BUILT |
| `pack` / `unpack` / `nearest`: int8 matrix, JSON-safe, exact search | BUILT |
| `packedPort`, `vectorizePort`, `choosePort`: below `promoteAt` (20,000 vectors) the packed index answers; above it a Vectorize index does | BUILT |
| `discover`: kNN graph, self-calibrated threshold (`pct` quantile), label-propagation communities, transfer / combination / bridge / frontier candidates, novelty screen | BUILT |
| `mergeLedger`: new, standing, confirmed (the system later linked it), dropped (stopped ranking, with reason); bounded with counted retirements | BUILT |
| `tune` and `scorePrediction`: one knob, one step, a logged prediction scored next run | BUILT |
| `rrf`, `explain` | BUILT |
| Vector retrieval in `core/ask` (`semantic` hook) | BUILT (in core/ask) |
| `/embed` on `core/modelservice` (OIDC, allow-listed embedding models) | BUILT (in core/modelservice) |

## Why packed first, Vectorize second

Vectorize bills a query as (stored vectors + 1) x dimensions. At 1,500 vectors of 384 dimensions one query is about 0.58 million queried
dimensions, so the free allocation of 30 million a month covers about 50 queries. The same search over an int8 matrix in a Worker is about
0.6 million multiply-adds and costs nothing metered. Small corpora stay packed; `choosePort` moves a system to Vectorize when it outgrows that.

Tests: `discover.test.js` (a synthetic world with planted connections).
