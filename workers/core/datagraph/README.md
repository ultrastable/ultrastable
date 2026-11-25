<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/datagraph: a knowledge graph of all of a system's data (DATAGRAPH-1)

Every Ultrastable system keeps a graph of connections across everything it stores, built with no configuration. Pure functions over rows a caller read:

- `extract(tables, { declared, skip })`: every row becomes a node (`<table>:<key>`); a value equal to another row's key becomes an edge named after its column; an id written in text becomes a `mentions` edge. Secret-shaped and personal tables and columns are never read (`SKIP_TABLE`, `SKIP_COL`).
- `analyze(graph)`: degree, PageRank hubs, label-propagation communities, components, bridges (participation coefficient), orphans per kind.
- `predict(graph, { known })`: Adamic-Adar link leads between two-hop pairs, capped per node.
- `insights(...)`: orphaned kinds, bridges, new hubs, fragmentation and link leads, each with a stable id, a prediction (`<metric> <op> <n> within <N> h`) and a probe.
- `settle(proposed, graph)` and `calibrate(outcomes)`: a lead is kept when the data later links the pair, dropped after 14 days; kind weights learn from the outcomes.
- `neighborhood(graph, id)`: bounded local context for retrieval.

The seed's tick step (`seed/worker/src/datagraph.js`) runs it over the system's own D1 and keeps the result bi-temporally. Research and design: `docs/research/knowledge-graph.md` in `ultrastable/ultrastable`.

Owner role: knowledge. Trigger: the tick step `knowledge-graph`, every 6 hours. Closing probe: `datagraph.test.js`. Status: BUILT.
