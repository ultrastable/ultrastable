# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import json, shutil, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # removed when the test ends
from foundation import ultrastability as u

REPO = Path(__file__).resolve().parents[2]
BAD = {"criticality.cost": 3.0, "criticality.verified_share": 1.0, "claims.drift": 0, "criticality.k": 2.0}
GOOD = {**BAD, "criticality.cost": 0.5}


class T(unittest.TestCase):
    def setUp(self):
        self.d = Path(scratch())
        (self.d / "doctrine").mkdir()
        (self.d / "docs/issues").mkdir(parents=True)
        for f in ("doctrine/ultrastability.json", "doctrine/clocks.json", "doctrine/spinoff.json", "doctrine/priorities.json"):
            shutil.copy(REPO / f, self.d / f)
        # SECOND-LOOP-2: the live loop tunes its own patience and settle window; the mechanism tests pin the values they were written for
        doc = json.loads((self.d / "doctrine/ultrastability.json").read_text())
        doc["patience_ticks"], doc["settle_ticks"] = 2, 3
        (self.d / "doctrine/ultrastability.json").write_text(json.dumps(doc))
        (self.d / "ops").mkdir()

    def runs(self):
        return json.loads((self.d / "doctrine/clocks.json").read_text())["chain"]["max_runs_per_day"]

    def test_repo_check(self):
        self.assertEqual(u.check(REPO), [])

    def test_bounds(self):
        v = {"min": 0, "max": 1.0}
        self.assertTrue(u.in_bounds(v, 1.0)); self.assertFalse(u.in_bounds(v, 1.01)); self.assertFalse(u.in_bounds(v, None))

    def test_patience_then_step_then_kept(self):
        before = self.runs()
        u.tick(self.d, True, read=BAD)
        self.assertEqual(self.runs(), before)  # one reading out is a disturbance for the first-order loop, not a second-order event
        r = u.tick(self.d, True, read=BAD)
        self.assertEqual([s["var"] for s in r["steps"]], ["spend"])
        self.assertEqual(self.runs(), before - 1)
        r = u.tick(self.d, True, read=GOOD)
        self.assertEqual(r["verdicts"][0]["verdict"], "kept")
        self.assertEqual(self.runs(), before - 1)

    def test_unsettled_step_is_reverted_then_next_step(self):
        before = self.runs()
        for _ in range(2):
            u.tick(self.d, True, read=BAD)
        verdicts, steps = [], []
        for _ in range(3):
            r = u.tick(self.d, True, read=BAD)
            verdicts += r["verdicts"]; steps += r["steps"]
        self.assertEqual(verdicts[0]["verdict"], "reverted")
        self.assertEqual(self.runs(), before)  # the failed parameter step was undone
        self.assertEqual(steps[0]["kind"], "item")  # and the next rung, a restructure, is taken in the same tick
        self.assertTrue((self.d / "docs/issues/Q-ULTRA-spend-2.json").is_file())
        # ASHBY-SEARCH-1: the ladder is spent but the second loop keeps changing the step-function to values not yet tried in this episode
        search = []
        for _ in range(80):
            r = u.tick(self.d, True, read=BAD)
            search += [x for x in r["steps"] if x.get("search")]
            if "exhausted" in r["variables"]["spend"]:
                break
        tried = [x["what"].split("= ")[1].split(" ")[0] for x in search if x["var"] == "spend"]
        self.assertGreaterEqual(len(tried), 5)
        self.assertEqual(len(tried), len(set(tried)), "no value is tried twice in one episode")
        self.assertIn("exhausted", r["variables"]["spend"])  # search space spent: only now a redesign item
        self.assertTrue((self.d / "docs/issues/Q-ULTRA-spend-REDESIGN.json").is_file())

    def test_search_keeps_the_field_that_holds(self):
        for _ in range(40):  # patience, ladder step reverted, restructure item (waits item_settle_ticks), then the first search step
            r = u.tick(self.d, True, read=BAD)
            if any(x.get("search") for x in r["steps"]):
                break
        self.assertTrue(any(x.get("search") for x in r["steps"]))
        held = self.runs()
        r = u.tick(self.d, True, read=GOOD)
        self.assertEqual(r["verdicts"][0]["verdict"], "kept")
        self.assertEqual(self.runs(), held, "a terminal field is kept: no further change while the variable is inside its limits")
        self.assertEqual(u.tick(self.d, True, read=GOOD)["steps"], [])

    def test_unbounded_variable_fails_check_and_ashby_counts(self):
        a = u.ashby(REPO)
        self.assertEqual(a["bounded"], a["variables"])
        self.assertGreater(a["with_step_function"], 0)
        doc = json.loads((self.d / "doctrine/ultrastability.json").read_text())
        doc["scopes"]["platform"]["variables"][0].update(min=None, max=None)
        (self.d / "doctrine/ultrastability.json").write_text(json.dumps(doc))
        (self.d / "foundation").mkdir(exist_ok=True)
        shutil.copy(REPO / "foundation/spinoff.py", self.d / "foundation/spinoff.py")
        self.assertTrue(any("has no limits" in e for e in u.check(self.d)))

    def test_dry_run_writes_nothing(self):
        u.tick(self.d, False, read=BAD); u.tick(self.d, False, read=BAD)
        self.assertFalse((self.d / "ops/ultrastability.jsonl").exists())


