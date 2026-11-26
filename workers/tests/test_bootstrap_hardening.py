# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""Bootstrapper hardening (US-10-R02, US-10-R05, US-10-R06): three defects found by running it.

1. apply with a GitHub org and no org token died with a KeyError and wrote no boot log.
2. an invalid policy booted when IDEA.md was missing, because the policy was only validated after the idea was read.
3. cards added after `write` (GATE-LADDER, GATE-ORG-TOKEN) reached gate-cards.json but not seed.sql.
"""
import json
import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bootstrap"))
sys.path.insert(0, str(ROOT / "tests"))
import bootstrap as bs  # noqa: E402
from test_seed import Hermetic, copy_seed  # noqa: E402

CARD_FIELDS = ("what", "why_gated", "default_in_effect", "prepared_by_fleet", "closing_probe")


def set_front(idea: Path, **kv):
    text = idea.read_text()
    lines = "".join(f"{k}: {v}\n" for k, v in kv.items())
    idea.write_text(re.sub(r"^---\n", "---\n" + lines, text, count=1) if text.startswith("---\n") else f"---\n{lines}---\n{text}")


class Hardening(Hermetic):
    def test_apply_with_github_org_and_no_org_token_exits_2_not_a_traceback_and_writes_boot_log(self):
        """US-10-R05: a blocked stage is a backlog item and the boot goes on; it never dies with a traceback."""
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            copy_seed(root)
            set_front(root / "IDEA.md", github_org="acme")
            self.assertEqual(bs.main(["--root", str(root), "--apply"]), 2)
            org = root / "org"
            self.assertTrue((org / "boot-log.json").exists(), "the boot log is written even when a stage blocks")
            backlog = {i["id"] for i in json.loads((org / "backlog.json").read_text())}
            self.assertIn("BOOT-ORG", backlog)
            cards = json.loads((org / "gate-cards.json").read_text())
            token = [c for c in cards if c["id"] == "GATE-ORG-TOKEN"]
            self.assertEqual(len(token), 1)
            for c in cards:
                for f in CARD_FIELDS:
                    self.assertTrue(c.get(f), f"{c['id']} lacks {f}")

    def test_invalid_policy_blocks_the_read_stage_even_without_an_idea_file(self):
        """US-10-R02: the policy is validated before the idea is considered."""
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            copy_seed(root)
            (root / "IDEA.md").unlink()
            pol = json.loads((root / "autonomy/policy.json").read_text())
            pol["surfaces"]["money"]["start_rung"] = "autonomous"
            (root / "autonomy/policy.json").write_text(json.dumps(pol))
            self.assertEqual(bs.main(["--root", str(root), "--dry-run"]), 2)
            org = root / "org"
            stages = {s["stage"]: s for s in json.loads((org / "boot-log.json").read_text())["stages"]}
            self.assertEqual(stages["read"]["status"], "blocked")
            self.assertIn("policy invalid", stages["read"]["detail"])
            self.assertIn("start", stages, "the boot continues past a blocked read")
            ids = {c["id"] for c in json.loads((org / "gate-cards.json").read_text())}
            self.assertIn("GATE-IDEA", ids)
            self.assertIn("BOOT-READ", {i["id"] for i in json.loads((org / "backlog.json").read_text())})

    def test_every_gate_card_in_gate_cards_json_is_a_gate_cards_row_in_seed_sql(self):
        """US-10-R06: a card added after write() is seeded too (the ladder card on a machine with no hosting sign-in)."""
        from importlib import import_module  # noqa: F401
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            copy_seed(root)
            self.assertEqual(bs.main(["--root", str(root), "--dry-run"]), 0)
            org = root / "org"
            cards = json.loads((org / "gate-cards.json").read_text())
            self.assertIn("GATE-LADDER", {c["id"] for c in cards}, "this scenario needs a card added after write()")
            db = sqlite3.connect(":memory:")
            for m in sorted((ROOT / "adapters/cloudflare/migrations").glob("*.sql")):
                db.executescript(m.read_text())
            db.executescript((org / "seed.sql").read_text())
            rows = {r[0] for r in db.execute("SELECT id FROM gate_cards")}
            self.assertEqual(rows, {c["id"] for c in cards})

    def test_invalid_policy_seeds_nothing_above_the_lowest_rung_and_apply_is_blocked(self):
        """US-10-R02: an invalid policy blocks the read stage, the seed never applies it, and apply provisions nothing."""
        for mode in ("--dry-run", "--apply"):
            with tempfile.TemporaryDirectory() as d:
                root = Path(d)
                copy_seed(root)
                pol = json.loads((root / "autonomy/policy.json").read_text())
                pol["surfaces"]["money"]["start_rung"] = "autonomous"
                (root / "autonomy/policy.json").write_text(json.dumps(pol))
                self.assertEqual(bs.main(["--root", str(root), mode]), 2)
                org = root / "org"
                db = sqlite3.connect(":memory:")
                for m in sorted((ROOT / "adapters/cloudflare/migrations").glob("*.sql")):
                    db.executescript(m.read_text())
                db.executescript((org / "seed.sql").read_text())
                lowest = pol["ladder"]["rungs"][0]
                above = db.execute("SELECT surface, action_class, rung FROM trust_ledger WHERE rung != ?", (lowest,)).fetchall()
                self.assertEqual(above, [], f"{mode}: a trust row starts above the lowest rung")
                self.assertGreater(db.execute("SELECT COUNT(*) FROM trust_ledger").fetchone()[0], 0)
                stages = {s["stage"]: s for s in json.loads((org / "boot-log.json").read_text())["stages"]}
                self.assertEqual(stages["read"]["status"], "blocked")
                if mode == "--apply":
                    for stage in ("provision", "start"):
                        self.assertEqual(stages[stage]["status"], "blocked", stage)
                        self.assertIn("policy invalid, not applied", stages[stage]["detail"])

    def test_the_seeded_gate_card_rows_hold_the_plain_words_lines(self):
        """US-10-R15: the console reads `what` and `default_in_effect` from the table, so those columns hold what a person reads."""
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            copy_seed(root)
            self.assertEqual(bs.main(["--root", str(root), "--dry-run"]), 0)
            org = root / "org"
            cards = {c["id"]: c for c in json.loads((org / "gate-cards.json").read_text())}
            db = sqlite3.connect(":memory:")
            for m in sorted((ROOT / "adapters/cloudflare/migrations").glob("*.sql")):
                db.executescript(m.read_text())
            db.executescript((org / "seed.sql").read_text())
            rows = db.execute("SELECT id, what, default_in_effect FROM gate_cards").fetchall()
            self.assertTrue(rows)
            for id_, what, default in rows:
                self.assertEqual(what, cards[id_]["say"], id_)
                self.assertEqual(default, cards[id_]["say_default"], id_)


if __name__ == "__main__":
    unittest.main()
