import os, unittest

from ultrastable.store import Store, pg_translate, pg_schema


class Translate(unittest.TestCase):
    def test_placeholders_and_percent(self):
        self.assertEqual(pg_translate("SELECT 1 WHERE a=? AND b LIKE '%[x]%' AND c=?"),
                         "SELECT 1 WHERE a=%s AND b LIKE '%%[x]%%' AND c=%s")

    def test_question_mark_in_literal_kept(self):
        self.assertEqual(pg_translate("SELECT 'what?''s' , ?"), "SELECT 'what?''s' , %s")

    def test_insert_or_ignore(self):
        self.assertEqual(pg_translate("INSERT OR IGNORE INTO claims (a) VALUES (?)"),
                         "INSERT INTO claims (a) VALUES (%s) ON CONFLICT DO NOTHING")

    def test_schema_dialect(self):
        s = pg_schema()
        self.assertNotIn("AUTOINCREMENT", s)
        self.assertIn("BIGSERIAL PRIMARY KEY", s)
        self.assertNotIn(" REAL", s)


class Contract(unittest.TestCase):
    """q/one/x/scalar behave identically on SQLite and (when ULTRASTABLE_TEST_DB is set) Postgres."""

    def setUp(self):
        url = os.environ.get("ULTRASTABLE_TEST_DB")
        self.s = Store(url) if url else Store(":memory:")
        if url:
            self.s.reset()

    def test_contract(self):
        s = self.s
        self.assertEqual(s.x("INSERT INTO projects (id,title,outcome,weight) VALUES (?,?,?,?)", "p", "P", "o", 2.5), 1)
        self.assertEqual(s.scalar("SELECT weight FROM projects WHERE id=?", "p"), 2.5)
        self.assertEqual(s.one("SELECT title FROM projects WHERE id=?", "p"), {"title": "P"})
        self.assertIsNone(s.one("SELECT * FROM projects WHERE id=?", "nope"))
        self.assertEqual(s.q("SELECT id FROM projects"), [{"id": "p"}])
        s.x("INSERT OR IGNORE INTO projects (id,title,outcome) VALUES (?,?,?)", "p", "dup", "o")
        self.assertEqual(s.scalar("SELECT title FROM projects WHERE id=?", "p"), "P")
        self.assertEqual(s.x("UPDATE projects SET title=? WHERE id=?", "Q", "p"), 1)

    def test_autoincrement_returns_id(self):
        a = self.s.x("INSERT INTO tick_runs (started_at, steps_total) VALUES (?,?)", "2026-11-10 09:00:00", 3)
        b = self.s.x("INSERT INTO tick_runs (started_at, steps_total) VALUES (?,?)", "2026-11-10 09:10:00", 3)
        self.assertEqual(b, a + 1)

    def test_sum_and_percent_literal(self):
        s = self.s
        for i, r in enumerate(["verified", "failed", "verified"]):
            s.x("INSERT INTO outcomes (surface,action_class,result,evidence,at) VALUES (?,?,?,?,?)", "x", "y", r, "[hidden]", "t")
        row = s.one("SELECT SUM(CASE WHEN result='verified' THEN 1 ELSE 0 END) ok, COUNT(*) n FROM outcomes")
        self.assertEqual(row, {"ok": 2, "n": 3})
        self.assertIsInstance(row["ok"], int)
        self.assertEqual(s.scalar("SELECT COUNT(*) FROM outcomes WHERE evidence LIKE '%[hidden]%'"), 3)

    def test_kv(self):
        self.s.put("k", {"a": 1}); self.s.put("k", {"a": 2})
        self.assertEqual(self.s.get("k"), {"a": 2})


if __name__ == "__main__":
    unittest.main()
