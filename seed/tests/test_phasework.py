# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# PHASED-WORK-1 in the seed: every large change moves through audit, coverage, implement, verify (two independent readers), fix, integrate, final gate.
import json, sys, tempfile, unittest
from pathlib import Path
SEED = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SEED / "scripts"))
import phasework as p


def finish(run, aid, by, **kw):
    if next(a for a in run['agents'] if a['id'] == aid)['status'] == 'pending':
        p.start(run, aid)
    return p.done(run, aid, by, **kw)


class T(unittest.TestCase):
    def test_contract_and_worker_agree(self):
        self.assertEqual(p.check(SEED), [])

    def test_plan_has_every_phase_for_every_slice(self):
        r = p.new_run("g", ["a", "b"], ["gap"])
        ids = {a["id"] for a in r["agents"]}
        for k in "AB":
            self.assertTrue({f"audit:{k}", f"impl:{k}", f"verify-evidence:{k}", f"verify-adversarial:{k}"} <= ids)
        self.assertTrue({"coverage", "author:gap", "verify-evidence:gap", "integrate", "final_gate"} <= ids)

    def test_phases_start_in_order_and_slices_prove_independently(self):
        r = p.new_run("g", ["a", "b"])
        self.assertEqual({a["id"] for a in p.ready(r)}, {"audit:A", "audit:B"})
        for k in "AB":
            finish(r, f"audit:{k}", "x")
        self.assertEqual([a["id"] for a in p.ready(r)], ["coverage"])
        finish(r, "coverage", "x")
        self.assertEqual({a["id"] for a in p.ready(r)}, {"impl:A", "impl:B"})
        finish(r, "impl:A", "w1")
        ready = {a["id"] for a in p.ready(r)}
        self.assertEqual(ready, {"impl:B", "verify-evidence:A", "verify-adversarial:A"}, "slice A is proven while B is still being built")

    def test_a_verifier_cannot_be_the_author_or_the_other_verifier(self):
        r = p.new_run("g", ["a"])
        for aid in ("audit:A", "coverage"):
            finish(r, aid, "x")
        finish(r, "impl:A", "w1")
        with self.assertRaises(ValueError):
            finish(r, "verify-evidence:A", "w1")
        finish(r, "verify-evidence:A", "v1")
        with self.assertRaises(ValueError):
            finish(r, "verify-adversarial:A", "v1")

    def test_findings_send_only_that_slice_back_and_are_bounded(self):
        r = p.new_run("g", ["a", "b"])
        for aid in ("audit:A", "audit:B", "coverage"):
            finish(r, aid, "x")
        for k in "AB":
            finish(r, f"impl:{k}", "w")
        finish(r, "verify-evidence:A", "v1")
        finish(r, "verify-adversarial:A", "v2", ok=False, findings=["A breaks on empty input"])
        self.assertEqual(r["round"], 1)
        pend = {a["id"] for a in r["agents"] if a["status"] == "pending"}
        self.assertIn("fix:A r1", pend)
        self.assertIn("verify-evidence:A", pend)
        self.assertNotIn("impl:B", pend)
        finish(r, "fix:A r1", "w")
        finish(r, "verify-evidence:A", "v1")
        finish(r, "verify-adversarial:A", "v2", ok=False, findings=["still breaks"])
        finish(r, "fix:A r2", "w")
        finish(r, "verify-evidence:A", "v1")
        finish(r, "verify-adversarial:A", "v2", ok=False, findings=["third time"])
        self.assertEqual(r["state"], "failed")
        self.assertIn("fix rounds", r["reason"])

    def test_full_run_reaches_done_and_a_red_final_gate_returns_to_fix(self):
        r = p.new_run("g", ["a"])
        for aid, by in (("audit:A", "x"), ("coverage", "x"), ("impl:A", "w"), ("verify-evidence:A", "v1"), ("verify-adversarial:A", "v2"), ("integrate", "w")):
            finish(r, aid, by)
        finish(r, "final_gate", "ci", ok=False, findings=["suite red"])
        self.assertEqual(r["state"], "running")
        self.assertIn("fix:A r1", {a["id"] for a in r["agents"] if a["status"] == "pending"})
        r2 = p.new_run("g", ["a"])
        for aid, by in (("audit:A", "x"), ("coverage", "x"), ("impl:A", "w"), ("verify-evidence:A", "v1"), ("verify-adversarial:A", "v2"), ("integrate", "w"), ("final_gate", "ci")):
            finish(r2, aid, by)
        self.assertEqual(r2["state"], "done")

    def test_cli_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            f = str(Path(d) / "run.json")
            self.assertEqual(p.main(["new", "--goal", "g", "--slices", "a,b", "--out", f], SEED), 0)
            self.assertEqual(p.main(["done", f, "audit:A", "--by", "x", "--ok"], SEED), 0)
            self.assertEqual(json.loads(Path(f).read_text())["agents"][0]["status"], "done")

    def test_a_run_needs_a_goal_and_a_bounded_number_of_slices(self):
        with self.assertRaises(ValueError):
            p.new_run("", ["a"])
        with self.assertRaises(ValueError):
            p.new_run("g", [str(i) for i in range(30)])


if __name__ == "__main__":
    unittest.main()
