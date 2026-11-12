"""GROWTH-1 experiments: proposed experiments file as growth items (idempotent), references and prediction form are validated."""
import json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import experiments as G  # noqa: E402
import _repo  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


def make():
    d = Path(_repo.scratch()); (d / "doctrine").mkdir(); (d / "docs/issues").mkdir(parents=True)
    (d / G.PATH).write_text((REPO / G.PATH).read_text())
    return d


class Experiments(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(G.check(REPO), [])

    def test_cycle_files_growth_items_idempotently(self):
        d = make(); self.assertEqual(len(G.check(d)), 1)
        ids = G.cycle(d, apply=True); self.assertIn("Q-GROW-shorter-pilot-form", ids)
        self.assertEqual(G.cycle(d), []); self.assertEqual(G.check(d), [])
        self.assertIn("growth", json.loads((d / "docs/issues/Q-GROW-shorter-pilot-form.json").read_text())["labels"])

    def test_bad_reference_and_prediction_fail(self):
        d = make(); G.cycle(d, apply=True); p = d / G.PATH; c = json.loads(p.read_text())
        c["experiments"][0]["prediction"] = "soon"; c["experiments"][1]["knob"] = "nope"; p.write_text(json.dumps(c))
        bad = G.check(d); self.assertTrue(any("prediction" in b for b in bad)); self.assertTrue(any("unknown knob" in b for b in bad))
