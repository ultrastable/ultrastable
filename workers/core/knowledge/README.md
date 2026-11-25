<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/knowledge: every system keeps a graph of its own data and generates insights from it (KNOWLEDGE-GRAPH-1)

Tenant-agnostic. A system hands over **records**; the module resolves duplicates, links them with provenance, measures the graph, predicts missing links and
writes insights that flow into `/changes` and the next release. A pure function (`run`), so CI, a Worker tick or a test call it the same way.

## Interface (what a tenant supplies)
`record = { id, kind, title, text?, refs?: [id], entities?: [name], source, url?, at }` and optionally `extra = [{ a, b, w, rel, source }]` (semantic leads from `core/discover`, always labelled `lead`).
`run({ records, extra, store })` returns `{ stats, insights, snapshot, leads, first }`; `store` is `{ get, put }` (KV, R2 wrapper or a file). Each insight is `{ at, kind: 'graph_*', id, evidence, conf }`, shaped like a `/changes` event.
The tenant keeps its records, snapshot and insights in its own storage; core holds no tenant data.

## Practices applied (and why)
| Practice | Here |
|---|---|
| Entity resolution before linking (duplicates split a node's links and distort centrality) | `resolve`: normalised-token key plus Jaccard near-duplicate within a kind, union-find, aliases kept |
| Provenance on every fact (source, time, rule); inferred links kept apart from facts | every edge has `source`, `at`, `conf: fact\|lead`; leads never enter centrality or communities |
| Incremental updates (re-process only what changed) | content hash per node; the snapshot diff drives the insights (growth, revised, removed, new links, rising) |
| Link prediction | Adamic-Adar over shared neighbours: deterministic, no training data, no model cost; semantic similarity enters from `core/discover` |
| Community structure and bridges (the GraphRAG insight: summarise by community, not by document) | label propagation (shared with discover), bridge nodes spanning 3+ groups, hubs by PageRank |
| Insights from facts, not free generation | text is templated from computed facts with evidence ids; a model may only word them later, labelled |
| Cheap storage on Cloudflare | compact int/str snapshot (about 60 bytes a node) in KV/R2/a committed file; no per-query D1 scans; Vectorize only past `core/discover`'s `promoteAt` |

Not covered: typed relation extraction from free text (needs a model; tenants may pass its output as `refs`/`entities`), graphs past about 50,000 nodes (the near-duplicate pass is capped at 2,000 per kind; move to blocking keys then).

Owner role: knowledge. Trigger: a tenant's graph run (daily) or a change to its records. Closing probe: `knowledge.test.js`. Status: BUILT.
