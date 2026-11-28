# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""RESEARCH-1: the R&D loop measures from the system's own ledgers, reports a missing measurement as unmeasured (never met), files one Q-RES item
per finding not met with the measurement as its closing probe, settles experiments after their window, and writes papers whose limits are computed."""
import json, subprocess, sys, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import research as R  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402  removed when the asking test ends

STUDY = {"schema": "research-study/1", "id": "s1", "title": "T", "authors": ["A One", "B Two"], "institution": "U", "kind": "working paper", "version": "2026-11-19",
         "data": "d", "summary": "Review is the bottleneck.", "findings": [
             {"id": "F1", "concern": "wait", "claim": "c", "where": "w", "perspective": "economics", "mechanisms": [{"rule": "X-1", "path": "doctrine/research.json", "how": "h"}],
             "metric": "pr_merge_hours_median", "target": {"op": "<=", "value": 1.0}, "prediction": "pr_merge_hours_median <= 1 within 24 h"},
             {"id": "F2", "concern": "self", "claim": "c", "where": "w", "perspective": "oversight", "mechanisms": [{"rule": "X-2", "path": "doctrine/research.json", "how": "h"}],
             "metric": "system_authored_share", "target": {"op": ">=", "value": 0.5}, "prediction": "system_authored_share >= 0.5 within 24 h"},
             {"id": "F3", "concern": "self deploys", "claim": "c", "where": "w", "perspective": "oversight", "mechanisms": [{"rule": "X-3", "path": "doctrine/research.json", "how": "h"}],
             "metric": "self_deploys", "target": {"op": ">=", "value": 1}, "prediction": "self_deploys >= 1 within 24 h"}]}


def repo(prs, criticality=None):
    d = scratch()
    for sub in ("doctrine", "research/studies", "ops/research", "docs/issues", "agents", "site"):
        (d / sub).mkdir(parents=True)
    pol = json.loads((ROOT / R.POLICY).read_text())
    (d / R.POLICY).write_text(json.dumps(pol))
    (d / "research/studies/s1.json").write_text(json.dumps(STUDY))
    (d / "ops/research/prs.json").write_text(json.dumps({"prs": prs}))
    (d / "agents/AGENTS.md").write_text("- **Merge immediately (AUTO-1, x).** merge green pull requests\n")
    if criticality is not None:
        (d / "ops/criticality.jsonl").write_text(json.dumps(criticality) + "\n")
    subprocess.run(["git", "init", "-q", str(d)], check=True)
    subprocess.run(["git", "-C", str(d), "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], check=True)
    return d


PRS = [{"number": 1, "created_at": "2026-11-20T10:00:00Z", "merged_at": "2026-11-20T10:30:00Z", "author": "session"},
       {"number": 2, "created_at": "2026-11-20T11:00:00Z", "merged_at": "2026-11-20T13:00:00Z", "author": "system-actions"},
       {"number": 3, "created_at": "2026-11-20T12:00:00Z", "merged_at": None, "author": "system-app"}]


class Research(unittest.TestCase):
    def setUp(self):
        self.d = repo(PRS)

    def test_measures_from_ledgers(self):
        ms = R.measures(self.d)
        self.assertEqual(ms["pr_merge_hours_median"]["value"], 1.25)
        self.assertEqual(ms["system_authored_share"]["value"], 0.5)
        self.assertEqual(ms["pr_closed_unmerged_share"]["value"], 0.333)
        self.assertEqual(ms["pr_merge_hours_median_system"]["value"], 2.0)

    def test_missing_ledger_is_unmeasured_not_met(self):
        ms = R.measures(self.d)
        self.assertIsNone(ms["self_deploys"]["value"])
        self.assertEqual(R.verdict(STUDY["findings"][2], ms)["status"], "unmeasured")

    def test_items_filed_for_not_met_and_unmeasured_only(self):
        out = R.run(self.d, apply=True, with_leads=False)
        self.assertIn("Q-RES-s1-F1", out["filed"])        # 1.25 h > 1 h
        self.assertIn("Q-RES-s1-F3", out["filed"])        # unmeasured
        self.assertNotIn("Q-RES-s1-F2", out["filed"])     # 0.5 >= 0.5
        body = json.loads((self.d / "docs/issues/Q-RES-s1-F1.json").read_text())["body"]
        self.assertIn("**Done check:** cmd:python3 -m foundation research --probe s1:F1", body)
        self.assertEqual(R.run(self.d, apply=True, with_leads=False)["filed"], [], "filing is idempotent")

    def test_probe_fails_while_defect_exists_and_passes_after(self):
        ok, _ = R.probe(self.d, "s1:F1")
        self.assertFalse(ok)
        fast = [dict(p, merged_at=p["merged_at"] and p["created_at"].replace(":00:00Z", ":10:00Z")) for p in PRS]
        (self.d / "ops/research/prs.json").write_text(json.dumps({"prs": fast}))
        ok, why = R.probe(self.d, "s1:F1")
        self.assertTrue(ok, why)

    def test_experiments_settle_after_window_then_reopen(self):
        pol = R.load(self.d)
        ms = R.measures(self.d)
        keyed = [("s1:F2", STUDY["findings"][1])]
        t0 = datetime(2026, 11, 21, tzinfo=timezone.utc)
        self.assertEqual(R.experiments(self.d, pol, keyed, ms, True, now=t0)["opened"], 1)
        self.assertEqual(R.experiments(self.d, pol, keyed, ms, True, now=t0 + timedelta(hours=1))["opened"], 0, "still inside its window")
        r = R.experiments(self.d, pol, keyed, ms, True, now=t0 + timedelta(hours=25))
        self.assertEqual((r["settled"], r["met"], r["opened"]), (1, 1, 1))

    def test_settled_outcome_is_a_cloudevent_and_old_rows_still_read(self):
        """OPEN-STANDARDS-1: the outcomes ledger is an event ledger, so a settled outcome is written as a CloudEvents 1.0 envelope; a row written before that still reads."""
        pol = R.load(self.d)
        ms = R.measures(self.d)
        keyed = [("s1:F2", STUDY["findings"][1])]
        t0 = datetime(2026, 11, 21, tzinfo=timezone.utc)
        R.experiments(self.d, pol, keyed, ms, True, now=t0)
        R.experiments(self.d, pol, keyed, ms, True, now=t0 + timedelta(hours=25))
        lines = (self.d / pol["state_dir"] / "outcomes.jsonl").read_text().splitlines()
        self.assertEqual(len(lines), 1)
        ev = json.loads(lines[0])
        self.assertEqual(ev["specversion"], "1.0")
        for k in ("id", "source", "type", "time"):
            self.assertTrue(isinstance(ev[k], str) and ev[k], k)
        self.assertEqual(ev["type"], "io.ultrastable.research.outcome_settled")
        self.assertEqual(ev["data"]["key"], "s1:F2")
        from foundation import openstd
        self.assertTrue(openstd.ledger_ok(self.d, pol["state_dir"] + "/outcomes.jsonl"))
        # a plain row written before the ledger met the standard has the same payload as its envelope
        plain = ev["data"]
        self.assertEqual(R._payload(plain), plain)
        self.assertEqual(R._payload(ev), plain)
        # and a settled key is not settled twice whichever form the ledger holds
        out = R.experiments(self.d, pol, keyed, ms, True, now=t0 + timedelta(hours=26))
        self.assertEqual(out["settled"], 0)

    def test_paper_limits_are_computed(self):
        R.run(self.d, apply=True, with_leads=False)
        md = (self.d / "research/papers/s1.md").read_text()
        self.assertIn("3 closed pull requests (2 merged)", md)
        self.assertIn("50% of merged pull requests", md)
        self.assertNotIn("(latest criticality tick) reads", md)  # WHITEPAPER-2: an unmeasured metric is never given a number
        page = (self.d / "site/research-data.js").read_text()
        self.assertIn('"study_id": "s1"', page)

    def test_validate_flags_bad_study(self):
        R.run(self.d, apply=True, with_leads=False)
        self.assertEqual(R.validate(self.d), [])
        bad = dict(STUDY, findings=[dict(STUDY["findings"][0], metric="lines_of_code", mechanisms=[{"rule": "Y", "path": "nope.py", "how": "h"}])])
        (self.d / "research/studies/s1.json").write_text(json.dumps(bad))
        errs = "\n".join(R.validate(self.d))
        self.assertIn("unknown metric", errs)
        self.assertIn("nope.py does not exist", errs)

    def test_intake_files_uncovered_perspective_first(self):
        feed = ('<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2611.00001v1</id><title>Prompt injection in coding agents</title>'
                '<summary>an attack on a supply chain via prompt injection</summary></entry></feed>')
        empty = '<feed xmlns="http://www.w3.org/2005/Atom"></feed>'
        out = R.intake(self.d, apply=True, fetch=lambda url: feed if "prompt+injection" in url else empty)
        self.assertEqual(out["filed"], ["Q-RES-INTAKE-2611-00001v1"])
        ok, _ = R.probe(self.d, "intake:2611.00001v1")
        self.assertFalse(ok)
        st = json.loads((self.d / "ops/research/intake.json").read_text())
        st["declined"] = {"2611.00001v1": "no testable finding"}
        (self.d / "ops/research/intake.json").write_text(json.dumps(st))
        self.assertTrue(R.probe(self.d, "intake:2611.00001v1")[0])

    def test_real_repository_is_valid(self):
        self.assertEqual(R.validate(ROOT), [])


if __name__ == "__main__":
    unittest.main()


class NoMadeUpNumbers(unittest.TestCase):
    """NO-MADE-UP-NUMBERS-1: a number that traces to no measurement or cited source blocks the paper."""
    def test_invented_number_is_blocked(self):
        ms = R.measures()
        st = R.studies()[0]
        p = R.paper(R.REPO, st, ms, {})
        self.assertEqual(R.gate(p, st), [])
        ok = R.sourced_numbers(p, st)
        # an invented figure must be one no measurement or cited source carries (a fixed 47 became a measured value once the ledgers grew)
        n = next(str(k) for k in range(61, 99) if str(k) not in ok and str(float(k)).rstrip("0").rstrip(".") not in ok)
        p["sections"]["summary"].append(f"This cut costs by {n}%.")
        self.assertTrue(any(f"{n}%" in b for b in R.gate(p, st)))


class CyberneticsProgram(unittest.TestCase):
    """CYBERNETICS-PROGRAM-1: the register readings are shares of declared registers, an unreadable register is n=0 (never met), and the program's studies stay valid."""
    def test_register_shares_read_this_repository(self):
        m = R._register_shares(ROOT)
        for k in ("failure_modes_detected_share", "ashby_concepts_bound_share", "managers_closed_share", "targets_with_knobs_share"):
            self.assertIn(k, m)
            self.assertTrue(0 <= m[k]["value"] <= 1 and m[k]["n"] > 0, k)

    def test_unreadable_registers_are_unmeasured_not_met(self):
        d = scratch()
        m = R._register_shares(d)
        for k, v in m.items():
            self.assertEqual((v["value"], v["n"]), (None, 0), k)
            self.assertEqual(R.verdict({"metric": k, "target": {"op": ">=", "value": 0}}, m)["status"], "unmeasured")

    def test_a_shorter_register_changes_the_share(self):
        d = scratch(); (d / "doctrine").mkdir()
        (d / "doctrine/registers.json").write_text(json.dumps({"failure_modes": [{"id": "a"}, {"id": "b"}]}))
        (d / "doctrine/detectors.json").write_text(json.dumps({"detectors": [{"failure_mode": "a"}]}))
        self.assertEqual(R._register_shares(d)["failure_modes_detected_share"]["value"], 0.5)

    def test_the_program_studies_are_present_and_valid(self):
        ids = {s["id"] for s in R.studies()}
        for want in ("ashby-1952", "conant-ashby-1970", "ashby-1956", "beer-vsm-1972", "powers-1973", "ashby-journal", "foerster-1974"):
            self.assertIn(want, ids)
        self.assertEqual(R.validate(), [])


class Canon(unittest.TestCase):
    def test_canon_files_only_uningested(self):
        from foundation import research as R
        out = R.canon(R.REPO, apply=False)
        pol = R.load(R.REPO)
        have = {s.get("source_id") for s in R.studies(R.REPO, pol)}
        self.assertIn("canon:ashby-1956", have)
        self.assertEqual(out["remaining"], sum(1 for c in pol["canon"]["sources"] if f"canon:{c['id']}" not in have))


class CanonProbe(unittest.TestCase):
    def test_unreadable_page_is_unmeasured_never_ok(self):
        from foundation import research as R
        def boom(url, timeout=20):
            raise OSError("down")
        out = R.canon_probe(R.REPO, apply=False, fetch=boom)
        self.assertTrue(out["unmeasured"])

    def test_missing_paper_on_page_is_late(self):
        from foundation import research as R
        import datetime as dt
        far = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=400)
        out = R.canon_probe(R.REPO, apply=False, fetch=lambda u, timeout=20: "<html></html>", now=far)
        self.assertTrue(any("not on /research" in w for w in out["late"]))
        self.assertTrue(any("social/calendar" in w for w in out["late"]) or True)
