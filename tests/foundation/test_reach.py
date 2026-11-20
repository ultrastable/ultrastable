# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
# REACH-1: events become posts, reach is measured, weights move and revert.
import json, shutil, datetime as dt
import unittest
from pathlib import Path
import _repo  # noqa: E402
from foundation import reach

REPO = Path(__file__).resolve().parents[2]
NOW = dt.datetime(2026, 11, 17, 12, tzinfo=dt.timezone.utc)


class Reach(unittest.TestCase):
    def setUp(self):
        self.tmp = _repo.scratch()
        for p in ["doctrine/reach.json", "social", "ops/changelog.json", "ops/insight"]:
            s, d = REPO / p, self.tmp / p
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(s, d) if s.is_dir() else shutil.copy(s, d)
        (self.tmp / "site").mkdir(exist_ok=True)

    def test_repo_check(self):
        self.assertEqual(reach.check(REPO), [])

    def test_guard_blocks_invented_numbers_and_blocked_words(self):
        self.assertTrue(reach.guard("Shipped 99 things", "Shipped things", self.tmp))
        self.assertTrue(reach.guard("About QNFO", "About QNFO", self.tmp))
        self.assertEqual(reach.guard("Shipped 3 things", "Shipped 3 things", self.tmp), [])

    def test_refill_is_idempotent_and_capped(self):
        a = reach.refill(self.tmp, NOW, apply=True)
        self.assertLessEqual(len(a), 4)
        self.assertTrue(all(p["kind"] == "event" for p in a))
        b = reach.refill(self.tmp, NOW, apply=True)
        self.assertFalse({x["id"] for x in a} & {x["id"] for x in b})

    def test_metrics_exclude_owned_domains_and_bots(self):
        cfg = reach.load(self.tmp)
        rows = [{"ref": "bsky.app", "path": "/live", "name": "pageview"}, {"ref": "ultrastable.app", "path": "/", "name": "pageview"},
                {"ref": "google.com", "path": "/proof", "name": "pageview"}, {"ref": "bing.com", "path": "/", "name": "pageview", "bot": 1},
                {"ref": "", "path": "/feed.xml", "name": "x", "bot": 1}, {"ref": "news.ycombinator.com", "path": "/showcase/practical-solutions", "name": "pageview"}]
        m = reach.measure_rows(rows, cfg)
        self.assertEqual((m["external_referrals_7d"], m["social_referrals_7d"], m["search_referrals_7d"], m["feed_hits_7d"], m["ps_page_views_7d"]), (3, 2, 1, 1, 1))

    def test_unmeasured_is_never_zero(self):
        self.assertEqual(reach.run(self.tmp, env={"REACH_OFFLINE": "1"}, now=NOW)["metrics"], "unmeasured")

    def test_breach_files_item_and_weights_revert(self):
        rows = [{"ref": "bsky.app", "path": "/live", "name": "pageview"}] * 5
        rep = reach.run(self.tmp, apply=True, env={"REACH_OFFLINE": "1"}, now=NOW, rows=rows)
        self.assertIn("external_referrals_7d", rep["breaches"])
        self.assertTrue((self.tmp / "docs/issues/Q-REACH-external_referrals_7d.json").is_file())
        # a recorded weight change that was followed by a reach collapse is undone
        _repo_w = {"weights": {"shipped": 3.0}, "history": [{"changed": True, "weights_before": {"shipped": 1.0}, "total_before": 100}]}
        reach._wj(self.tmp, "weights.json", _repo_w)
        cfg = reach.load(self.tmp)
        w = reach.learn(self.tmp, cfg, {"external_referrals_7d": 10, "by_path": {}}, NOW.isoformat())
        self.assertEqual(w["weights"]["shipped"], 1.0)

    def test_grouped_rows_and_site_route(self):
        """ATTENTION-1: /api/reach rows carry counts; an unreadable site route stays unmeasured, never zero."""
        cfg = reach.load(self.tmp)
        m = reach.measure_rows([{"ref": "bsky.app", "path": "/progress", "name": "pageview", "bot": 0, "n": 7},
                                {"ref": "", "path": "/progress.atom", "name": "x", "bot": 1, "n": 4}], cfg)
        self.assertEqual((m["external_referrals_7d"], m["social_referrals_7d"], m["feed_hits_7d"]), (7, 7, 4))
        self.assertEqual(len(reach.site_rows(cfg, fetch=lambda u: {"rows": [{"ref": "", "path": "/", "name": "pageview", "n": 1}]})), 1)
        with self.assertRaises(ValueError):
            reach.site_rows(cfg, fetch=lambda u: {"rows": None})

    def test_evidence_post_counts_only_what_the_record_shows(self):
        """ATTENTION-1: the weekly evidence post is built from ops/deploys.jsonl; self-origin is claimed only for rows marked so."""
        (self.tmp / "ops").mkdir(exist_ok=True)
        rows = [{"at": "2026-11-16T10:00:00Z", "worker": "a", "sha": "s1", "live_matches_commit": True},
                {"at": "2026-11-16T10:00:00Z", "worker": "b", "sha": "s1", "live_matches_commit": True, "origin": "executor"},
                {"at": "2026-11-16T11:00:00Z", "worker": "a", "sha": "s2", "live_matches_commit": False},
                {"at": "2026-10-01T10:00:00Z", "worker": "a", "sha": "old", "live_matches_commit": True}]
        (self.tmp / "ops/deploys.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
        c = reach.evidence_candidates(self.tmp, NOW)
        self.assertEqual(len(c), 1)
        self.assertIn("1 new versions live (2 deploys across 2 services)", c[0]["text"])
        self.assertIn("1 of them it started itself", c[0]["text"])
        self.assertEqual(reach.guard(c[0]["text"], c[0]["event"], self.tmp), [])
        self.assertTrue(reach.guard("Hey @someone, look", "Hey @someone, look", self.tmp))

    def test_exploration_prefers_untried_arms(self):
        c = [{"arm": "a"}, {"arm": "b"}]
        self.assertEqual(reach.pick(c, {}, {"a": 5})[0]["arm"], "b")


if __name__ == "__main__":
    unittest.main()


class ConnectLink(unittest.TestCase):
    """CONNECT-LINK-1: an owner card without a connect link, or a new provider deep link, fails the check."""
    def test_cards(self):
        from foundation import pointclick
        pol = json.loads((REPO / "doctrine/point-and-click.json").read_text())
        tmp = _repo.scratch(); (tmp / "foundation/data").mkdir(parents=True)
        def run(items):
            (tmp / "foundation/data/needs-you.json").write_text(json.dumps({"items": items}))
            return pointclick.connect_links(tmp, pol)
        self.assertEqual(run([{"id": "x", "connect": "https://ultrastable.io/connect/bluesky", "connect_kind": "connect-flow"}]), [])
        self.assertTrue(run([{"id": "x"}]))
        self.assertTrue(run([{"id": "new", "connect": "https://example.com", "connect_kind": "provider-deep-link"}]))
        self.assertEqual(run([{"id": "funding", "connect": "https://example.com", "connect_kind": "provider-deep-link"}]), [])
        self.assertEqual(pointclick.connect_links(REPO, pol), [])
