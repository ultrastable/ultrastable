-- UNKNOWNS-1 (2026-11-17): the tick's twin of `python3 -m foundation unknowns`. One row per question the tick asked, so a question is not
-- repeated within the cadence and the answer (the item closing) can be counted.
CREATE TABLE IF NOT EXISTS unknown_questions (
  key TEXT NOT NULL,
  at TEXT NOT NULL,
  lens TEXT NOT NULL,
  unit TEXT NOT NULL,
  item_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS unknown_questions_key ON unknown_questions(key, at);
