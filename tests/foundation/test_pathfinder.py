# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""PATHFINDER-1: an owner ask needs an exhaustion proof; routes are tried and recorded; a regressed integration lists its suspect commits."""
import json, shutil, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import pathfinder as P  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402


def repo(cfg_extra=None, gates=None, items=None):
    d = scratch()
    for f in ("doctrine", "foundation/data", "ops/paths"):
        (d / f).mkdir(parents=True, exist_ok=True)
    cfg = json.loads((ROOT / P.CFG).read_text(encoding="utf-8"))
    cfg["grandfathered_gates"] = []
    cfg.update(cfg_extra or {})
    (d / P.CFG).write_text(json.dumps(cfg), encoding="utf-8")
    (d / "doctrine/open-loops.json").write_text(json.dumps({"gates": gates or []}), encoding="utf-8")
    (d / "foundation/data/needs-you.json").write_text(json.dumps({"items": items or []}), encoding="utf-8")
    return d, cfg


class Pathfinder(unittest.TestCase):
    def test_repo_clean(self):
        self.assertEqual(P.check(), [])

    def test_ask_without_proof_fails_then_passes(self):
        d, cfg = repo(items=[{"id": "x"}])
        self.assertTrue(any("without exhaustion proof" in b for b in P.check(d)))
        for c in cfg["surface_classes"]:
            P.record(d, "x", c, "r", False, "tried")
        self.assertEqual(P.check(d), [])

    def test_class_tagged_gate_surfaces_count(self):
        d, cfg = repo()
        s = [{"class": c, "s": "s", "result": "r"} for c in cfg["surface_classes"]]
        (d / "doctrine/open-loops.json").write_text(json.dumps({"gates": [{"id": "g", "surfaces": s}]}), encoding="utf-8")
        self.assertEqual(P.check(d), [])

    def test_resolve_stops_at_first_working_route_and_records_all(self):
        d, cfg = repo({"asks": {"post": {"existing-credentials": ["env:A|B"], "prior-working-config": ["git:foo"], "sibling-workers": ["file:nope"]}}})
        r = P.resolve("post", d, env={"B": "x"}, git=lambda root, p: [])
        self.assertTrue(r["resolved"])
        self.assertEqual(r["via"]["route"], "env:A|B")
        self.assertEqual(len(P.attempts(d)), 3)
        self.assertIn("alternate-channel", r["classes_missing"])

    def test_unchanged_outcome_is_not_rerecorded_and_compact_keeps_flips(self):
        d, _ = repo({"asks": {"post": {"existing-credentials": ["env:A"]}}})
        for env in ({}, {}, {"A": "1"}, {"A": "1"}, {}):
            P.resolve("post", d, env=env)
        self.assertEqual([r["ok"] for r in P.attempts(d)], [False, True, False])
        self.assertEqual(P.compact(d), (3, 3))

    def test_regress_lists_suspects_for_failing_probe(self):
        d, _ = repo({"integrations": [{"id": "bsky", "files": ["w/bsky.js"], "probe": "env:BSKY_SESSION", "last_good": "abc"}]})
        out = P.regress(d, run={}, git=lambda root, f, since=None: ["1a2b3c client type change"])
        self.assertEqual(out[0]["suspects"], ["1a2b3c client type change"])
        self.assertEqual(P.attempts(d)[0]["class"], "prior-working-config")
        self.assertEqual(P.regress(d, run={"BSKY_SESSION": "1"}), [])


if __name__ == "__main__":
    unittest.main()
