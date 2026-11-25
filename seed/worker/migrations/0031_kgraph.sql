-- KGRAPH-1: every system's knowledge graph as the tick step `kgraph` last read it (one row per system) and its daily series; written by seed/worker/src/kgraph.js.
CREATE TABLE IF NOT EXISTS kgraph_state (system TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL, url TEXT, nodes INTEGER, edges INTEGER, communities INTEGER, insights INTEGER, problems INTEGER, last_run TEXT, summary TEXT, error TEXT, checked_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kgraph_series (system TEXT NOT NULL, day TEXT NOT NULL, row TEXT NOT NULL, PRIMARY KEY (system, day));