if __name__ == "__main__":
    unittest.main()


class Tenants(T):
    def test_stale_cost_is_unmeasured(self):
        (self.d / "ops/cost.jsonl").write_text(json.dumps({"at": "2026-11-13T10:51:42Z"}) + "\n")
        from datetime import datetime, timezone
        self.assertIsNone(u.fresh_cost(self.d, 127.0, now=datetime(2026, 11, 17, tzinfo=timezone.utc)))
        self.assertEqual(u.fresh_cost(self.d, 0.5, now=datetime(2026, 11, 14, tzinfo=timezone.utc)), 0.5)

    def test_probe_rows_with_ts_or_unmeasured_never_crash(self):
        from datetime import datetime, timezone
        now = datetime(2026, 11, 14, tzinfo=timezone.utc)
        (self.d / "ops/cost.jsonl").write_text(json.dumps({"ts": "2026-11-13T10:51:42Z"}) + "\n")
        self.assertEqual(u.fresh_cost(self.d, 0.5, now=now), 0.5)
        (self.d / "ops/cost.jsonl").write_text(json.dumps({"ts": "2026-11-13T10:51:42Z", "unmeasured": "no token"}) + "\n")
        self.assertIsNone(u.fresh_cost(self.d, 0.5, now=now))

    def test_unmeasured_never_acts_and_files_one_item(self):
        r = u.tick(self.d, True, read={**GOOD, "criticality.cost": None})
        r = u.tick(self.d, True, read={**GOOD, "criticality.cost": None})
        self.assertIn("spend", r["unmeasured"]); self.assertEqual(r["steps"], [])
        self.assertTrue((self.d / "docs/issues/Q-ULTRA-spend-UNMEASURED.json").is_file())

    def test_spinoff_loop_writes_value_and_spend_readings(self):
        """TENANT-READINGS-1: value and spend come from the spinoff ledger, so a live app is no longer unmeasured on both."""
        (self.d / "ops/spinoff").mkdir(exist_ok=True)
        (self.d / "doctrine/spinoff.json").write_text(json.dumps({"portfolio": {"kill_below_value": 0.15}}))
        (self.d / "ops/spinoff/ledger.jsonl").write_text("\n".join(json.dumps(r) for r in [
            {"slug": "demo", "url": "https://demo.example", "event": "launch"},
            {"slug": "demo", "event": "decision", "value": 0.3, "budget_share": 0.05}]) + "\n")
        r = u.spinoff_readings(self.d, 0.01)["demo"]
        self.assertEqual(r["spend_vs_budget"], 0.2)
        self.assertIsNone(u.spinoff_readings(self.d, None)["demo"]["spend_vs_budget"])
        u.write_tenants(self.d, fetch=lambda url: 1.0)
        t = u.tenant_readings(self.d, fetch=lambda url: 1.0)["demo"]
        self.assertEqual(t["value"], 2.0)

    def test_tenant_down_takes_a_spinoff_step(self):
        (self.d / "ops/spinoff").mkdir()
        (self.d / "ops/spinoff/ledger.jsonl").write_text(json.dumps({"slug": "demo", "url": "https://demo.example", "event": "launch"}) + "\n")
        for _ in range(2):
            r = u.tick(self.d, True, read=GOOD, fetch=lambda url: 0.0)
        self.assertEqual([s["var"] for s in r["steps"]], ["demo:uptime"])
        self.assertEqual(r["steps"][0]["kind"], "param")  # Ashby: a step-function (a parameter of the first loop) before a restructure
        self.assertEqual(json.loads((self.d / "doctrine/spinoff.json").read_text())["budget"]["max_live"], 10)
        for _ in range(3):
            r = u.tick(self.d, True, read=GOOD, fetch=lambda url: 0.0)
        self.assertTrue((self.d / "docs/issues/Q-ULTRA-demo-uptime-2.json").is_file())

    def test_item_step_waits_for_its_item(self):
        """SECOND-LOOP-SETTLE-1: an item step is not undone after 3 readings (that reverted 14 of 14); it waits for the item or item_settle_ticks."""
        bad = {"claims.drift": 2}
        for _ in range(2):
            r = u.tick(self.d, True, read={**GOOD, **bad})
        self.assertEqual(r["steps"][0]["kind"], "param")
        self.assertEqual(u._jget(json.loads((self.d / "doctrine/priorities.json").read_text()), "goals.#repair-claims.weight"), 70)
        for _ in range(3):
            r = u.tick(self.d, True, read={**GOOD, **bad})
        item = next(s for s in r["steps"] if s["kind"] == "item")["item"]
        for _ in range(5):
            r = u.tick(self.d, True, read={**GOOD, **bad})
            self.assertEqual(r["verdicts"], [], "an open item is not judged after settle_ticks")
        p = self.d / "docs/issues" / (item + ".json")
        j = json.loads(p.read_text()); j["body"] = j["body"].replace("**Status:** open", "**Status:** closed"); p.write_text(json.dumps(j))
        r = u.tick(self.d, True, read={**GOOD, **bad})
        self.assertEqual(r["verdicts"][0]["verdict"], "reverted")  # the work was done and the variable is still out: next rung
        self.assertTrue(any(s.get("search") for s in r["steps"]))  # ladder spent: the search over the knob's untried values starts at once
        r = u.tick(self.d, True, read=GOOD)
        self.assertEqual(r["verdicts"][0]["verdict"], "kept")

    def test_knob_path_by_id(self):
        d = {"goals": [{"id": "a", "weight": 1}, {"id": "b", "weight": 2}]}
        u._jset(d, "goals.#b.weight", 5)
        self.assertEqual(u._jget(d, "goals.#b.weight"), 5)


