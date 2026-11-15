"""QNFO-PORT-1: the inventory cannot claim a port without module, test and wiring; the pass writes ignition gaps that criticality reads."""
import copy, json, shutil, subprocess, sys, unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import sauce as S, criticality  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402

T0 = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)


class Sauce(unittest.TestCase):
    def test_repo_inventory_and_instance_declaration(self):
        self.assertEqual(S.check(ROOT), [])
        inv = S.inventory(ROOT)["mechanisms"]
        ported = {m["id"] for m in inv if m["status"] == "ported"}
        self.assertTrue({"closing-probe-contracts", "metric-closed-loop", "family-throughput", "meta-ticket-fold"} <= ported)
        declared = {l["foundation_loop"] for l in json.loads((ROOT / "instances/qnfo/foundation-loops.json").read_text())["loops"]}
        self.assertTrue(ported <= declared, "QNFO declares which of its loops satisfies every ported mechanism")
        self.assertEqual(sorted(m["priority"] for m in inv), list(range(1, len(inv) + 1)), "priorities are a strict order")

    def test_a_port_without_module_test_or_wiring_fails(self):
        d = scratch(); (d / "doctrine").mkdir(); (d / "instances").mkdir()
        inv = copy.deepcopy(S.inventory(ROOT))
        m = next(x for x in inv["mechanisms"] if x["id"] == "family-throughput")
        m["test"], m["wired_into"] = ["tests/foundation/test_nothing.py"], []
        (d / S.INVENTORY).write_text(json.dumps(inv))
        errs = S.check(d)
        self.assertTrue(any("module foundation/throughput.py does not exist" in e for e in errs))
        self.assertTrue(any("family-throughput: marked ported but wired into nothing" in e for e in errs))
        self.assertTrue(any("test tests/foundation/test_nothing.py does not exist" in e for e in errs))

    def test_unknown_instance_loop_fails(self):
        d = scratch(); (d / "doctrine").mkdir(); (d / "instances/x").mkdir(parents=True)
        (d / S.INVENTORY).write_text(json.dumps({"mechanisms": []}))
        (d / "instances/x/foundation-loops.json").write_text(json.dumps({"loops": [{"foundation_loop": "made-up", "impl": ["a"]}]}))
        self.assertTrue(any("unknown foundation loop made-up" in e for e in S.check(d)))

    def test_parity_against_a_checkout(self):
        d = scratch()
        decl = json.loads((ROOT / "instances/qnfo/foundation-loops.json").read_text())
        for l in decl["loops"]:
            for f in l["impl"]:
                (d / f).parent.mkdir(parents=True, exist_ok=True); (d / f).write_text("x")
        self.assertEqual(S.parity("qnfo", str(d), ROOT), [])
        (d / decl["loops"][0]["impl"][0]).unlink()
        self.assertEqual(len(S.parity("qnfo", str(d), ROOT)), 1)

    def test_pass_writes_ignition_gaps_read_by_criticality(self):
        d = scratch()
        for rel in ("doctrine", "ops", "docs/issues"):
            (d / rel).mkdir(parents=True)
        for f in ("qnfo-port.json", "criticality.json", "cost.json"):
            shutil.copy(ROOT / "doctrine" / f, d / "doctrine" / f)
        shutil.copy(ROOT / "ops/cost-thresholds.json", d / "ops/cost-thresholds.json")
        reg = {"efficacy_days": 7, "min_move_share": 0.1, "metrics": [{"id": "k", "kind": "target", "reader": "criticality_k", "op": ">=", "threshold": 99, "owner": "operations", "levers": [{"id": "x", "action": "y"}]}]}
        (d / "doctrine/metric-loop.json").write_text(json.dumps(reg))
        body = "**Owner:** operations\n**Trigger:** t\n**Done check:** probe:not-runnable\n**Status:** open\n"
        (d / "docs/issues/Q-ZED-1.json").write_text(json.dumps({"id": "Q-ZED-1", "title": "z", "body": body, "labels": []}))
        r = S.tick(d, apply=True, now=T0, criticality_tick=False)
        self.assertEqual(r["errors"], [])
        self.assertIn("Q-METRIC-K.json", r["filed"])
        ign = json.loads((d / S.IGNITION).read_text())
        self.assertTrue(any("Q-ZED-1 has no machine-executable closing probe" in g["link"] for g in ign["gaps"]))
        c = criticality.compute(d, now=T0, feed_ok=True)
        self.assertEqual(c["open_ignition_gaps"], ign["open_ignition_gaps"])
        self.assertFalse(c["self_sustaining"], "self-sustaining needs k at its floor and zero ignition gaps")


    @unittest.skipUnless(shutil.which("node"), "node is not on this host")
    def test_collector_contract(self):
        r = subprocess.run(["node", "--test", "deploy/criticality-collect.test.mjs"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout[-800:] + r.stderr[-400:])

    def test_collect_without_credentials_says_why(self):
        from unittest import mock
        with mock.patch.dict("os.environ", {"CRITICALITY_URL": "", "CRITICALITY_TOKEN": ""}):
            r = S.collect(ROOT)
        self.assertEqual((r["sent"], r["why"]), (False, "CRITICALITY_URL or CRITICALITY_TOKEN not set on this host"))


if __name__ == "__main__":
    unittest.main()
