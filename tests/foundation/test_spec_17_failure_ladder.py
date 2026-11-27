# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-17 requirements whose reference implementation is the foundation, not workers/core: US-17-R17 (closure needs the probe seen
failing and consecutive passes), US-17-R22 (a finding names root-cause suspects, closes with evidence, a recurring signature escalates) and
US-17-R23 (unregistered failure modes are discovered from the ledgers). The wider behaviour is covered by test_contracts.py,
test_failure_audit.py and test_failmine.py; each test here proves its requirement end to end on a scratch repository."""
import json, shutil, subprocess, sys, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(Path(__file__).resolve().parent))
from foundation import contracts as C, failmine, failure_audit as fa, queue  # noqa: E402
from _repo import scratch  # noqa: E402

T0 = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)


def issue(d, iid, probe="file:marker.txt"):
    body = f"**Owner:** operations\n**Trigger:** t\n**Done check:** {probe}\n**Status:** open\n\nx"
    (d / "docs/issues" / f"{iid}.json").write_text(json.dumps({"id": iid, "title": iid, "body": body, "labels": []}), encoding="utf-8")


def contracts_repo():
    d = scratch()
    (d / "docs/issues").mkdir(parents=True); (d / "doctrine").mkdir(); (d / "ops").mkdir()
    shutil.copy(ROOT / "doctrine/qnfo-port.json", d / "doctrine/qnfo-port.json")
    return d


def audit_repo(cmd):
    d = scratch()
    (d / "doctrine").mkdir(); (d / ".github/workflows").mkdir(parents=True); (d / "docs/issues").mkdir(parents=True)
    shutil.copy(ROOT / "doctrine/registers.json", d / "doctrine/registers.json")
    (d / ".github/workflows/failure-audit.yml").write_text("name: x\n")
    det = {"workflow": "failure-audit.yml", "detectors": [{"id": "t1", "failure_mode": "fm-tests-red", "kind": "command", "run": cmd, "timeout": 30,
                                                          "root_cause": "rc", "owner": "operations", "remedy": "fix it"}]}
    (d / fa.DETECTORS).write_text(json.dumps(det))
    return d


def status(d, iid):
    return next(i["status"] for i in queue.items(d) if i["id"] == iid)


class ClosureNeedsAProbeSeenFailing(unittest.TestCase):
    def test_us_17_r17_a_probe_never_seen_failing_does_not_close_the_item(self):
        d = contracts_repo(); issue(d, "OL-1"); (d / "marker.txt").write_text("x")
        for m in (0, 10, 20):
            r = C.tick(d, apply=True, now=T0 + timedelta(minutes=m))
            self.assertEqual((status(d, "OL-1"), r["rows"][0]["action"]), ("open", "vacuous"))
        self.assertEqual(r["vacuous_open"], ["OL-1"])

    def test_us_17_r17_a_relapsed_item_needs_more_than_one_consecutive_pass(self):
        d = contracts_repo(); issue(d, "OL-2")
        C.tick(d, apply=True, now=T0 - timedelta(minutes=20)); (d / "marker.txt").write_text("x")
        C.tick(d, apply=True, now=T0 - timedelta(minutes=10)); C.tick(d, apply=True, now=T0)
        self.assertEqual(status(d, "OL-2"), "closed")
        (d / "marker.txt").unlink(); C.tick(d, apply=True, now=T0 + timedelta(minutes=10))
        self.assertEqual(status(d, "OL-2"), "open", "a closed item whose probe fails again is reopened")
        (d / "marker.txt").write_text("x")
        r = C.tick(d, apply=True, now=T0 + timedelta(minutes=20))
        self.assertEqual((status(d, "OL-2"), r["rows"][0]["action"]), ("open", "hold"), "one pass after a reopen does not close it")


class FindingsNameRootCauseAndEscalate(unittest.TestCase):
    def test_us_17_r22_a_finding_names_the_files_changed_since_the_detector_last_passed(self):
        d = audit_repo([sys.executable, "-c", "import sys,pathlib; sys.exit(0 if pathlib.Path('flag.py').read_text()=='ok' else print('flag.py is wrong') or 1)"])
        g = lambda *a: subprocess.run(["git", "-C", str(d), "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", *a], check=True, capture_output=True)
        (d / "flag.py").write_text("ok"); (d / "other.py").write_text("1")
        g("init", "-q"); g("add", "flag.py", "other.py", "doctrine"); g("commit", "-q", "-m", "good")
        self.assertEqual(fa.run(d)[0]["status"], "pass")
        (d / "flag.py").write_text("bad")
        g("add", "flag.py"); g("commit", "-q", "-m", "bad")
        r = fa.run(d)[0]
        self.assertEqual(r["suspects"], ["flag.py"])
        self.assertIn("`flag.py`", json.loads((d / "docs/issues/Q-AUDIT-t1.json").read_text())["body"])

    def test_us_17_r22_a_recurring_signature_escalates_and_a_recovery_closes_with_evidence_and_never_deletes(self):
        d = audit_repo([sys.executable, "-c", "import sys; print('boom'); sys.exit(1)"])
        self.assertEqual(fa.run(d)[0]["disposition"], "filed")
        self.assertEqual(fa.run(d)[0]["disposition"], "mutate")
        self.assertEqual(fa.run(d)[0]["disposition"], "incident")
        det = json.loads((d / fa.DETECTORS).read_text()); det["detectors"][0]["run"] = [sys.executable, "-c", "print('ok')"]
        (d / fa.DETECTORS).write_text(json.dumps(det))
        self.assertEqual(fa.run(d)[0]["disposition"], "recovered")
        path = d / "docs/issues/Q-AUDIT-t1.json"
        self.assertTrue(path.exists(), "closed, never deleted")
        body = json.loads(path.read_text())["body"]
        self.assertIn("**Status:** closed", body); self.assertIn("**Evidence:** detector passed", body)


class UnregisteredModesAreDiscovered(unittest.TestCase):
    def test_us_17_r23_a_signature_seen_three_times_registers_one_mode_with_a_detector_and_two_register_none(self):
        d = scratch(); (d / "doctrine").mkdir()
        for f in ("registers.json", "detectors.json"):
            shutil.copy(ROOT / "doctrine" / f, d / "doctrine" / f)

        def ev(i):
            e = {"source": "ci", "id": str(i), "text": "model gone retired", "class": "model-retired", "opened": "2026-11-01T00:00:00Z", "closed": ""}
            e["signature"] = failmine.signature(e["text"]); e["sig"] = failmine._h(e["class"] + "|" + e["signature"]); return e
        two = [ev(1), ev(2)]
        self.assertEqual(failmine.discover(two, d, apply=True), [])
        new = failmine.discover(two + [ev(3)], d, apply=True)
        self.assertEqual(len(new), 1)
        detectors = json.loads((d / "doctrine/detectors.json").read_text())["detectors"]
        self.assertTrue(any(x["failure_mode"] == new[0] and "--probe" in x["run"] for x in detectors))
        self.assertEqual(failmine.DISCOVER_MIN, 3)


if __name__ == "__main__":
    unittest.main()
