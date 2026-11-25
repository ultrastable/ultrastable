---
consumer: foundation/datagraph.py
---
# Knowledge graphs for autonomous insight: research and design (DATAGRAPH-1)

> Ultrastable is the foundation for any autonomous system.

Owner directive (Rowan, 2026-11-25): "All UltraStable deployments and systems shall have a knowledge graph (graph network) to automatically build and
maintain a graph of connections for all data. Research the use and best practices for deploying graph networks for autonomous insights."

This file records what the research found, which practices were adopted, which were rejected and why, and where each one lives in code. It is read by
`foundation/datagraph.py` (named in `doctrine/knowledge-graph.json`) and by every agent that extends the graph.

## 1. What the platform already had

| Module | What it does | Gap it left |
|---|---|---|
| `workers/core/kgraph` | typed nodes and edges with provenance, gaps and questions, proposed vs confirmed edges | one KV blob; nothing fills it automatically |
| `workers/core/connect` (CONNECT-1) | embeddings plus graph; transfer, bridge and Swanson closure leads; calibration | needs a tenant to hand it items |
| `workers/core/discover` (DISCOVER-1) | int8 vectors, kNN graph, communities, novelty ledger | same: runs on what a tenant passes in |

None of them built a graph of *all* of a system's data without a person choosing what goes in. That is the gap DATAGRAPH-1 closes; the three modules
above stay, and the new graph is their input (its nodes and leads are what `connect` and `discover` embed and score).

## 2. Findings from the literature and current practice

1. **Graph RAG pays off for multi-hop and global questions, not for single-fact lookups.** Microsoft's GraphRAG (Edge et al., 2024, arXiv 2404.16130)
   builds an entity graph with an LLM, clusters it with Leiden and pre-summarizes each community, which wins on "what are the themes across everything"
   questions but makes indexing expensive. A 2025 benchmark study ("When to use Graphs in RAG", arXiv 2506.05690) finds graph retrieval often does not beat
   plain retrieval on simple questions. Practice adopted: the graph is for structure and insight first; retrieval uses it as local context around a node
   (`/api/graph/node?depth=2`), not as a replacement for search.
2. **Personalized PageRank over a graph is a cheap, strong retrieval signal.** HippoRAG and later CPU-only graph retrieval work (arXiv 2602.23372) rank
   nodes by random walks seeded at the query's entities, with no LLM in the ranking loop. Adopted: PageRank and bounded neighbourhoods are computed in
   the Worker; no model ranks anything.
3. **LLM extraction is the costliest and least reliable step; schema first, LLM second.** GraphRAG-style pipelines spend most of their budget on
   extraction, and extracted triples drift. A system that already stores its data in tables has most of its relations in the data itself: foreign keys,
   ids written in text, shared values. Adopted: deterministic extraction from the data (a value equal to another row's key is an edge; an id inside text
   is a `mentions` edge), with confidence by route (declared 1.0, reference column 0.95, value match 0.85, text mention 0.6). An LLM pass is left as an
   optional later stage for free text, behind the AI budget governor.
4. **Keep graphs current with temporal edges, not overwrites.** Zep's Graphiti (arXiv 2501.13956) keeps a bi-temporal graph: each fact has when it became
   true and when it stopped, so old facts are invalidated, never deleted, and the graph can be read as of any time. Adopted: `kg_nodes` and `kg_edges`
   carry `first_seen` and `valid_to`; a row that leaves the data is closed, a changed row is rewritten only when its content hash changes, so a quiet
   system costs reads and almost no writes.
5. **Topology heuristics remain hard to beat for link prediction.** Adamic-Adar and common-neighbour scores are standard baselines and stay competitive
   with learned and LLM predictors on real networks (Liben-Nowell and Kleinberg 2007; arXiv 2604.01379 on co-authorship). Swanson's ABC model of
   literature-based discovery is the same idea in research: A links to B, B to C, so A to C is worth a look. Adopted: Adamic-Adar over two-hop pairs,
   capped per node so a hub cannot fill the list, and a single shared neighbour is not enough evidence.
6. **A suggested connection is a hypothesis; it must be scored.** Earlier fleets admitted far more candidate links than anything checked. Adopted: a lead
   is a `proposed` edge, never structure; it is `kept` when the data later links the pair by any route, `dropped` after 14 days, and the outcomes
   re-weight the insight kinds (Beta prior, bounded 0.5 to 1.5, unchanged below 3 outcomes), as `core/connect` already does.
