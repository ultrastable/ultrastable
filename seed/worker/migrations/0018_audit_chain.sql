-- AUDIT-CHAIN-1 (2026-11-17): the hot half of the tamper-evident audit trail. Rows stay here for hot_days, then seal into append-only
-- archive segments outside D1 (seed/worker/src/auditchain.js). Every query is by primary key or index, never a scan.
CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY,            -- gapless, assigned by the chain
  at INTEGER NOT NULL,                -- when the event happened (ms)
  rec INTEGER NOT NULL,               -- when it was recorded (ms)
  kind TEXT NOT NULL,                 -- deploy | decision | outcome | handoff | archive:<table> | ...
  actor TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',       -- the thing it is about: item id, PR, worker, commit
  summary TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',    -- small JSON, secrets and contact details removed
  prev TEXT NOT NULL,                 -- hash of the previous row
  hash TEXT NOT NULL                  -- sha256(prev, canonical row)
);
CREATE INDEX IF NOT EXISTS audit_log_ref ON audit_log(ref, seq);
CREATE INDEX IF NOT EXISTS audit_log_kind ON audit_log(kind, at);
CREATE TABLE IF NOT EXISTS audit_segments (
  seq_from INTEGER PRIMARY KEY,
  seq_to INTEGER NOT NULL,
  count INTEGER NOT NULL,
  at_min INTEGER NOT NULL,
  at_max INTEGER NOT NULL,
  prev_hash TEXT NOT NULL,
  last_hash TEXT NOT NULL,
  merkle_root TEXT NOT NULL,
  sha256 TEXT NOT NULL,               -- of the compressed segment bytes
  chain TEXT NOT NULL,                -- hash chain over segments
  bloom TEXT NOT NULL,                -- base64 filter over refs: lookups open only segments that may hold the ref
  kinds TEXT NOT NULL DEFAULT '{}',
  sinks TEXT NOT NULL DEFAULT '[]',
  sealed_at INTEGER NOT NULL
);
