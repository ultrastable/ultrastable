# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import json, tempfile, unittest
from pathlib import Path

from foundation import sampleaudit as sa

CFG = {"base": 0.2, "floor": 0.1, "ceiling": 1.0, "step_up": 2.0, "window": 20}


def _root(d: Path, verdicts=()):
    (d / "doctrine").mkdir(); (d / "docs/issues").mkdir(parents=True)
    (d / "doctrine/sample-audit.json").write_text(json.dumps(CFG))
    for i, v in enumerate(verdicts):
        (d / f"docs/issues/Q-AUDIT-{i}.json").write_text(json.dumps({"merged_at": f"2026-11-0{i+1}", "verdict": v}))


class SampleAuditTest(unittest.TestCase):
    def test_rate_rises_with_defects_and_is_capped(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t); _root(d); self.assertEqual(sa.rate(d)[0], 0.2)
        with tempfile.TemporaryDirectory() as t:
            d = Path(t); _root(d, ["defect", "clean"]); self.assertEqual(sa.rate(d)[0], 0.4)
        with tempfile.TemporaryDirectory() as t:
            d = Path(t); _root(d, ["defect"] * 5); self.assertEqual(sa.rate(d)[0], 1.0)

    def test_protected_always_picked_and_draw_is_stable(self):
        prs = [{"n": 1, "title": "t", "merged_at": "x"}, {"n": 2, "title": "t", "merged_at": "x"}]
        files = {1: ["AGENTS.md"], 2: ["foundation/x.py"]}
        got = sa.pick(prs, 0.0, "2026-11-27", files.get)
        self.assertEqual([(p["n"], p["why"]) for p in got], [(1, "protected path")])
        self.assertEqual(len(sa.pick(prs, 1.0, "2026-11-27", files.get)), 2)
        self.assertEqual(sa.draw(2, "2026-11-27"), sa.draw(2, "2026-11-27"))

    def test_probe_needs_verdict(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t); _root(d)
            (d / "docs/issues/Q-AUDIT-9.json").write_text(json.dumps(sa.item({"n": 9, "title": "t", "merged_at": "x", "why": "sampled"})))
            self.assertFalse(sa.probe(9, d))
            f = d / "docs/issues/Q-AUDIT-9.json"; j = json.loads(f.read_text()); j["verdict"] = "clean"; f.write_text(json.dumps(j))
            self.assertTrue(sa.probe(9, d))


class FiledItemsMeetTheSpec(unittest.TestCase):
    def test_an_audit_item_carries_every_part_specgate_requires(self):
        from foundation import specgate
        body = sa.item({"n": 7, "title": "t", "merged_at": "2026-11-01T00:00:00Z", "why": "sampled"})["body"]
        self.assertEqual(specgate.missing(body), [])


if __name__ == "__main__":
    unittest.main()
