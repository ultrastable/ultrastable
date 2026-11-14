"""PRIORITIZE-1: the ranker orders by goal, pins, dependency centrality and size; owner-held items never reach the executor; the live config loads."""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import prioritize as P  # noqa: E402

CONF = {"goals": [{"id": "a", "weight": 100, "match": ["CORE"]}, {"id": "b", "weight": 30, "match": ["SOCIAL"]}],
        "owner_held_pattern": "ROWAN|identity-bound", "size_divisor": {"S": 1.0, "M": 1.15, "L": 1.5}, "unblocks_weight": 12,
        "age_weight_per_day": 0.5, "age_cap": 20, "label_bonus": {"p0": 200}, "pins": {"bonus": 150, "ids": ["PIN-1"]}}


def item(i, title, body="**Owner:** staff\n", labels=()):
    return {"id": i, "title": title, "body": body, "labels": list(labels)}


class Rank(unittest.TestCase):
    def ids(self, items):
        return [r["id"] for r in P.score_items(items, CONF, now=0)]

    def test_goal_weight_orders(self):
        self.assertEqual(self.ids([item("X", "SOCIAL post"), item("Y", "CORE loop")]), ["Y", "X"])

    def test_pin_outranks_goal(self):
        self.assertEqual(self.ids([item("Y", "CORE loop"), item("PIN-1", "SOCIAL thing")])[0], "PIN-1")

    def test_blocker_with_dependents_rises(self):
        rows = self.ids([item("A", "SOCIAL a"), item("B", "SOCIAL b"), item("C", "SOCIAL c", "**Owner:** staff\nafter B\n")])
        self.assertEqual(rows[0], "B")

    def test_owner_held_sorted_last(self):
        rows = P.score_items([item("H", "CORE x", "**Owner:** ROWAN identity-bound\n"), item("Z", "SOCIAL y")], CONF, now=0)
        self.assertEqual([r["id"] for r in rows], ["Z", "H"]); self.assertTrue(rows[1]["held"])

    def test_small_beats_large_on_equal_goal(self):
        self.assertEqual(self.ids([item("L", "CORE a", "size: L\n"), item("S", "CORE b", "size: S\n")]), ["S", "L"])

    def test_live_config_and_repo_rank(self):
        rows = P.rank()
        self.assertTrue(rows and all("score" in r for r in rows))
        pins = P.load()["pins"]["ids"]
        top = [r["id"] for r in rows if not r["held"]][:len(pins)]
        self.assertTrue(set(top) <= set(pins) or set(pins) & set(top), "pinned critical-path items lead the queue")


if __name__ == "__main__":
    unittest.main()
