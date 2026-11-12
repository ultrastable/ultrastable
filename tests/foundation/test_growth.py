"""GROWTH-1: experiments file as growth items, the share floor holds, a fixes-only period fails."""
import json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import growth as G  # noqa: E402
import _repo  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


def make(issues):
    d = Path(_repo.scratch()); (d / "doctrine").mkdir(); (d / "docs/issues").mkdir(parents=True)
    (d / G.PATH).write_text((REPO / G.PATH).read_text())
    for i, labels in enumerate(issues):
        (d / "docs/issues" / f"X-{i}.json").write_text(json.dumps({"id": f"X-{i}", "labels": labels}))
    return d


class Growth(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(G.check(REPO), [])

    def test_fixes_only_fails(self):
        self.assertIn("fixes only: repair work filed and no growth work", G.check(make([["repair"], ["clock"]])))

    def test_cycle_files_growth_items_and_share_recovers(self):
        d = make([["repair"], ["repair"]])
        ids = G.cycle(d, apply=True); self.assertIn("Q-GROW-shorter-pilot-form", ids)
        self.assertEqual(G.cycle(d), [])  # idempotent
        self.assertEqual(G.check(d), [])
        self.assertGreaterEqual(G.share(d)["share"], 0.3)

    def test_share_floor(self):
        bad = G.check(make([["repair"]] * 20 + [["growth"]] * 4))  # experiments unfiled too
        self.assertTrue(any("under the floor" in b for b in bad))

    def test_bad_prediction_form_fails(self):
        d = make([]); p = d / G.PATH; c = json.loads(p.read_text()); c["experiments"][0]["prediction"] = "soon"; p.write_text(json.dumps(c))
        self.assertTrue(any("prediction" in b for b in G.check(d)))
