-- PLUSSING-1 (2026-10-29, charter pillar autonomy). Owner prompt 2026-10-29: products should keep improving automatically, without the owner prompting; plussing as a fleet philosophy.
-- Adds the product register, the plus ledger and the due view that the manager tick reads (docs/PLUSSING.md); roadmap rows PLUS-1..6.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_product_plus_due; DROP TABLE IF EXISTS plus_ledger; DROP TABLE IF EXISTS product_registry; DELETE FROM roadmap_implementation WHERE source = 'plussing-2026' AND item IN ('PLUS-1','PLUS-2','PLUS-3','PLUS-4','PLUS-5','PLUS-6');

CREATE TABLE IF NOT EXISTS product_registry (
  product TEXT PRIMARY KEY,
  host TEXT,
  worker TEXT,
  program_code TEXT NOT NULL,
  what_for TEXT,
  usage_metric TEXT,
  quality_measure TEXT,
  plus_cadence_h INTEGER NOT NULL DEFAULT 168,
  last_plus_at TEXT,
  rest_until TEXT,
  misses_in_row INTEGER NOT NULL DEFAULT 0,
  pluses_since_simplify INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS plus_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'plus',
  title TEXT,
  evidence TEXT,
  predicted_outcome TEXT,
  metric TEXT,
  issue_id INTEGER,
  pr_url TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  outcome TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  decided_at TEXT
);

CREATE VIEW IF NOT EXISTS v_product_plus_due AS
SELECT p.product, p.host, p.program_code, p.last_plus_at,
  CAST((julianday('now') - julianday(COALESCE(p.last_plus_at, p.created_at))) * 24 AS INTEGER) AS hours_since_plus,
  p.plus_cadence_h, p.misses_in_row, p.pluses_since_simplify,
  CASE WHEN p.pluses_since_simplify >= 4 THEN 'simplify' ELSE 'plus' END AS next_kind,
  (SELECT COUNT(*) FROM plus_ledger l WHERE l.product = p.product AND l.status IN ('proposed','building')) AS in_flight
FROM product_registry p
WHERE p.state = 'active'
  AND (p.rest_until IS NULL OR p.rest_until <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  AND (julianday('now') - julianday(COALESCE(p.last_plus_at, p.created_at))) * 24 >= p.plus_cadence_h
ORDER BY hours_since_plus DESC;

-- ULTRASTABLE-TENANT-1: tenant data (QNFO seed/ledger rows) removed from the product copy; seed your own in your tenant repo.
