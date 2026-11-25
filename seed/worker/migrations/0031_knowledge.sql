-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- KGRAPH-1: the knowledge graph every system keeps (src/knowledge.js carries the same DDL; test/knowledge.test.js keeps them equal).
CREATE TABLE IF NOT EXISTS kg_nodes (tenant TEXT NOT NULL, id TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, props TEXT NOT NULL DEFAULT '{}', first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, retired_at INTEGER, PRIMARY KEY (tenant, id, source));
CREATE TABLE IF NOT EXISTS kg_edges (tenant TEXT NOT NULL, src TEXT NOT NULL, rel TEXT NOT NULL, dst TEXT NOT NULL, source TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1, why TEXT, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, retired_at INTEGER, PRIMARY KEY (tenant, src, rel, dst, source));
CREATE TABLE IF NOT EXISTS kg_sources (tenant TEXT NOT NULL, source TEXT NOT NULL, hash TEXT NOT NULL, at INTEGER NOT NULL, retired_at INTEGER, PRIMARY KEY (tenant, source));
CREATE TABLE IF NOT EXISTS kg_insights (tenant TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL, object TEXT, text TEXT NOT NULL, score REAL NOT NULL, status TEXT NOT NULL DEFAULT 'open', at INTEGER NOT NULL, due_at INTEGER NOT NULL, settled_at INTEGER, follows INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tenant, id));
CREATE TABLE IF NOT EXISTS kg_runs (tenant TEXT NOT NULL, at INTEGER NOT NULL, ms INTEGER NOT NULL, nodes INTEGER NOT NULL, edges INTEGER NOT NULL, communities INTEGER NOT NULL, modularity REAL, added INTEGER NOT NULL, changed INTEGER NOT NULL, retired INTEGER NOT NULL, insights_new INTEGER NOT NULL, kept INTEGER NOT NULL, dropped INTEGER NOT NULL, error TEXT, PRIMARY KEY (tenant, at));
CREATE TABLE IF NOT EXISTS kg_state (tenant TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (tenant, k));
CREATE INDEX IF NOT EXISTS kg_nodes_live ON kg_nodes (tenant, retired_at);
CREATE INDEX IF NOT EXISTS kg_edges_live ON kg_edges (tenant, retired_at);
CREATE INDEX IF NOT EXISTS kg_insights_status ON kg_insights (tenant, status);