class Write(T):
    def test_tenant_file_written_with_probe(self):
        (self.d / "ops/spinoff").mkdir()
        (self.d / "ops/spinoff/ledger.jsonl").write_text(json.dumps({"slug": "demo", "url": "https://demo.example", "event": "launch"}) + "\n")
        self.assertEqual(u.write_tenants(self.d, fetch=lambda url: 1.0), ["demo"])
        self.assertEqual(json.loads((self.d / "ops/tenants/demo.json").read_text())["uptime"], 1.0)


class Consult(T):
    def test_unresolved_regulator_blocks_a_step_and_files_an_item(self):
        for f in ("doctrine/topology.json", "doctrine/boundary.json"):
            shutil.copy(REPO / f, self.d / f)
        (self.d / "instances/ultrastable").mkdir(parents=True)
        shutil.copy(REPO / "instances/ultrastable/loop-registry.json", self.d / "instances/ultrastable/loop-registry.json")
        shutil.copy(REPO / "doctrine/clocks.json", self.d / "doctrine/clocks.json")
        doc = json.loads((self.d / "doctrine/ultrastability.json").read_text())
        doc["scopes"]["platform"]["variables"][0]["first_order"] = ["no-such-regulator"]
        (self.d / "doctrine/ultrastability.json").write_text(json.dumps(doc))
        (self.d / ".github/workflows").mkdir(parents=True)
        for _ in range(3):
            r = u.tick(self.d, True, read=BAD)
        self.assertIn("spend", r["unregistered"]); self.assertEqual(r["steps"], [])
        self.assertTrue((self.d / "docs/issues/Q-ULTRA-spend-UNREGISTERED.json").is_file())


