import json, tempfile, unittest
from pathlib import Path
from ultrastable.orgchart import load_orgchart, OrgChartError

ROOT = Path(__file__).resolve().parents[3]


class OrgChart(unittest.TestCase):
    def test_loads_this_roadmap_as_fixture(self):
        oc = load_orgchart(ROOT / "seed" / "ultrastable.json", ROOT / "docs" / "issues")
        self.assertGreaterEqual(len(oc["items"]), 40)
        self.assertIn("filed", oc["gates"])
        self.assertIn("patent", oc["objectives"])
        self.assertIn("portfolio-manager", {r["id"] for r in oc["roles"]})
        for it in oc["items"].values():
            self.assertTrue(it["owner"] and it["trigger"] and it["done_check"], it["id"])

    def test_errors_are_reported_together(self):
        with tempfile.TemporaryDirectory() as d:
            cfg = Path(d) / "c.json"
            cfg.write_text(json.dumps({"roles": [{"id": "a"}, {"id": "a"}]}))
            items = Path(d) / "items"
            items.mkdir()
            (items / "X-1.json").write_text(json.dumps({"id": "X-1", "title": "t", "body": "no fields", "labels": [], "milestone": "Now"}))
            with self.assertRaises(OrgChartError) as cm:
                load_orgchart(cfg, items)
            msg = str(cm.exception)
            self.assertIn("missing 'connectors'", msg)
            self.assertIn("duplicate id a", msg)
            self.assertIn("X-1.json: body has no 'owner'", msg)


if __name__ == "__main__":
    unittest.main()
