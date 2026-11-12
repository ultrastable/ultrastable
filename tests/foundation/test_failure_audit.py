"""FAILURE-AUDIT-1: live detectors file one issue per failing failure mode, escalate repeats, and record recoveries."""
import json, shutil, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import failure_audit as fa  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402  (removed when the test ends)


def sandbox(cmd):
    d = scratch()
    (d / "doctrine").mkdir(); (d / ".github/workflows").mkdir(parents=True); (d / "docs/issues").mkdir(parents=True)
    shutil.copy(ROOT / "doctrine/registers.json", d / "doctrine/registers.json")
    (d / ".github/workflows/failure-audit.yml").write_text("name: x\n")
    det = {"workflow": "failure-audit.yml", "detectors": [{
        "id": "t1", "failure_mode": "fm-tests-red", "kind": "command", "run": cmd, "timeout": 30,
        "root_cause": "rc", "owner": "operations", "remedy": "fix it"}]}
    (d / fa.DETECTORS).write_text(json.dumps(det))
    return d


class FailureAudit(unittest.TestCase):
    def test_repo_registry_is_valid(self):
        self.assertEqual(fa.check(ROOT), [])

    def test_failing_detector_files_one_issue(self):
        d = sandbox([sys.executable, "-c", "import sys; print('boom'); sys.exit(1)"])
        r1 = fa.run(d)[0]
        self.assertEqual((r1["status"], r1["disposition"], r1["streak"]), ("fail", "filed", 1))
        issue = json.loads((d / "docs/issues/AUDIT-t1.json").read_text())
        self.assertIn("Done check:** detector:t1", issue["body"]); self.assertIn("role:operations", issue["labels"])
        r2 = fa.run(d)[0]
        self.assertEqual((r2["disposition"], r2["streak"]), ("mutate", 2))
        self.assertIn("change the approach", json.loads((d / "docs/issues/AUDIT-t1.json").read_text())["body"])
        r3 = fa.run(d)[0]
        self.assertEqual(r3["disposition"], "incident")
        self.assertTrue((d / "docs/issues/AUDIT-t1-incident.json").exists())
        self.assertEqual(len(list((d / "docs/issues").glob("AUDIT-t1*.json"))), 2, "never duplicated")

    def test_recovery_is_recorded_and_clears_the_issue(self):
        d = sandbox([sys.executable, "-c", "import sys; sys.exit(1)"])
        fa.run(d)
        det = json.loads((d / fa.DETECTORS).read_text()); det["detectors"][0]["run"] = [sys.executable, "-c", "print('ok')"]
        (d / fa.DETECTORS).write_text(json.dumps(det))
        r = fa.run(d)[0]
        self.assertEqual((r["status"], r["disposition"]), ("pass", "recovered"))
        self.assertFalse((d / "docs/issues/AUDIT-t1.json").exists())
        lines = [json.loads(l) for l in (d / fa.LEDGER).read_text().splitlines()]
        self.assertEqual([x["status"] for x in lines], ["fail", "pass"], "passes are recorded too")

    def test_missing_tool_is_a_finding_not_a_pass(self):
        d = sandbox(["definitely-not-a-real-tool-xyz"])
        r = fa.run(d)[0]
        self.assertEqual(r["status"], "unavailable"); self.assertTrue((d / "docs/issues/AUDIT-t1.json").exists())


if __name__ == "__main__":
    unittest.main()
