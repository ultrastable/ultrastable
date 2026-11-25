-- KNOWLEDGE-GRAPH-1: the graph snapshot (diff base) and the insights the tick step `knowledge` writes, one tenant row each.
CREATE TABLE IF NOT EXISTS knowledge_snapshots ( tenant_id TEXT NOT NULL, at TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (tenant_id) );
CREATE TABLE IF NOT EXISTS knowledge_insights ( id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, evidence TEXT NOT NULL );
CREATE INDEX IF NOT EXISTS knowledge_insights_at ON knowledge_insights(tenant_id, at);
