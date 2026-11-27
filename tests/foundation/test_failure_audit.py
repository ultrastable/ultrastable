"""FAILURE-AUDIT-1 + FAILURE-RESOLVE-1: every failure mode has a live detector; a failing one files one queue item with its root-cause suspects, repeats escalate, a recovery closes it."""
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

    def test_every_failure_mode_has_a_live_detector(self):
        self.assertEqual([m for m, dets in fa.coverage(ROOT).items() if not dets], [])
        d = sandbox([sys.executable, "-c", "print('ok')"])
        self.assertTrue(any("no live detector" in p for p in fa.check(d)), "a mode nothing watches fails the check")

    def test_failing_detector_files_one_queue_item_the_executor_can_take(self):
        from foundation import queue
        d = sandbox([sys.executable, "-c", "import sys; print('boom'); sys.exit(1)"])
        (d / "docs/issues/AUDIT-t1.json").write_text("{}")  # the name no queue pattern matched
        r1 = fa.run(d)[0]
        self.assertEqual((r1["status"], r1["disposition"], r1["streak"]), ("fail", "filed", 1))
        self.assertFalse((d / "docs/issues/AUDIT-t1.json").exists())
        issue = json.loads((d / "docs/issues/Q-AUDIT-t1.json").read_text())
        self.assertIn("Done check:** cmd:python3 -m foundation failure_audit --probe t1", issue["body"]); self.assertIn("role:operations", issue["labels"])
        it = [i for i in queue.items(d) if i["id"] == "Q-AUDIT-t1"]
        self.assertEqual(len(it), 1, "the item is in the executor's queue")
        self.assertEqual((it[0]["status"], bool(it[0]["owner"]), bool(it[0]["trigger"])), ("open", True, True))
        self.assertTrue(it[0]["probe"][4:].startswith(queue.CMD_ALLOWED), "its done check is a probe the queue may run")
        r2 = fa.run(d)[0]
        self.assertEqual((r2["disposition"], r2["streak"]), ("mutate", 2))
        self.assertIn("change the approach", json.loads((d / "docs/issues/Q-AUDIT-t1.json").read_text())["body"])
        r3 = fa.run(d)[0]
        self.assertEqual(r3["disposition"], "incident")
        j = json.loads((d / "docs/issues/Q-AUDIT-t1.json").read_text())
        self.assertIn("incident", j["labels"]); self.assertIn("Redesign", j["body"])
        before = (d / "docs/issues/Q-AUDIT-t1.json").read_text()
        fa.run(d)
        self.assertEqual((d / "docs/issues/Q-AUDIT-t1.json").read_text(), before, "an unchanged finding does not rewrite its item")
        self.assertEqual(len(list((d / "docs/issues").glob("*AUDIT-t1*.json"))), 1, "never duplicated")
        self.assertEqual(json.loads((d / fa.STATE).read_text())["t1"]["status"], "fail")
        self.assertEqual(fa.probe("t1", d)[0], False)

    def test_recovery_closes_the_item_with_evidence_and_keeps_it(self):
        d = sandbox([sys.executable, "-c", "import sys; sys.exit(1)"])
        fa.run(d)
        det = json.loads((d / fa.DETECTORS).read_text()); det["detectors"][0]["run"] = [sys.executable, "-c", "print('ok')"]
        (d / fa.DETECTORS).write_text(json.dumps(det))
        r = fa.run(d)[0]
        self.assertEqual((r["status"], r["disposition"]), ("pass", "recovered"))
        body = json.loads((d / "docs/issues/Q-AUDIT-t1.json").read_text())["body"]
        self.assertIn("**Status:** closed", body); self.assertIn("**Evidence:** detector passed", body)
        self.assertEqual(fa.run(d)[0]["disposition"], "clean", "a closed item is not closed twice")
        lines = [json.loads(l) for l in (d / fa.LEDGER).read_text().splitlines()]
        self.assertEqual([x["status"] for x in lines], ["fail", "pass", "pass"], "passes are recorded too")
        self.assertEqual(json.loads((d / fa.STATE).read_text())["t1"], {"status": "pass", "signature": "", "streak": 0, "since": ""})
        self.assertTrue(fa.probe("t1", d)[0])
        det["detectors"][0]["run"] = [sys.executable, "-c", "import sys; sys.exit(1)"]
        (d / fa.DETECTORS).write_text(json.dumps(det))
        fa.run(d)
        self.assertIn("**Status:** open", json.loads((d / "docs/issues/Q-AUDIT-t1.json").read_text())["body"], "a relapse reopens the same item")

    def test_root_cause_names_what_changed_since_the_last_pass(self):
        """US-17-R20: the item a failing detector files names the files changed since its last passing commit."""
        import subprocess
        d = sandbox([sys.executable, "-c", "import sys,pathlib; sys.exit(0 if pathlib.Path('flag.py').read_text()=='ok' else print('flag.py is wrong') or 1)"])
        g = lambda *a: subprocess.run(["git", "-C", str(d), "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", *a], check=True, capture_output=True)
        (d / "flag.py").write_text("ok"); (d / "other.py").write_text("1")
        g("init", "-q"); g("add", "flag.py", "other.py", "doctrine"); g("commit", "-q", "-m", "good")
        self.assertEqual(fa.run(d)[0]["status"], "pass")
        (d / "flag.py").write_text("bad"); (d / "docs/issues/Q-x.json").write_text("{}")
        g("add", "flag.py", "docs/issues/Q-x.json"); g("commit", "-q", "-m", "bad")
        r = fa.run(d)[0]
        self.assertEqual(r["suspects"], ["flag.py"], "the regressing file, without loop-written noise")
        body = json.loads((d / "docs/issues/Q-AUDIT-t1.json").read_text())["body"]
        self.assertIn("Changed since the last passing commit", body); self.assertIn("`flag.py`", body); self.assertNotIn("Q-x.json", body)

    def test_probe_detector_and_slow_probe(self):
        d = sandbox([sys.executable, "-c", "print('ok')"])
        det = json.loads((d / fa.DETECTORS).read_text())
        det["detectors"][0].update(kind="probe", spec="grep:marker.txt::KEEP-1"); det["detectors"][0].pop("run")
        (d / fa.DETECTORS).write_text(json.dumps(det))
        self.assertEqual(fa.run(d)[0]["status"], "fail")
        (d / "marker.txt").write_text("KEEP-1")
        self.assertEqual(fa.run(d)[0]["status"], "pass")
        det["detectors"][0].update(kind="command", run=["definitely-not-a-real-tool-xyz"], timeout=900)
        (d / fa.DETECTORS).write_text(json.dumps(det))
        self.assertTrue(fa.probe("t1", d)[0], "a detector slower than the queue's probe time is answered from its last recorded run")
        self.assertFalse(fa.probe("nope", d)[0])

    def test_missing_tool_is_a_finding_not_a_pass(self):
        """US-17-R16, US-17-T09: a detector whose tool is missing is recorded as a finding, not as a pass."""
        d = sandbox(["definitely-not-a-real-tool-xyz"])
        r = fa.run(d)[0]
        self.assertEqual(r["status"], "unavailable"); self.assertTrue((d / "docs/issues/Q-AUDIT-t1.json").exists())


if __name__ == "__main__":
    unittest.main()
