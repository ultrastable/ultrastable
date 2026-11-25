-- KGRAPH-1: the knowledge graph every system builds from its own records (seed/worker/src/graph.js).
CREATE TABLE IF NOT EXISTS kg_nodes (id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, terms TEXT, vec TEXT, source TEXT, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS kg_nodes_updated ON kg_nodes (updated_at);
CREATE TABLE IF NOT EXISTS kg_edges (src TEXT NOT NULL, rel TEXT NOT NULL, dst TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed', why TEXT, at INTEGER NOT NULL, PRIMARY KEY (src, rel, dst));
CREATE INDEX IF NOT EXISTS kg_edges_dst ON kg_edges (dst);
CREATE TABLE IF NOT EXISTS kg_cursor (source TEXT PRIMARY KEY, last INTEGER NOT NULL DEFAULT 0, lag INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kg_leads (id TEXT PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL, score REAL NOT NULL, why TEXT, status TEXT NOT NULL DEFAULT 'open', item_id TEXT, at INTEGER NOT NULL, settled_at INTEGER);
CREATE TABLE IF NOT EXISTS kg_series (day TEXT PRIMARY KEY, nodes INTEGER NOT NULL, edges INTEGER NOT NULL, leads INTEGER NOT NULL, filed INTEGER NOT NULL, kept INTEGER NOT NULL, lag INTEGER NOT NULL);
