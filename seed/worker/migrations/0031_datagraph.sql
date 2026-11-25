-- DATAGRAPH-1: the knowledge graph of all this system's data (nodes, edges with first_seen and valid_to, insights, runs); written by the tick step knowledge-graph (src/datagraph.js).
CREATE TABLE IF NOT EXISTS kg_nodes (id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT, props TEXT, hash TEXT, source TEXT, first_seen TEXT NOT NULL, changed_at TEXT NOT NULL, valid_to TEXT);
CREATE TABLE IF NOT EXISTS kg_edges (src TEXT NOT NULL, rel TEXT NOT NULL, dst TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed', confidence REAL, source TEXT, why TEXT, first_seen TEXT NOT NULL, valid_to TEXT, outcome TEXT, PRIMARY KEY (src, rel, dst));
CREATE INDEX IF NOT EXISTS kg_edges_dst ON kg_edges (dst);
CREATE INDEX IF NOT EXISTS kg_nodes_kind ON kg_nodes (kind);
CREATE TABLE IF NOT EXISTS kg_insights (id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT, text TEXT NOT NULL, score REAL, prediction TEXT, probe TEXT, state TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, item_id TEXT);
CREATE TABLE IF NOT EXISTS kg_runs (at TEXT PRIMARY KEY, summary TEXT NOT NULL);