7. **Insight comes from structure: hubs, bridges, communities and the unconnected.** Community detection (Louvain and Leiden) and centrality are the
   standard tools for "what matters and what is isolated". Adopted: PageRank hubs, label-propagation communities (deterministic, no dependency; Leiden is
   the upgrade path when a graph outgrows it), bridges by participation coefficient, components, and orphans per kind. An orphaned kind is the most
   actionable finding: data nobody connected.
8. **Graph storage on the edge: adjacency tables in SQLite are enough at this scale.** Practitioners run knowledge graphs on D1 and SQLite with edge
   tables and recursive CTEs, moving to a dedicated graph store only when traversal depth or size demands it. Adopted: two D1 tables with an index on
   `dst`, bounded reads per pass, analysis in memory. Vectors stay where `core/discover` keeps them (packed int8, Vectorize past 20,000).
9. **Privacy: a graph of all data joins things that were separate.** Linking records is itself a disclosure risk. Adopted: secret-shaped and personal
   tables (credentials, tokens, sessions, inboxes, interview answers, subscribers) and columns (email, phone, address, ip, tokens) are never read; the
   public view shows counts, orphan findings and only kinds a system declares public; the owner's bearer sees the rest.

## 3. Design, as built

| Piece | Where | What it does |
|---|---|---|
| Core module | `workers/core/datagraph/index.js` | `extract`, `analyze`, `predict`, `insights`, `settle`, `calibrate`, `neighborhood`; pure, no I/O, no model |
| Seed tick step | `seed/worker/src/datagraph.js`, step `knowledge-graph` | every 6 h: read every table (6,000 rows per pass), diff by hash, write changes, analyse, settle and propose leads, file `KG-ORPHANS-<kind>` |
| Storage | `seed/worker/migrations/0031_datagraph.sql` | `kg_nodes`, `kg_edges` (bi-temporal), `kg_insights`, `kg_runs` (400-day series) |
| Read side | `seed/worker/src/index.js`, `site/worker.js` | `/api/graph`, `/api/graph/insights`, `/api/graph/node`, `/api/graph/search`, `/graph` |
| Inheritance | `doctrine/knowledge-graph.json`, `doctrine/tenant-repos.json` | every system has a row; tenants get the module vendored and a `Q-KG-*` item that wires it |
| Check | `python3 -m foundation datagraph --check` | fails a system with no graph, a drifted vendor copy, an unwired step or a missing rule |

Config a system may set (in its `knowledge_graph` block): `every_min`, `max_rows_total`, `max_rows_per_table`, `skip`, `declared` (kinds, labels and
reference columns for a table), `public_kinds`, `enabled: false`.

## 4. What is not built yet, with the item that carries it

- Tenants on their own Workers: `Q-KG-practical-solutions`, `Q-KG-unlearn`, `Q-KG-what-works`, `Q-KG-replication-ledger`.
- An LLM extraction pass for free text, and Leiden instead of label propagation, are upgrade paths; each will be filed by the improvement loop when the
  graph's own measures (orphan share, kept rate of leads) show the deterministic route has stopped improving.

## Sources

- Edge et al., From Local to Global: A GraphRAG Approach to Query-Focused Summarization: https://arxiv.org/html/2404.16130v2
- When to use Graphs in RAG: https://arxiv.org/pdf/2506.05690
- Democratizing GraphRAG: Linear, CPU-Only Graph Retrieval for Multi-Hop QA: https://arxiv.org/html/2602.23372
- Zep: A Temporal Knowledge Graph Architecture for Agent Memory: https://arxiv.org/html/2501.13956
- Graphiti: https://github.com/getzep/graphiti
- Topology heuristics vs LLM link prediction: https://arxiv.org/pdf/2604.01379
- Literature-based discovery (Swanson linking): https://www.wikipedia.org/wiki/Swanson_linking
- SQLite as a graph database (recursive CTEs): https://dev.to/rohansx/sqlite-as-a-graph-database-recursive-ctes-semantic-search-and-why-we-ditched-neo4j-1ai
- Knowledge graphs on Cloudflare D1 and Vectorize: https://dev.to/yedanyagamiaicmd/edge-native-knowledge-graphs-with-cloudflare-d1-vectorize-no-database-server-required-5a9l
