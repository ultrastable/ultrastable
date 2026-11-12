"""GENESIS-1: a generated instance has a backlog, roadmap, charter, team and infra list, and porting is backlog."""
import json, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import scaffold, manifest as mf  # noqa: E402


class Genesis(unittest.TestCase):
    def test_new_system_is_born_with_work(self):
        raw = json.loads((ROOT / "instances/ultrastable/instance.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as d:
            rep = scaffold.generate(raw, d, "2026-11-12")
            self.assertEqual(rep["failures"], [])
            o = Path(d)
            ids = {p.stem for p in (o / "docs/issues").glob("*.json")}
            self.assertTrue({"GEN-1", "INF-1", "GOAL-1", "STAFF-portfolio-manager", "PORT-gcp", "PORT-self-hosted", "PLUS-1"} <= ids)
            self.assertNotIn("PORT-cloudflare", ids)
            for f in ("ROADMAP.md", "org/charter.md", "org/team.json", "org/infra.json", "doctrine/team.json"):
                self.assertTrue((o / f).is_file(), f)
            self.assertIn("## Now", (o / "ROADMAP.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
