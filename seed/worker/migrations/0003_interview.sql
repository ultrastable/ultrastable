-- Interview answers: the owner's clicks. One row per question; value is JSON. Additive only.
CREATE TABLE IF NOT EXISTS interview_answers (
  qid TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  answered_at TEXT NOT NULL DEFAULT (datetime('now'))
);
