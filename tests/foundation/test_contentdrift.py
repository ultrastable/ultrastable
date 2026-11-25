# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CONTENT-DRIFT-1: published self-written entries are read and judged; a bad or unreadable feed fails."""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import contentdrift as C  # noqa: E402

GOOD = "Most people believe the experiment showed that ordinary people turn cruel in a uniform. The recordings show the guards were coached to be tough."


class ContentDrift(unittest.TestCase):
    def setUp(self):
        self.c = C.cfg()

    def test_declaration(self):
        self.assertEqual(C.check(), [])

    def test_good_feed_passes(self):
        items = [{"id": str(i), "title": f"Entry {i}", "content_text": GOOD + f" Case {i}."} for i in range(10)]
        self.assertTrue(C.judge({"items": items}, self.c)["ok"])

    def test_problems(self):
        self.assertIn("no text", C.problems({"title": "x"}, self.c))
        self.assertIn("ends mid-sentence", C.problems({"title": "x", "content_text": GOOD + " and then the"}, self.c))
        self.assertTrue(any("placeholder" in p for p in C.problems({"title": "undefined", "content_text": GOOD}, self.c)))
        self.assertTrue(any("stock phrasing" in p for p in C.problems({"title": "x", "content_text": "Let us delve into it. " + GOOD}, self.c)))
        self.assertEqual(C.problems({"title": "x", "content_html": "<p>" + GOOD + "</p>"}, self.c), [])

    def test_drifted_feed_fails(self):
        items = [{"id": str(i), "title": "Same", "content_text": GOOD} for i in range(10)]
        j = C.judge({"items": items}, self.c)
        self.assertFalse(j["ok"]); self.assertEqual(len(j["bad"]), 9)
        self.assertFalse(C.judge({"items": []}, self.c)["ok"], "an empty feed is never a pass")

    def test_unreadable_feed_fails(self):
        def boom(url):
            raise OSError("refused")
        out = C.live(get=boom)
        self.assertTrue(out and all("unreadable" in m for m in out))


if __name__ == "__main__":
    unittest.main()
