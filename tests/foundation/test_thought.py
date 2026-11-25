# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""THOUGHT-1: every white paper becomes posts for every channel that state a common belief, the system's measured record and the hook
(Ultrastable runs on Ultrastable; Practical Solutions is one system it runs). The guard refuses a post without the hook or the paper link, with a
number the paper does not contain, with ridicule or @-mentions, or over a channel's limit. Scheduling respects the cadence, posts a changed result
first, and reposts an unchanged paper only after repost_days."""
import datetime as dt, json, shutil, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import thought as T  # noqa: E402


class Thought(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ultrastable-test-thought-")); self.addCleanup(shutil.rmtree, self.tmp, True)
        for rel in ("doctrine/thought.json", "site/research-data.js"):
            (self.tmp / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(ROOT / rel, self.tmp / rel)
        shutil.copytree(ROOT / "research/studies", self.tmp / "research/studies")
        (self.tmp / "social").mkdir()
        (self.tmp / "social/calendar.json").write_text(json.dumps({"posts": []}))
        self.cfg, self.data, self.st = T.load(self.tmp), T.research_data(self.tmp), T.studies(self.tmp)

    def test_repository_is_valid(self):
        self.assertEqual(T.validate(ROOT), [])

    def test_every_piece_carries_hook_link_and_spotlight(self):
        for p in self.data["papers"]:
            ps = T.pieces(p, self.st[p["study_id"]], self.cfg)
            self.assertEqual(set(ps), {"bluesky", "mastodon", "linkedin"})
            for ch, t in ps.items():
                self.assertIn("Ultrastable runs on Ultrastable", t, ch)
                self.assertIn(f"https://ultrastable.io/research/{p['slug']}", t, ch)
                self.assertEqual(T.guard(t, ch, p, self.cfg, self.st[p["study_id"]]), [], (p["slug"], ch))
            for ch in ("mastodon", "linkedin"):
                self.assertIn("Practical Solutions", ps[ch], "the spotlight is shared")
            self.assertIn(f"{p['met']} of {p['total']}", ps["linkedin"])

    def test_guard_refuses_invented_numbers_ridicule_and_missing_hook(self):
        p = self.data["papers"][0]
        st = self.st[p["study_id"]]
        good = T.pieces(p, st, self.cfg)["mastodon"]
        self.assertTrue(any("number 9999" in e for e in T.guard(good.replace("Common belief", "9999 people think"), "mastodon", p, self.cfg, st)))
        self.assertTrue(any("blocked" in e for e in T.guard(good + " what a stupid idea", "mastodon", p, self.cfg, st)))
        self.assertTrue(any("hook" in e for e in T.guard(good.replace("Ultrastable runs on Ultrastable", "Ultrastable"), "mastodon", p, self.cfg, st)))
        self.assertTrue(any("link" in e for e in T.guard(good.replace("https://ultrastable.io/research/", "https://example.org/"), "mastodon", p, self.cfg, st)))
        self.assertTrue(any("too long" in e for e in T.guard(good + "x" * 600, "mastodon", p, self.cfg, st)))

    def test_schedule_cadence_changed_result_first_then_repost(self):
        now = dt.datetime(2026, 11, 21, 12, tzinfo=dt.timezone.utc)
        first = T.run(self.tmp, apply=True, now=now)
        order1 = sorted(self.data["papers"], key=lambda p: p.get("order", 9))[0]["slug"]
        self.assertTrue(first["scheduled"].startswith(f"paper:{order1}:"))
        self.assertIsNone(T.run(self.tmp, apply=True, now=now)["scheduled"], "cadence holds")
        cal = json.loads((self.tmp / "social/calendar.json").read_text())
        post = cal["posts"][0]
        self.assertEqual(post["kind"], "paper")
        self.assertEqual(post["channels"], ["bluesky", "mastodon", "linkedin"])
        self.assertEqual(post["text"], post["texts"]["bluesky"])
        seen = {post["paper"]}
        day = now
        for _ in range(len(self.data["papers"]) - 1):
            day += dt.timedelta(days=self.cfg["cadence_days"])
            seen.add(T.run(self.tmp, apply=True, now=day)["scheduled"].split(":")[1])
        self.assertEqual(seen, {p["slug"] for p in self.data["papers"]}, "every paper gets a piece before any repost")
        self.assertIsNone(T.run(self.tmp, apply=True, now=day + dt.timedelta(days=self.cfg["cadence_days"]))["scheduled"], "no repost before repost_days")
        later = T.run(self.tmp, apply=True, now=now + dt.timedelta(days=self.cfg["repost_days"] + 1))
        self.assertTrue(later["scheduled"].startswith(f"paper:{order1}:"), later)
        self.assertEqual(len((self.tmp / "ops/thought/log.jsonl").read_text().splitlines()), len(self.data["papers"]) + 1)


if __name__ == "__main__":
    unittest.main()
