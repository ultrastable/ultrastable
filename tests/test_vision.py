"""VISION-1: the vision (docs/doctrine/VISION.md) is present, imported by every agent entry point, enforced by the bootstrapper."""
import sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "seed" / "bootstrap"))
import bootstrap as bs  # noqa: E402


def boot(idea_text: str):
    d = Path(tempfile.mkdtemp()); seed = ROOT / "seed"
    (d / "ultrastable.json").write_bytes((seed / "ultrastable.json").read_bytes())
    (d / "autonomy").mkdir(); (d / "autonomy" / "policy.json").write_bytes((seed / "autonomy" / "policy.json").read_bytes())
    (d / "IDEA.md").write_text(idea_text, encoding="utf-8")
    b = bs.Boot(d, d / "org", apply=False)
    b.guard("read", b.read); b.guard("qualify", b.qualify)
    return b


class VisionTests(unittest.TestCase):
    def test_files_and_imports(self):
        v = (ROOT / "docs/doctrine/VISION.md").read_text(encoding="utf-8")
        self.assertEqual(v, (ROOT / "seed/doctrine/VISION.md").read_text(encoding="utf-8"), "seed copy must match")
        for must in ("system test", "not for", "proportion rule"):
            self.assertIn(must, v.lower())
        self.assertIn("VISION.md", (ROOT / "CLAUDE.md").read_text(encoding="utf-8"))
        self.assertIn("VISION.md", (ROOT / "seed/CLAUDE.md").read_text(encoding="utf-8"))
        self.assertIn("## 0. Qualify", (ROOT / "docs/BOOTSTRAP-PROMPT.md").read_text(encoding="utf-8"))
        self.assertIn("# System test", (ROOT / "seed/IDEA.md").read_text(encoding="utf-8"))

    def test_seed_idea_is_a_system(self):
        b = boot((ROOT / "seed/IDEA.md").read_text(encoding="utf-8"))
        self.assertTrue(b.fit, b.log)

    def test_camping_app_is_not_staffed(self):
        b = boot("---\norg_name: Trip\n---\n# Idea\nA packing list for camping trips.\n# First outcomes\n- A packing list page\n# Constraints\n- Budget per month: 10 USD\n")
        self.assertFalse(b.fit)
        self.assertTrue(any(c["id"] == "GATE-FIT" for c in b.state["gate_cards"]))
        self.assertFalse(hasattr(b, "roles"), "nothing may be staffed for a non-system")


class InstrumentTests(unittest.TestCase):
    def test_every_system_gets_liveness_probes_and_declared_measure_is_a_breach(self):
        b = boot((ROOT / "seed/IDEA.md").read_text(encoding="utf-8"))
        b.guard("instrument", b.instrument)
        kinds = {m["id"]: m for m in b.metrics}
        for mid in ("M-tick-heartbeat", "M-acting", "M-closing", "M-verified", "M-no-drops", "M-instrumented"):
            self.assertEqual(kinds[mid]["kind"], "liveness", mid)
        decl = [m for m in b.metrics if m["source"] == "declared"]
        self.assertEqual(len(decl), len(b.objectives))
        sql = b.seed_sql() if hasattr(b, "roles") else ""
        self.assertTrue(b.objectives)


class LayerTests(unittest.TestCase):
    def test_child_records_parent_and_level_and_must_report_up(self):
        idea = (ROOT / "seed/IDEA.md").read_text(encoding="utf-8").replace("slug: example-co", "slug: example-co" + chr(10) + "parent: ultrastable")
        b = boot(idea)
        b.guard("instrument", b.instrument)
        self.assertEqual((b.parent, b.level), ("ultrastable", 1))
        link = [m for m in b.metrics if m["id"] == "M-parent-link"]
        self.assertEqual(len(link), 1); self.assertEqual(link[0]["source"], "declared", "a silent child breaches until a probe exists")

    def test_level_zero_has_no_parent_link(self):
        b = boot((ROOT / "seed/IDEA.md").read_text(encoding="utf-8")); b.guard("instrument", b.instrument)
        self.assertEqual((b.parent, b.level), ("", 0)); self.assertFalse([m for m in b.metrics if m["id"] == "M-parent-link"])


if __name__ == "__main__":
    unittest.main()
