# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""FINDABLE-1: the fleet discoverability reading files and closes its own items."""
import json, unittest
from pathlib import Path
from foundation import findable as F
from _repo import scratch

GOOD = ('<title>Thing here</title><meta name="description" content="A long enough description of the page.">'
        '<link rel="canonical" href="/"><meta property="og:title" content="x"><script type="application/ld+json">{}</script>'
        '<link rel="alternate" type="application/atom+xml" href="/feed.atom">')


def fake(home):
    pages = {"/": home, "/robots.txt": "User-agent: *\nAllow: /\nSitemap: https://a.example/sitemap.xml\n",
             "/sitemap.xml": "<urlset><url><loc>https://a.example/</loc></url></urlset>", "/llms.txt": "# a"}
    def get(u):
        path = "/" + u.split("/", 3)[3] if u.count("/") > 2 else "/"
        return (200, pages[path]) if path in pages else (404, "")
    return get


class Findable(unittest.TestCase):
    def test_good_page_has_no_gaps_and_finds_feed(self):
        r = F.read("https://a.example/", fake(GOOD))
        self.assertEqual(r["gaps"], [])
        self.assertEqual(r["feeds"], ["https://a.example/feed.atom"])

    def test_bare_page_lists_each_gap(self):
        r = F.read("https://a.example/", fake("<title>Thing here</title>"))
        self.assertIn("schema.org JSON-LD", r["gaps"])
        self.assertIn("meta description", r["gaps"])

    def test_robots_blocking_everything(self):
        self.assertIn("robots.txt blocks every crawler", F.robots_gaps("User-agent: *\nDisallow: /\n"))

    def test_apply_files_then_closes(self):
        root = Path(scratch()); (root / "docs" / "issues").mkdir(parents=True)
        if True:
            F.properties = lambda root=None: [{"id": "a", "url": "https://a.example/"}]
            F.run(root, apply=True, get=fake("<title>Thing here</title>"))
            it = json.loads((root / "docs/issues/Q-FIND-a.json").read_text())
            self.assertEqual(it["status"], "open")
            F.run(root, apply=True, get=fake(GOOD))
            self.assertEqual(json.loads((root / "docs/issues/Q-FIND-a.json").read_text())["status"], "done")


if __name__ == "__main__":
    unittest.main()
