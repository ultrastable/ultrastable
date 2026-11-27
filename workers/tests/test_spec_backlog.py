# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import spec_backlog as sb  # noqa: E402

SPEC = """# US-SPEC-07: Example

## 5. Requirements

| ID | Text |
|---|---|
| R1 | not a status row BUILT |

## 11. Reference implementation status

| Capability | Status |
|---|---|
| Change path with probes | BUILT (`core/deploy`) |
| Fleet-wide rollout | PLANNED |
| Review gate | RUNNING in the reference fleet; not generalized |
| Lock | RUNNING and BUILT in `core/claims` |

## 12. Appendix

| X | PLANNED |
"""


BULLETS = """# US-SPEC-05: Bullets

## 9. Implementation status

- BUILT: the tick (`core/src/tick.js`)
- PLANNED: the review gate for protected paths
- **PLANNED** the second route, no colon in this one
- RUNNING: the nightly sweep in the reference fleet; not generalized
- A plain note that carries no label
"""


class SpecBacklog(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        (Path(self.tmp.name) / "US-SPEC-07-example.md").write_text(SPEC, encoding="utf8")
        self.rows = sb.collect(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def test_only_the_status_section_counts(self):
        self.assertEqual([r["label"] for r in self.rows], ["BUILT", "PLANNED", "RUNNING_ONLY", "BUILT"])

    def test_summary_remaining_is_planned_plus_running_only(self):
        s = sb.summary(self.rows)
        self.assertEqual((s["BUILT"], s["PLANNED"], s["RUNNING_ONLY"], s["remaining"]), (2, 1, 1, 2))

    def test_items_exclude_built_and_say_what_to_do(self):
        its = sb.items(self.rows)
        self.assertEqual(len(its), 2)
        self.assertTrue(its[0]["title"].startswith("Build:"))
        self.assertTrue(its[1]["title"].startswith("Generalize"))

    def test_sql_loads_into_the_seed_schema_and_is_idempotent(self):
        db = sqlite3.connect(":memory:")
        for f in sorted((ROOT / "core" / "migrations").glob("*.sql")):
            db.executescript(f.read_text(encoding="utf8"))
        script = sb.sql(sb.items(self.rows))
        db.executescript(script)
        db.executescript(script)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM items WHERE project='spec-to-code'").fetchone()[0], 2)

    def test_apostrophes_are_escaped(self):
        its = [{"id": "X", "title": "it's", "kind": "work", "project": "p", "owner_role": "staff", "priority": 1, "done_check": "d", "closing_probe": "manual"}]
        db = sqlite3.connect(":memory:")
        for f in sorted((ROOT / "core" / "migrations").glob("*.sql")):
            db.executescript(f.read_text(encoding="utf8"))
        db.executescript(sb.sql(its))
        self.assertEqual(db.execute("SELECT title FROM items WHERE id='X'").fetchone()[0], "it's")


if __name__ == "__main__":
    unittest.main()


class BulletLabels(unittest.TestCase):
    """A bullet whose status word stands in the head (before the first colon) is a status row too; reading only the text after the colon skipped every
    '- PLANNED: ...' bullet, so the backlog's `remaining` number left them out (US-SPEC-05, 06, 07)."""

    def test_a_label_in_the_head_of_a_bullet_counts(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "US-SPEC-05-bullets.md").write_text(BULLETS, encoding="utf8")
            rows = sb.collect(Path(d))
        self.assertEqual([r["label"] for r in rows], ["BUILT", "PLANNED", "PLANNED", "RUNNING_ONLY"])
        s = sb.summary(rows)
        self.assertEqual((s["PLANNED"], s["RUNNING_ONLY"], s["remaining"]), (2, 1, 3))
