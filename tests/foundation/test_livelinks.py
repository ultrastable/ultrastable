# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""LIVE-LINKS-1: every README says where its code runs; the block is computed, replaced in place, and read back from GitHub."""
import unittest
from pathlib import Path
from foundation import livelinks as L

REPO = Path(__file__).resolve().parents[2]


class LiveLinks(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(L.check(REPO), [])

    def test_every_live_system_has_an_address_a_repository_and_a_way_it_runs(self):
        rs = L.rows(REPO)
        self.assertGreaterEqual(len(rs), 6)
        for r in rs:
            self.assertTrue(r["origin"].startswith("https://") and r["repo"].startswith("ultrastable/") and r["runs_as"], r)

    def test_a_block_links_the_address_health_and_statements(self):
        b = L.block("unlearn", REPO)
        for part in ("**Running at [https://unlearn.ultrastable.org]", "/health", "/claims.json", "`ultrastable-unlearn`", "https://ultrastable.io/directory"):
            self.assertIn(part, b)
        self.assertTrue(b.startswith(L.START) and b.rstrip().endswith(L.END))

    def test_a_system_with_nothing_deployed_says_so_and_shows_no_dead_link(self):
        b = L.block("base-rates", REPO)
        self.assertIn("Not deployed yet", b)
        self.assertNotIn("/health", b)

    def test_place_inserts_after_the_first_heading_and_replaces_in_place(self):
        b1, b2 = L.block("unlearn", REPO), L.block("what-works", REPO)
        t = L.place("> licence line\n\n# Unlearn\n\nBody.\n", b1)
        self.assertLess(t.index("# Unlearn"), t.index("## Live"))
        self.assertLess(t.index("## Live"), t.index("Body."))
        t2 = L.place(t, b2)
        self.assertEqual(t2.count("<!-- live:start"), 1)
        self.assertTrue(L.has(t2, b2) and not L.has(t2, b1))
        self.assertEqual(L.place(t2, b2), t2, "writing the same block twice changes nothing")

    def test_the_core_readme_keeps_two_blocks_and_rewrites_each(self):
        t = L._multi("# core\n\ntext\n", ["ultrastable", "fleet"], REPO)
        self.assertEqual(t.count("<!-- live:start"), 2)
        self.assertEqual(L._multi(t, ["ultrastable", "fleet"], REPO), t)
        self.assertIn("## Where everything runs", t)

    def test_live_fails_a_readme_without_its_address_and_an_unreadable_one(self):
        def fetch(url, ua, **k):
            if "ultrastable/unlearn/" in url:
                return 200, "text/plain", "# Unlearn\nno link here"
            if "ultrastable/what-works/" in url:
                return 404, "", ""
            repo = url.split("githubusercontent.com/")[1].split("/main/")[0]
            return 200, "text/plain", next(r["origin"] for r in L.rows(REPO) if r["repo"] == repo)
        res = {r["id"]: r for r in L.live(REPO, fetch)}
        self.assertFalse(res["unlearn"]["ok"])
        self.assertIn("does not link", res["unlearn"]["why"])
        self.assertFalse(res["what-works"]["ok"])
        self.assertIn("unmeasured", res["what-works"]["why"])
        self.assertTrue(res["replication-ledger"]["ok"] and res["ultrastable"]["ok"])


if __name__ == "__main__":
    unittest.main()
