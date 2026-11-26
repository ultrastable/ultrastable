"""MARKET-1: claims need code, gaps need queue items, competitor facts need sources, and none of it reaches the public site."""
import copy, json, shutil, tempfile, unittest
from pathlib import Path
from foundation import market, queue
import sys as _sys; _sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402  (scratch directories are removed when the run ends)

REPO = Path(__file__).resolve().parents[2]


def _copy():
    t = Path(scratch())
    for rel in ("doctrine", "docs/issues", "site", "foundation", "instances"):
        shutil.copytree(REPO / rel, t / rel, ignore=shutil.ignore_patterns("__pycache__"))
    for rel in ("scripts", "seed", "platform", "tests", "ops"):  # read-only evidence for proofs and test-file checks
        if (REPO / rel).exists():
            try:
                (t / rel).symlink_to(REPO / rel, target_is_directory=True)
            except OSError:  # Windows without symlink privilege: a copy is equivalent for read-only evidence
                shutil.copytree(REPO / rel, t / rel, ignore=shutil.ignore_patterns("__pycache__", "node_modules", ".git", ".wrangler"))
    return t


class Market(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(market.check(REPO), [])

    def test_every_gap_has_an_open_queue_item_with_its_probe(self):
        d = market.load(REPO); have = {i["id"]: i for i in queue.items(REPO)}
        for g in d["gaps"]:
            it = have[market.GAP_ID(g)]
            self.assertTrue(market.same_probe(it["probe"], g["closing_probe"]), it["probe"]); self.assertIn(it["status"], ("open", "closed"))

    def test_every_competitor_claim_has_a_source_and_a_date(self):
        d = market.load(REPO); self.assertRegex(d["checked"], r"^\d{4}-\d{2}-\d{2}$")
        for c in d["components"]:
            for a in c["alternatives"]:
                self.assertIn(a["source"], d["sources"]); self.assertTrue(d["sources"][a["source"]]["url"].startswith("https://"))

    def test_claim_without_code_fails(self):
        t = _copy(); d = market.load(t)
        for f in d["features"]:
            if f["id"] == "boundary": f["proof"] = "grep:foundation/boundary.py::def nonexistent_function"
        (t / market.PATH).write_text(json.dumps(d)); self.assertTrue(any("claim without code" in b for b in market.check(t)))

    def test_gap_without_queue_item_fails(self):
        t = _copy(); (t / "docs/issues/Q-GAP-second-installation.json").unlink()
        self.assertTrue(any("second-installation" in b for b in market.check(t)))
        self.assertEqual(market.sync(t), ["Q-GAP-second-installation"]); self.assertEqual(market.check(t), [])
        from foundation import specgate
        body = json.loads((t / "docs/issues/Q-GAP-second-installation.json").read_text())["body"]
        self.assertEqual(specgate.missing(body), [])  # SPEC-GATE-1: a synced gap item passes the gate
        self.assertIn(f"market_open_gaps <= {market.open_gaps(t) - 1} within 720 h", body)

    def test_a_gap_that_closes_needs_no_manual_edit(self):
        t = _copy(); (t / "foundation/adopt.py").write_text("# adopt\n")
        self.assertEqual(market.gap_state(t, market.load(t))["adopt-existing-repo"], "closed"); self.assertEqual(market.check(t), [])

    def test_competitor_name_on_the_public_site_fails(self):
        t = _copy(); p = t / "site/worker.js"; p.write_text(p.read_text() + "\n// Lovable\n")
        self.assertTrue(any("Lovable" in b for b in market.check(t)))

    def test_objection_citing_unbuilt_feature_must_concede(self):
        t = _copy(); d = market.load(t)
        for o in d["objections"]:
            if o["id"] == "just-a-code-agent": o["concede"] = "Coding agents are strong."
        for f in d["features"]:  # the cited feature is built today; the rule is tested on the same objection citing it while unbuilt
            if f["id"] == "executor-pr": f["status"] = "pinned"
        (t / market.PATH).write_text(json.dumps(d)); self.assertTrue(any("without conceding" in b for b in market.check(t)))


if __name__ == "__main__":
    unittest.main()