class UptimeUserAgent(unittest.TestCase):
    """UPTIME-UA-1: the uptime probe sends a named user agent (Cloudflare blocks Python-urllib with 403)."""
    def test_named_agent(self):
        from unittest import mock
        from foundation import ultrastability as U
        seen = {}
        class R:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *a): return False
        def fake(req, timeout=0):
            seen["ua"] = req.get_header("User-agent"); return R()
        with mock.patch.object(U.urllib.request, "urlopen", fake):
            self.assertEqual(U._get("https://x.example/health"), 1.0)
        self.assertTrue(seen["ua"] and "urllib" not in seen["ua"].lower())



class SecondLoop2(unittest.TestCase):
    """SECOND-LOOP-2 and SPEC-GATE-1: the slow loop measured on itself, sensor faults held, items that cannot be misread."""

    def test_common_mode_holds_identical_tenant_faults(self):
        v = {"id": "uptime", "min": 0.99, "max": 1.0}
        t = [(f"a{i}:uptime", v, 0.0) for i in range(4)] + [("p", {"id": "spend", "min": 0, "max": 1}, 2.0)]
        self.assertEqual(u.common_mode(t), {f"a{i}:uptime" for i in range(4)})
        t[0] = ("a0:uptime", v, 0.5)
        self.assertEqual(u.common_mode(t), set())

    def test_specgate_parts(self):
        from foundation import specgate
        good = ("**Done check:** cmd:python3 -m foundation x\n**Prediction:** spec.quality >= 0.9 within 72 h\n"
                "**Out of scope:** bounds\n**Closing probe:** `python3 -m foundation x`")
        self.assertEqual(specgate.missing(good), [])
        self.assertEqual(set(specgate.missing("**Done check:** looks fine")), {"done", "predict", "scope", "proof"})

    def test_second_loop_items_pass_the_gate(self):
        from foundation import specgate
        v = {"id": "spec_quality", "reading": "spec.quality", "min": 0.9, "max": None, "why": "w", "name": "n"}
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "docs/issues").mkdir(parents=True)
            iid = u._item(d, {"item_prefix": "Q-ULTRA"}, "spec_quality", v, 0, {"kind": "item", "what": "x", "labels": [], "workstream": "U"}, 0.0)
            body = json.loads((Path(d) / "docs/issues" / (iid + ".json")).read_text())["body"]
        self.assertEqual(specgate.missing(body), [])

    def test_readiness_is_a_product(self):
        c = u.load(REPO)
        ids = [v["id"] for v in c["scopes"]["platform"]["variables"]]
        last = {i: {"value": 1, "ok": True} for i in ids}
        last["unattended_horizon"] = {"value": 730, "ok": True}
        last["second_loop_keep_rate"] = {"value": 1.0, "ok": True}
        self.assertEqual(u.readiness(REPO, last)["score"], 100)
        last["second_loop_keep_rate"] = {"value": None, "ok": False}
        self.assertLess(u.readiness(REPO, last)["score"], 100)


class Lessons(unittest.TestCase):
    """LESSONS-1: every lesson resolves to enforcing code or an open, spec-complete item."""

    def test_repo_lessons_hold(self):
        from foundation import lessons
        self.assertEqual(lessons.check(REPO), [])

    def test_unbound_lesson_fails(self):
        from foundation import lessons
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "doctrine").mkdir()
            (Path(d) / "docs/issues").mkdir(parents=True)
            (Path(d) / "doctrine/lessons.json").write_text(json.dumps({"lessons": [{"id": "x", "lesson": "l", "enforced_by": []}]}))
            self.assertIn("x: bound to nothing and names no item", lessons.report(d)["errors"])
