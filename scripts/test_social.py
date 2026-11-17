import json, unittest, datetime as dt
from social_lib import *
import social_post

class T(unittest.TestCase):
    def test_calendar_all_clean(self):
        for p in load("calendar.json")["posts"]:
            if p.get("kind") == "event": continue  # REACH-1 event posts are checked by foundation.reach.guard (tests/foundation/test_reach.py)
            self.assertEqual(guard(p["text"], p["source"]), [], p["text"])
    def test_blocks_invented_text(self):
        self.assertTrue(guard("Ultrastable now has 500 customers.", "external/one-pager.md"))
    def test_blocks_qnfo_and_patent(self):
        for t in ["Ultrastable runs the system, tested at QNFO.", "Ultrastable is patent pending."]:
            self.assertTrue(guard(t, "external/one-pager.md"))
    def test_blocks_unlisted_source(self):
        self.assertTrue(guard("Ultrastable is an autonomous business system.", "docs/overview.md"))
    def test_sources_exist_and_safe(self):
        for s in load("guard.json")["sources"]:
            self.assertTrue((ROOT / s).exists(), s)
            self.assertFalse(s.startswith(("ip/", "docs/")))
    def test_dry_run_posts_nothing(self):
        self.assertEqual(social_post.main(dt.datetime(2030, 1, 1, tzinfo=dt.timezone.utc)), 0)
        self.assertFalse((S / "state.json").exists())
    def test_kill_switch(self):
        g = load("gate.json"); self.assertIn("kill", g)
        orig = social_post.load
        social_post.load = lambda n: {**orig(n), "kill": True} if n == "gate.json" else orig(n)
        try:
            self.assertEqual(social_post.main(), 0)
        finally:
            social_post.load = orig

if __name__ == "__main__":
    unittest.main()
