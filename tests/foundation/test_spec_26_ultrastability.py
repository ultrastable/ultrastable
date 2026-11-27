# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-26 (essential variables, the second loop and the platform criticality reading): each test names the requirement it proves in its docstring.

Scratch trees stand in for the repository, clocks are passed in, nothing touches the network.
"""
import json, shutil, subprocess, sys, unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402  (removed when the test ends)
from foundation import criticality as C, goalscheck as gc, pm, sauce, seedadmit, selfimprove as si, selfmodel as sm, ultrastability as u  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
BAD = {"criticality.cost": 3.0, "criticality.verified_share": 1.0, "claims.drift": 0, "criticality.k": 2.0}
GOOD = {**BAD, "criticality.cost": 0.5}
NOW = datetime(2026, 11, 13, 12, 0, tzinfo=timezone.utc)
VARS = ["spend", "deploy_health", "claims_drift", "value", "stalled_clocks", "ui_findings", "happy_paths", "unattended_horizon", "self_shipping",
        "owner_interventions", "second_loop_keep_rate", "spec_quality", "research_in_code", "lessons_enforced"]


class Loop(unittest.TestCase):
    """A scratch tree with the doctrine files the second loop reads and writes, pinned to the values the mechanism tests are written for."""

    def setUp(self):
        self.d = Path(scratch())
        (self.d / "doctrine").mkdir(); (self.d / "docs/issues").mkdir(parents=True); (self.d / "ops").mkdir(); (self.d / "foundation").mkdir()
        for f in ("doctrine/ultrastability.json", "doctrine/clocks.json", "doctrine/spinoff.json", "doctrine/priorities.json", "doctrine/resilience.json", "foundation/spinoff.py"):
            shutil.copy(REPO / f, self.d / f)
        self.edit("doctrine/ultrastability.json", lambda c: c.update(patience_ticks=2, settle_ticks=3))  # the live loop tunes these; the tests pin them
        self.edit("doctrine/clocks.json", lambda c: c["chain"].update(max_runs_per_day=5))

    def edit(self, rel, fn):
        p = self.d / rel; doc = json.loads(p.read_text(encoding="utf-8")); fn(doc); p.write_text(json.dumps(doc), encoding="utf-8")

    def runs(self):
        return json.loads((self.d / "doctrine/clocks.json").read_text())["chain"]["max_runs_per_day"]

    def ledger(self):
        return [json.loads(x) for x in (self.d / "ops/ultrastability.jsonl").read_text().splitlines()]

    def var(self, vid):
        return next(v for v in u.load(self.d)["scopes"]["platform"]["variables"] if v["id"] == vid)


class Declaration(Loop):
    def test_r54_essential_variables_have_limits_and_a_step(self):
        """US-26-R54: every essential variable has limits, a first-order regulator list and a second-order step; a declaration without them fails the check."""
        c = u.load(REPO)
        self.assertEqual(u.check(REPO), [])
        self.assertEqual([v["id"] for v in c["scopes"]["platform"]["variables"]], VARS)
        self.assertEqual([v["id"] for v in c["scopes"]["tenant"]["variables"]], ["uptime", "spend", "claims_drift", "value"])
        for s in c["scopes"].values():
            for v in s["variables"]:
                self.assertTrue(v["min"] is not None or v["max"] is not None, v["id"])
                self.assertTrue(v["ladder"] and v["first_order"] and v["why"], v["id"])
        self.assertTrue(2 <= c["patience_ticks"] <= 6 and 2 <= c["settle_ticks"] <= 8, "the loop tunes both inside its own ladder bounds")
        self.assertEqual((c["item_settle_ticks"], c["min_progress"], c["ledger"], c["item_prefix"]), (21, 0.1, "ops/ultrastability.jsonl", "Q-ULTRA"))
        self.assertEqual(u.check(self.d), [])
        self.edit("doctrine/ultrastability.json", lambda c: c["scopes"]["platform"]["variables"][0].update(min=None, max=None))
        self.assertTrue(any("has no limits" in e for e in u.check(self.d)))
        self.edit("doctrine/ultrastability.json", lambda c: c["scopes"]["platform"]["variables"][0].update(min=0, max=1.0, ladder=[]))
        self.assertTrue(any("has no second-order step" in e for e in u.check(self.d)))
        self.edit("doctrine/ultrastability.json", lambda c: c["scopes"]["platform"]["variables"][0].update(ladder=[{"kind": "item", "what": "x", "labels": [], "workstream": "U"}], reading="no.such.reading"))
        self.assertTrue(any("which nothing computes" in e for e in u.check(self.d)))
        a = u.ashby(REPO)
        self.assertEqual((a["variables"], a["bounded"], a["bounded_share"]), (18, 18, 1.0)); self.assertTrue(a["search_after_ladder"] and a["with_step_function"] > 0)

    def test_r55_unmeasured_is_never_in_bounds_and_never_a_reason_to_act(self):
        """US-26-R55: a variable that cannot be read is unmeasured: out of bounds in the record, no step, one item that names what cannot be read."""
        self.assertFalse(u.in_bounds({"min": 0, "max": 1.0}, None)); self.assertTrue(u.in_bounds({"min": 0, "max": 1.0}, 1.0)); self.assertFalse(u.in_bounds({"min": 0, "max": 1.0}, 1.01))
        for _ in range(5):
            r = u.tick(self.d, True, read={**GOOD, "criticality.cost": None})
        self.assertIn("spend", r["unmeasured"]); self.assertEqual(r["steps"], [])
        self.assertEqual(r["variables"]["spend"], {"value": None, "ok": False, "unmeasured": True})
        from unittest import mock
        import urllib.error
        class Ok:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *a): return False
        with mock.patch.object(u.urllib.request, "urlopen", lambda req, timeout=0: Ok()): self.assertEqual(u._get("https://x.example"), 1.0)
        with mock.patch.object(u.urllib.request, "urlopen", mock.Mock(side_effect=urllib.error.HTTPError("https://x.example", 503, "down", {}, None))): self.assertEqual(u._get("https://x.example"), 0.0)
        with mock.patch.object(u.urllib.request, "urlopen", mock.Mock(side_effect=urllib.error.URLError("no route"))): self.assertIsNone(u._get("https://x.example"), "cannot reach from here: unmeasured, not down")
        self.assertEqual(self.runs(), 5, "no parameter moved")
        item = json.loads((self.d / "docs/issues/Q-ULTRA-spend-UNMEASURED.json").read_text())
        self.assertIn("An unmeasured variable is never in bounds and never a reason to change the system", item["body"])
        self.assertEqual(len(list((self.d / "docs/issues").glob("Q-ULTRA-spend-*"))), 1, "one item, however many ticks")
        rows = [x for x in self.ledger() if x["var"] == "spend"]
        self.assertTrue(all(x["unmeasured"] and x["ok"] is False and x["value"] is None for x in rows))

    def test_r56_patience_then_one_ladder_step(self):
        """US-26-R56: out of bounds for patience_ticks readings in a row takes exactly one step, the first rung the episode has not taken; a parameter step is clamped to its limits."""
        v = self.var("spend")
        r1 = u.tick(self.d, True, read=BAD)
        self.assertEqual(r1["steps"], []); self.assertEqual(r1["variables"]["spend"]["consecutive_out"], 1)
        r2 = u.tick(self.d, True, read=BAD)
        self.assertEqual([s["var"] for s in r2["steps"]], ["spend"])
        s = r2["steps"][0]
        self.assertEqual((s["kind"], s["idx"], s["before"], s["after"]), ("param", 0, 5, 4)); self.assertEqual(self.runs(), 4)
        self.assertEqual(s["prediction"], "criticality.cost within bounds within 3 ticks"); self.assertEqual(s["consulted"], v["first_order"])
        pv = [json.loads(x) for x in (self.d / "ops/provenance.jsonl").read_text().splitlines() if x.strip()]
        self.assertTrue(any(s["id"] in json.dumps(p) for p in pv), "every step carries a provenance row")
        self.assertEqual(u._param(self.d, {"file": "doctrine/clocks.json", "path": "chain.max_runs_per_day", "min": 1, "max": 8, "delta": -9}), (4, 1), "clamped at the minimum")
        for _ in range(3):
            r = u.tick(self.d, True, read=BAD)
        self.assertEqual(self.runs(), 5, "the unsettled parameter step was undone")
        self.assertEqual(r["steps"][0]["kind"], "item", "and the next rung is taken in the same tick")
        issue = json.loads((self.d / "docs/issues/Q-ULTRA-spend-2.json").read_text())
        self.assertRegex(issue["body"], r"\*\*Prediction:\*\* criticality\.cost (>=|<=) [\d.]+ within 72 h"); self.assertIn("**Out of scope:** changing the bounds of `spend`", issue["body"])
        self.assertIn("**Closing probe:**", issue["body"]); self.assertEqual(issue["milestone"], "Now")

    def test_r57_verdict_rules(self):
        """US-26-R57: a step is kept once the variable is back in bounds or has closed at least min_progress of its gap; a parameter is undone after settle_ticks, an item after its item closes or item_settle_ticks."""
        c = {"settle_ticks": 3, "item_settle_ticks": 21, "min_progress": 0.1}
        v = {"min": None, "max": 1.0}
        param = {"kind": "param", "value": 2.0}
        self.assertEqual(u.settle_verdict(self.d, c, param, True, 1, v, 0.9), "kept", "back in bounds: kept at once")
        self.assertIsNone(u.settle_verdict(self.d, c, param, False, 2, v, 2.0), "a parameter acts at once but is judged after settle_ticks readings")
        self.assertEqual(u.settle_verdict(self.d, c, param, False, 3, v, 2.0), "reverted")
        self.assertEqual(u.settle_verdict(self.d, c, param, False, 3, v, 1.5), "kept", "half the gap closed")
        self.assertEqual(u.settle_verdict(self.d, c, param, False, 3, v, 1.95), "reverted", "5 percent of the gap is not progress")
        self.assertEqual(u.settle_verdict(self.d, c, {"kind": "param", "value": None}, False, 3, v, 1.5), "reverted", "no starting reading, no progress to credit")
        self.assertEqual((u.gap({"min": 0.9, "max": None}, 0.4), u.gap({"min": 0.9, "max": None}, 0.95), u.gap(v, None)), (0.5, 0, None))
        item = {"kind": "item", "item": "Q-ULTRA-x-2", "value": 2.0}
        self.assertIsNone(u.settle_verdict(self.d, c, item, False, 5, v, 2.0), "work that has to be done first is not judged early")
        issue = lambda status: (self.d / "docs/issues/Q-ULTRA-x-2.json").write_text(json.dumps({"body": f"**Status:** {status}\n"}))
        issue("open"); self.assertIsNone(u.settle_verdict(self.d, c, item, False, 5, v, 2.0))
        for st in ("closed", "done", "live", "shelved", "gate"):
            issue(st); self.assertEqual(u.settle_verdict(self.d, c, item, False, 5, v, 2.0), "reverted", st)
        issue("open"); self.assertEqual(u.settle_verdict(self.d, c, item, False, 21, v, 2.0), "reverted", "after item_settle_ticks")
        # through the loop: a kept verdict stays, a reverted parameter returns to its value before
        for _ in range(2):
            u.tick(self.d, True, read=BAD)
        self.assertEqual(self.runs(), 4)
        r = u.tick(self.d, True, read=GOOD)
        self.assertEqual(r["verdicts"][0]["verdict"], "kept"); self.assertEqual(self.runs(), 4)

    def test_r58_search_after_the_ladder_then_redesign(self):
        """US-26-R58: once the ladder is spent the loop draws untried parameter values at random from the declared range (seeded, no value twice in an episode) and files a redesign item only when none is left."""
        for _ in range(40):
            r = u.tick(self.d, True, read=BAD)
            if any(x.get("search") for x in r["steps"]):
                break
        self.assertTrue(any(x.get("search") for x in r["steps"]))
        v = self.var("spend")
        self.assertEqual(u._search(self.d, "spend", v, []), u._search(self.d, "spend", v, []), "a run replays")
        search = [x for x in self.ledger() if x.get("search")]
        for _ in range(80):
            r = u.tick(self.d, True, read=BAD)
            search += [x for x in r["steps"] if x.get("search")]
            if "exhausted" in r["variables"]["spend"]:
                break
        values = [x["what"].split("= ")[1].split(" ")[0] for x in search]
        self.assertGreaterEqual(len(values), 5); self.assertEqual(len(values), len(set(values)))
        self.assertTrue(all(s["kind"] == "param" and "untried in this episode" in s["what"] for s in search))
        self.assertEqual(r["variables"]["spend"]["exhausted"], "Q-ULTRA-spend-REDESIGN")
        redesign = json.loads((self.d / "docs/issues/Q-ULTRA-spend-REDESIGN.json").read_text())
        self.assertEqual(redesign["labels"], ["p0", "agent-ready"]); self.assertIn("size: L", redesign["body"])

    def test_r59_a_variable_whose_regulators_cannot_be_named_is_not_stepped(self):
        """US-26-R59: the loop consults the self-model first; a variable whose first-order regulators resolve to nothing is not changed and an item is filed instead."""
        for f in ("doctrine/topology.json", "doctrine/boundary.json", "instances/ultrastable/loop-registry.json"):
            (self.d / f).parent.mkdir(parents=True, exist_ok=True); shutil.copy(REPO / f, self.d / f)
        (self.d / ".github/workflows").mkdir(parents=True)
        for _ in range(3):
            u.tick(self.d, True, read=BAD)  # registered regulators: once patience is spent a step is taken
        self.assertTrue(any(x.get("ev") == "step" and x["var"] == "spend" for x in self.ledger()))
        other = Path(scratch())
        shutil.copytree(self.d, other, dirs_exist_ok=True); (other / "ops/ultrastability.jsonl").unlink()
        c = json.loads((other / "doctrine/ultrastability.json").read_text()); c["scopes"]["platform"]["variables"][0]["first_order"] = ["no-such-regulator"]
        (other / "doctrine/ultrastability.json").write_text(json.dumps(c))
        for _ in range(3):
            r = u.tick(other, True, read=BAD)
        self.assertIn("spend", r["unregistered"]); self.assertEqual(r["steps"], [])
        self.assertEqual(r["variables"]["spend"]["unregistered_regulators"], ["no-such-regulator"])
        self.assertTrue((other / "docs/issues/Q-ULTRA-spend-UNREGISTERED.json").is_file())

    def test_r60_one_value_shared_by_every_tenant_is_a_sensor_fault(self):
        """US-26-R60: three or more tenants reading one identical out-of-bounds value on a variable are held: one common-mode item, no step on any tenant."""
        v = {"id": "uptime", "min": 0.99, "max": 1.0}
        t = [(f"a{i}:uptime", v, 0.0) for i in range(3)]
        self.assertEqual(u.common_mode(t), {"a0:uptime", "a1:uptime", "a2:uptime"})
        self.assertEqual(u.common_mode(t[:2]), set(), "two tenants are not enough to call it the sensor")
        self.assertEqual(u.common_mode([*t[:2], ("a2:uptime", v, 0.5)]), set(), "a differing value is a tenant fault")
        self.assertEqual(u.common_mode([(k, v, 1.0) for k, _, _ in t]), set(), "in bounds is not a fault")
        self.assertEqual(u.common_mode([(k, v, None) for k, _, _ in t]), set(), "unmeasured is not a shared value")
        self.assertEqual(u.common_mode([("platform", v, 0.0)] * 3), set(), "only keys of the form tenant:variable count")
        (self.d / "ops/spinoff").mkdir()
        (self.d / "ops/spinoff/ledger.jsonl").write_text("\n".join(json.dumps({"slug": s, "url": f"https://{s}.example", "event": "launch"}) for s in ("a", "b", "c")) + "\n")
        for _ in range(3):
            r = u.tick(self.d, True, read=GOOD, fetch=lambda url: 0.0)
        self.assertEqual(r["common_mode"], ["a:uptime", "b:uptime", "c:uptime"])
        self.assertTrue(all(r["variables"][k]["common_mode"] and r["variables"][k]["ok"] is False for k in r["common_mode"]))
        self.assertFalse(any(s["var"].endswith(":uptime") for s in r["steps"]))
        item = json.loads((self.d / "docs/issues/Q-ULTRA-uptime-COMMON-MODE.json").read_text())
        self.assertIn("fix the reading, not the tenants", item["title"]); self.assertEqual(item["labels"], ["p0", "agent-ready"])

    def test_r61_every_reading_step_and_verdict_is_a_ledger_row_and_a_dry_run_writes_nothing(self):
        """US-26-R61: each reading, step and verdict is one row of ops/ultrastability.jsonl with a sequence number; a dry run changes no file."""
        u.tick(self.d, False, read=BAD); u.tick(self.d, False, read=BAD)
        self.assertFalse((self.d / "ops/ultrastability.jsonl").exists()); self.assertEqual(self.runs(), 5)
        for r in (BAD, BAD, GOOD):
            u.tick(self.d, True, read=r)
        rows = self.ledger()
        self.assertEqual([r["seq"] for r in rows], list(range(len(rows))))
        self.assertEqual({r["ev"] for r in rows}, {"reading", "step", "verdict"})
        step = next(r for r in rows if r["ev"] == "step"); verdict = next(r for r in rows if r["ev"] == "verdict")
        self.assertEqual(verdict["step_id"], step["id"]); self.assertEqual(verdict["verdict"], "kept")
        reading = next(r for r in rows if r["ev"] == "reading" and r["var"] == "spend")
        self.assertEqual(set(reading), {"at", "ev", "ok", "seq", "value", "var"})
        self.assertEqual(len([r for r in rows if r["ev"] == "reading" and r["var"] == "spend"]), 3, "one reading per variable per tick")

    def test_r62_the_second_loop_is_judged_by_its_own_outcomes(self):
        """US-26-R62: the keep rate is the share of the last 30 verdicts that were kept (none until five exist) and readiness is the product of horizon, bounds and learning."""
        led = lambda *vs: (self.d / "ops/ultrastability.jsonl").write_text("".join(json.dumps({"ev": "verdict", "verdict": x}) + "\n" for x in vs))
        self.assertIsNone(u.keep_rate(self.d), "no ledger yet")
        led("kept", "reverted", "kept", "kept"); self.assertIsNone(u.keep_rate(self.d), "four verdicts are not enough")
        led("kept", "reverted", "kept", "kept", "reverted"); self.assertEqual(u.keep_rate(self.d), 0.6)
        led(*(["reverted"] * 40 + ["kept"] * 30)); self.assertEqual(u.keep_rate(self.d), 1.0, "only the last 30")
        ids = [v["id"] for v in u.load(REPO)["scopes"]["platform"]["variables"]]
        last = {i: {"value": 1, "ok": True} for i in ids}
        last["unattended_horizon"] = {"value": 365, "ok": True}; last["second_loop_keep_rate"] = {"value": 1.0, "ok": True}
        self.assertEqual(u.readiness(REPO, last), {"score": 100, "horizon": 1.0, "bounds": 1.0, "learning": 1.0})
        last["unattended_horizon"] = {"value": 182.5, "ok": True}
        self.assertEqual(u.readiness(REPO, last)["score"], 50)
        last["second_loop_keep_rate"] = {"value": 0.0, "ok": False}
        r = u.readiness(REPO, last)
        self.assertEqual((r["learning"], r["score"]), (0.5, round(100 * 0.5 * (13 / 14) * 0.5)), "no keeps is half credit; a variable out of bounds counts against bounds")
        self.assertEqual(u.readiness(REPO, {})["score"], 0, "nothing measured is not ready")


class Constitution(unittest.TestCase):
    def test_r63_the_seed_declares_six_essential_variables_each_measured_by_code_that_exists(self):
        """US-26-R63: the seed constitution names six essential variables and each is measured by a file of the seed that carries the named marker."""
        c = json.loads((REPO / "seed/doctrine/constitution.json").read_text(encoding="utf-8"))
        variables = c["identity"]["essential_variables"]
        self.assertEqual([v["id"] for v in variables], ["heartbeat", "k_eff", "silent_drops", "metrics_in_breach", "cost", "unattended_horizon"])
        for v in variables:
            f = REPO / "seed" / v["measured_by"]["file"]
            self.assertTrue(f.is_file(), v["id"])
            if v["measured_by"].get("has"):
                self.assertIn(v["measured_by"]["has"], f.read_text(encoding="utf-8"), v["id"])
        conds = {x["id"]: x for x in c["criticality"]["conditions"]}
        self.assertEqual([conds[k]["value"] for k in ("branching", "no_human_touch", "no_ignition_gap")], [[0.8, 1.2], 0, 0])
        self.assertEqual(c["identity"]["step_function"]["knobs"], ["core.pace.idle_runs", "core.pace.max_stride", "core.year.headroom"])
        goal_knobs = {k["id"] for k in json.loads((REPO / "seed/autonomy/goals.json").read_text())["knobs"]}
        self.assertTrue(set(c["identity"]["step_function"]["knobs"]) <= goal_knobs, "every knob the constitution names is declared in goals.json")
        self.assertEqual(c["bootstrap"]["stages"][:3], ["read", "constitute", "qualify"]); self.assertEqual(c["bootstrap"]["stages"][-2:], ["year_gate", "verify_live"])


class GoalsCheck(unittest.TestCase):
    def tree(self):
        t = Path(scratch()); (t / "seed/autonomy").mkdir(parents=True); (t / "doctrine").mkdir()
        shutil.copy(REPO / gc.GOALS, t / gc.GOALS); shutil.copy(REPO / gc.BASE, t / gc.BASE)
        return t

    def test_r64_every_target_has_a_measured_variable_a_deadline_and_a_knob(self):
        """US-26-R64: the goalscheck holds each target to a source, an operator and number, a deadline and a knob with bounds; a target without a knob is allowed only on the shrink-only baseline."""
        self.assertEqual(gc.check(REPO), [])
        t = self.tree(); g = json.loads((t / gc.GOALS).read_text())
        for x in g["goals"]:
            if x["id"] == "core.cost.peak":
                del x["deadline"]; x["source"] = "none"
        g["knobs"] = [k for k in g["knobs"] if k["goal_id"] != "core.cost.peak"]
        g["knobs"][0]["value"] = g["knobs"][0]["max"] + 1
        (t / gc.GOALS).write_text(json.dumps(g))
        bad = gc.check(t)
        for needle in ("no measured variable", "needs a deadline", "no knob attached", "value outside its bounds"):
            self.assertTrue(any(needle in b for b in bad), needle)
        t2 = self.tree(); b = json.loads((t2 / gc.BASE).read_text()); b["no_knob"].append("core.cost.peak"); (t2 / gc.BASE).write_text(json.dumps(b))
        self.assertTrue(any("shrink-only" in x for x in gc.check(t2)))
        t3 = self.tree(); g3 = json.loads((t3 / gc.GOALS).read_text()); g3["knobs"][0]["step"] = 0; (t3 / gc.GOALS).write_text(json.dumps(g3))
        self.assertTrue(any("needs a positive step" in x for x in gc.check(t3)))


class SelfImprove(unittest.TestCase):
    def test_r65_levers_are_ranked_by_weighted_gap_with_exploration_and_kept_only_on_effect_without_a_guard_worse(self):
        """US-26-R65: SELF-IMPROVE-1 ranks levers by gap times weight with an exploration bonus for untried ones, retires failed levers, and keeps a change only if the target moved and no guard worsened."""
        d = si.load(REPO)
        self.assertEqual(si.check(REPO), [])
        self.assertEqual((d["params"]["min_effect"], d["params"]["guard_tolerance"], d["params"]["explore_epsilon"], d["params"]["explore_pool"]), (0.05, 0.02, 0.1, 3))
        self.assertEqual(si.gap(0.5, 1.0, "higher"), 0.5); self.assertEqual(si.gap(1.2, 1.0, "higher"), 0.0); self.assertEqual(si.gap(3, 0, "lower"), 3.0, "a target of 0 normalises against 1")
        cands = [{"loop": "a", "signal": "loop-pass-rate", "value": 0.5, "tries": 0}, {"loop": "b", "signal": "loop-pass-rate", "value": 0.5, "tries": 9},
                 {"loop": "c", "signal": "loop-pass-rate", "value": 0.99, "tries": 0}, {"loop": "d", "signal": "loop-pass-rate", "value": 0.1, "tries": 0, "retired": True}]
        ranked = si.rank(cands)
        self.assertEqual([x["loop"] for x in ranked], ["a", "b"], "a lever that met its target or was retired is not a candidate; the untried one outranks the tried one")
        self.assertGreater(ranked[0]["priority"], ranked[1]["priority"])
        import random
        picks = {si.choose(si.rank([{"loop": str(i), "signal": "open-gaps", "value": i + 1, "tries": 0} for i in range(6)]), rng=random.Random(s))["loop"] for s in range(60)}
        self.assertTrue(picks <= {"5", "4", "3"}, "exploration draws only from the top explore_pool")
        pred = {"baseline": 0.5, "target": 0.9}
        self.assertTrue(si.verdict(pred, 0.8, {"cost": 1.0}, {"cost": 1.0})["keep"])
        v = si.verdict(pred, 0.8, {"cost": 1.0}, {"cost": 0.8}); self.assertEqual((v["keep"], v["guards_worse"], v["action"]), (False, ["cost"], "OL-REVERT"))
        self.assertFalse(si.verdict(pred, 0.51, {}, {})["keep"], "a move under min_effect is not a gain")


class SelfModel(Loop):
    def test_r66_the_system_names_what_it_consists_of_and_the_loop_consults_it(self):
        """US-26-R66: the self-model lists the essential variables, regulators, parts, clocks and boundary; the check fails for an unresolvable regulator, an unregistered workflow or a stale served model."""
        self.assertEqual(sm.check(REPO), [])
        m = sm.build(REPO, readings=False)
        for k in ("self", "essential_variables", "fast_loop", "slow_loop", "parts", "clocks", "boundary", "inheritance", "index"):
            self.assertIn(k, m)
        self.assertEqual(set(m["fast_loop"]["regulators"]) - set(m["index"]), set(), "every regulator a variable names resolves to a loop, clock or worker")
        self.assertEqual({w["id"] for w in m["parts"]["workflows"]}, set(sm.workflows(REPO)))
        self.assertEqual(m["slow_loop"]["ledger"], "ops/ultrastability.jsonl"); self.assertIn("doctrine/clocks.json:chain.max_runs_per_day", m["slow_loop"]["parameters"])
        self.assertIn("improve all", m["inheritance"]["rule"].lower()); self.assertTrue(m["boundary"]["egress"])
        d = Path(scratch())
        for f in ("doctrine/ultrastability.json", "doctrine/topology.json", "doctrine/boundary.json", "doctrine/clocks.json", "doctrine/self-baseline.json", "site/self-data.js", "instances/ultrastable/loop-registry.json"):
            (d / f).parent.mkdir(parents=True, exist_ok=True); shutil.copy(REPO / f, d / f)
        shutil.copytree(REPO / ".github/workflows", d / ".github/workflows")
        for f in json.loads((d / "doctrine/ultrastability.json").read_text())["self"]["inheritance"]["carriers"]:
            (d / f).parent.mkdir(parents=True, exist_ok=True); shutil.copy(REPO / f, d / f)
        self.assertEqual([e for e in sm.check(d) if "does not exist" not in e], [])
        (d / ".github/workflows/rogue.yml").write_text("name: rogue\n")
        errs = sm.check(d)
        self.assertTrue(any("rogue belongs to no loop" in e for e in errs)); self.assertTrue(any("stale" in e for e in errs))


# ---- the platform's own criticality reading (foundation/criticality.py): ops ledgers instead of D1 tables ----
GOOD_DEPLOY = {"at": "2026-11-13T08:00:00Z", "worker": "w", "uploaded": True, "live_matches_commit": True}


def crit_repo(deploys, cost_rows=()):
    d = Path(scratch())
    for rel in ("doctrine", "ops", "docs/issues"):
        (d / rel).mkdir(parents=True)
    for f in ("doctrine/criticality.json", "doctrine/cost.json", "ops/cost-thresholds.json"):
        shutil.copy(REPO / f, d / f)
    (d / "ops/deploys.jsonl").write_text("".join(json.dumps(x) + "\n" for x in deploys), encoding="utf-8")
    (d / "ops/cost.jsonl").write_text("".join(json.dumps(x) + "\n" for x in cost_rows), encoding="utf-8")
    return d


COSTLY = [{"d1": [{"name": "ultrastable-a", "rows_read": 10 ** 10}], "ai": {"neurons": 1}}]


class PlatformCriticality(unittest.TestCase):
    def test_r67_k_is_verified_deploys_over_cost_and_touches_in_a_day_and_each_clause_of_the_mantra_is_a_check(self):
        """US-26-R67: the platform k is the verified deploys of the last 24 hours over max(normalized cost, cost_floor) plus human touches; the four mantra clauses are computed, not asserted."""
        c = C.cfg(REPO)
        self.assertEqual((c["window_hours"], c["k_floor"], c["cost_floor"]), (24, 1.0, 0.1)); self.assertEqual(C.MANTRA, "Ship. Verify. Spend less than it earns. Feed the next loop.")
        r = C.compute(crit_repo([GOOD_DEPLOY, {**GOOD_DEPLOY, "at": "2026-11-11T08:00:00Z"}]), NOW, feed_ok=True)
        self.assertEqual((r["deploys"], r["verified_deploys"], r["k"], r["gate"]), (1, 1, 10.0, "open"), "the deploy two days old is outside the window; the cost floor 0.1 is the denominator")
        self.assertEqual(r["clauses"], {"ship": True, "verify": True, "spend": True, "feed": True})
        bad = C.compute(crit_repo([GOOD_DEPLOY, {**GOOD_DEPLOY, "live_matches_commit": False}], COSTLY), NOW, feed_ok=False)
        self.assertEqual(bad["clauses"], {"ship": True, "verify": False, "spend": False, "feed": False}); self.assertLess(bad["k"], 1.0)
        self.assertEqual(bad["gate"], "deploys-and-cost-only")
        none = C.compute(crit_repo([]), NOW, feed_ok=True)
        self.assertEqual((none["clauses"]["ship"], none["k"], none["regime"]), (False, 0.0, "subcritical"))
        self.assertEqual(C.check(REPO), [])

    def test_r68_the_gate_narrows_the_executor_queue_and_never_empties_it(self):
        """US-26-R68: below the floor only items that raise deploys or cut cost may be taken; when cost runs away only cost cuts; when critical only on outside sources the self-raising items go first; nothing is dropped."""
        items = [{"number": "Q-FEATURE-1", "labels": []}, {"number": "Q-COST-9", "labels": []}, {"number": "X", "labels": [{"name": "raises-deploys"}]}]
        self.assertEqual([i["number"] for i in C.gate(items, crit_repo([]), NOW)], ["Q-COST-9", "X"])
        self.assertEqual(len(C.gate(items, crit_repo([GOOD_DEPLOY]), NOW)), 3)
        only = [{"number": "F-1", "labels": []}]
        self.assertEqual(C.gate(only, crit_repo([]), NOW), only, "none qualify: the full list, so the queue cannot starve")
        rods = [{"number": "Q-DEPLOY-1", "labels": []}, {"number": "Q-COST-2", "labels": []}, {"number": "F", "labels": []}]
        self.assertEqual([i["number"] for i in C.gate(rods, crit_repo([GOOD_DEPLOY], COSTLY), NOW)], ["Q-COST-2"])
        driven = [{"number": "F-1", "labels": []}, {"number": "Q-EXEC-2", "labels": []}, {"number": "G", "labels": ["raises-self"]}]
        self.assertEqual([i["number"] for i in C.gate(driven, crit_repo([{**GOOD_DEPLOY, "origin": "outside"}]), NOW)], ["Q-EXEC-2", "G", "F-1"])
        self.assertEqual([i["number"] for i in C.gate(driven, crit_repo([{**GOOD_DEPLOY, "origin": "executor"}]), NOW)], ["F-1", "Q-EXEC-2", "G"])

    def test_r69_k_self_counts_only_what_the_system_originated_and_shipped_on_itself(self):
        """US-26-R69: origin is read from the deployed commit (executor marker at the start of a line, or a handoff by a self-agent prefix); k_self counts only those, and an outside deploy counts as a human touch in the report."""
        c = C.cfg(REPO)
        self.assertEqual(C.origin_of("Closes #9\n\nExecutor run 2026-11-14T00:00Z. Checks passed", c), "executor")
        self.assertEqual(C.origin_of("a mention of Executor run 2026-11-14T00:00Z mid line is not a run", c), "outside")
        self.assertEqual(C.origin_of("X\n## Handoff\nitem: A\nagent: workers-ai-glm\n", c), "self-agent")
        self.assertEqual(C.origin_of("X\n## Handoff\nitem: A\nagent: ultrastable-bot\n", c), "self-agent")
        self.assertEqual(C.origin_of("X\n## Handoff\nitem: A\nagent: claude-code\n", c), "outside")
        self.assertEqual((C.origin_of(None, c), C.origin_of("AUTH-1: fix callback (#309)", c)), ("unknown", "outside"))
        self.assertEqual(c["self_reference"]["self_origins"], ["executor", "self-agent"])
        own = C.compute(crit_repo([{**GOOD_DEPLOY, "origin": "executor"}, {**GOOD_DEPLOY, "worker": "v", "origin": "self-agent"}]), NOW, feed_ok=True)
        self.assertEqual((own["self_deploys"], own["regime"], own["self_share"]), (2, "self-sustaining", 1.0))
        out = C.compute(crit_repo([{**GOOD_DEPLOY, "origin": "outside"}]), NOW, feed_ok=True)
        self.assertEqual((out["k_self"], out["regime"], out["human_touches"], out["k"]), (0.0, "driven", 1, 10.0), "k keeps its held-item denominator; the reported touch count is the honest one")
        self.assertEqual(C.compute(crit_repo([]), NOW, feed_ok=True)["regime"], "subcritical")
        self.assertEqual(C.compute(crit_repo([{**GOOD_DEPLOY}]), NOW, feed_ok=True)["origins"], {"unknown": 1}, "a commit that cannot be read is unknown, never self")

    def test_r81_a_deploy_carries_the_most_self_made_origin_of_the_substantive_commits_it_put_live(self):
        """US-26-R81: a row's recorded origin wins; otherwise the deploy's origin is the most self-made (executor over self-agent over outside) of the substantive commits since the previous deployed commit, bookkeeping commits ([skip ci]) are ignored, and a commit that cannot be read is unknown, never self."""
        d = crit_repo([]); c = C.cfg(d)
        def git(*a):
            r = subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", *a], cwd=d, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr); return r.stdout.strip()
        git("init", "-q"); (d / "f.txt").write_text("0")
        def commit(msg, n):
            (d / "f.txt").write_text(str(n)); git("add", "-A"); git("commit", "-q", "-m", msg); return git("rev-parse", "HEAD")
        base = commit("AUTH-1: a person's change", 1)
        executor = commit("Fix the thing\n\nExecutor run 2026-11-26T00:00Z. Checks passed", 2)
        bookkeeping = commit("regen-generated [skip ci]", 3)
        # the deploy ran on the newest commit, a bookkeeping one: its own message says nothing, the change it carried was the executor's
        self.assertEqual(C.origin_of(C.commit_message(d, bookkeeping), c), "outside")
        got = C.carried_origin(d, bookkeeping, [{"sha": base}], c)
        self.assertEqual(got["origin"], "executor"); self.assertEqual([x["origin"] for x in got["carried"]], ["executor"], "the [skip ci] commit carries no change of its own")
        self.assertEqual(C.deploy_origin(d, {"sha": bookkeeping}, c, [{"sha": base}]), "executor")
        self.assertEqual(C.deploy_origin(d, {"sha": bookkeeping, "origin": "outside"}, c, [{"sha": base}]), "outside", "a recorded origin wins")
        # an outside commit on top of a self-agent one: the more self-made origin is carried
        agent = commit("X\n\n## Handoff\nitem: A\nagent: workers-ai-glm\n", 4)
        person = commit("a person's change", 5)
        self.assertEqual(C.carried_origin(d, person, [{"sha": bookkeeping}], c)["origin"], "self-agent")
        only = C.carried_origin(d, person, [{"sha": agent}], c)
        self.assertEqual(only["origin"], "outside"); self.assertEqual(only["since"], agent)
        # nothing readable is unknown, never self
        empty = Path(scratch()); git_empty = subprocess.run(["git", "init", "-q"], cwd=empty, capture_output=True, text=True); self.assertEqual(git_empty.returncode, 0)
        self.assertEqual(C.carried_origin(empty, "", [], c)["origin"], "unknown")
        self.assertEqual(C.deploy_origin(d, {"sha": "0" * 40}, c, [{"sha": base}]), "unknown", "a commit this clone does not hold is unknown")

    def test_r81_with_no_earlier_row_only_the_deployed_commit_is_read_and_the_command_falls_back_to_head(self):
        """US-26-R81: with no earlier ledger row that is an ancestor, only the deployed commit itself is read; a ledger row whose commit the clone
        does not hold is unknown (never HEAD), while `criticality --deploy-origin <sha>` falls back to HEAD for such a sha, prints the origin word,
        and with --json the whole reading (origin, sha, since, carried, omitted); with no readable commit it reads unknown."""
        import contextlib, io
        from unittest import mock
        d = crit_repo([]); c = C.cfg(d)
        def git(*a):
            r = subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", *a], cwd=d, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr); return r.stdout.strip()
        git("init", "-q")
        def commit(msg, n):
            (d / "f.txt").write_text(str(n)); git("add", "-A"); git("commit", "-q", "-m", msg); return git("rev-parse", "HEAD")
        base = commit("AUTH-1: a person's change", 1)
        executor = commit("Fix the thing\n\nExecutor run 2026-11-26T00:00Z. Checks passed", 2)
        bookkeeping = commit("regen-generated [skip ci]", 3)
        person = commit("a person's change", 4)
        # no earlier row: only the deployed commit is read, not the history beneath it
        self.assertEqual([x["sha"] for x in C.carried_origin(d, person, [], c)["carried"]], [person[:12]])
        self.assertEqual(C.carried_origin(d, person, [], c)["origin"], "outside", "the executor commit beneath is not read without an earlier row")
        self.assertEqual(C.carried_origin(d, executor, [], c)["origin"], "executor")
        self.assertEqual(C.deploy_origin(d, {"sha": bookkeeping}, c, []), "unknown", "a [skip ci] commit read alone carries nothing")
        self.assertEqual(C.deploy_origin(d, {"sha": "f" * 40}, c, [{"sha": base}]), "unknown", "a ledger row never guesses from HEAD")

        def cli(root, *args):
            out = io.StringIO()
            with mock.patch.object(C, "REPO", root), contextlib.redirect_stdout(out):
                rc = C.main(["--deploy-origin", *args])
            self.assertEqual(rc, 0); return out.getvalue().strip()
        (d / "ops/deploys.jsonl").write_text("".join(json.dumps(x) + "\n" for x in ({"sha": base}, {"sha": bookkeeping})), encoding="utf-8")
        self.assertEqual(cli(d, bookkeeping), "executor", "without --json the command prints the origin word only")
        r = json.loads(cli(d, bookkeeping, "--json"))
        self.assertEqual(set(r), {"origin", "sha", "since", "carried", "omitted"})
        self.assertEqual((r["origin"], r["sha"], r["since"], r["omitted"]), ("executor", bookkeeping, base, 0))
        self.assertEqual(r["carried"], [{"sha": executor[:12], "origin": "executor"}])
        # a sha the clone does not hold, or none at all, falls back to HEAD (person), carried since the nearest earlier row (bookkeeping)
        for args in (("f" * 40,), ()):
            self.assertEqual(cli(d, *args), "outside")
            h = json.loads(cli(d, *args, "--json"))
            self.assertEqual((h["sha"], h["since"], [x["sha"] for x in h["carried"]]), (person, bookkeeping, [person[:12]]))
        # nothing readable: unknown, never self
        e = crit_repo([]); self.assertEqual(subprocess.run(["git", "init", "-q"], cwd=e, capture_output=True, text=True).returncode, 0)
        self.assertEqual(cli(e, "abc1234"), "unknown")
        self.assertEqual(json.loads(cli(e, "abc1234", "--json")), {"origin": "unknown", "sha": "", "carried": []})

    def test_r70_a_tick_that_changed_no_state_is_a_failure_and_files_its_own_item(self):
        """US-26-R70: a criticality tick whose state equals the previous tick's is logged as stalled and files the stall item once; a changed state is not a stall."""
        d = crit_repo([GOOD_DEPLOY])
        a = C.tick(d, apply=True, now=NOW, feed_ok=True)
        self.assertFalse(a["stalled"]); self.assertFalse((d / "docs/issues/Q-CRIT-STALL.json").exists())
        b = C.tick(d, apply=True, now=NOW, feed_ok=True)
        self.assertTrue(b["stalled"]); self.assertEqual(a["state"], b["state"])
        item = json.loads((d / "docs/issues/Q-CRIT-STALL.json").read_text())
        self.assertEqual(item["labels"], ["p0", "agent-ready", "raises-deploys"]); self.assertIn("**Closing probe:** python3 -m foundation criticality --check", item["body"])
        self.assertEqual(len((d / "ops/criticality.jsonl").read_text().splitlines()), 2)
        before = (d / "docs/issues/Q-CRIT-STALL.json").read_text(); C.tick(d, apply=True, now=NOW, feed_ok=True)
        self.assertEqual((d / "docs/issues/Q-CRIT-STALL.json").read_text(), before, "filed once")
        (d / "ops/deploys.jsonl").write_text((d / "ops/deploys.jsonl").read_text() + json.dumps({**GOOD_DEPLOY, "worker": "w2"}) + "\n")
        self.assertFalse(C.tick(d, apply=True, now=NOW, feed_ok=True)["stalled"], "a new deploy changed the state")
        dry = crit_repo([GOOD_DEPLOY]); C.tick(dry, apply=False, now=NOW, feed_ok=True)
        self.assertFalse((dry / "ops/criticality.jsonl").exists() and (dry / "ops/criticality.jsonl").read_text().strip() != "")

    def test_r71_open_ignition_gaps_are_measured_and_an_unmeasured_chain_is_not_a_closed_one(self):
        """US-26-R71: the sauce pass writes the links that do not close on themselves to ops/ignition.json; the platform claims self-sustaining only at k over its floor and zero gaps, and a missing reading is never zero."""
        con = {"relapsed_open": ["Q-1"], "unusable_open": ["Q-2"]}
        g = sauce.gaps(con, {"dangling": ["x"]}, {"without_doer": ["Q-FAM"], "silent_drops": 2}, {"exhausted": ["m1"], "regressions": [{"guard": "g", "target": "t"}]})
        self.assertEqual([x["source"] for x in g], ["contracts", "contracts", "throughput", "throughput", "metricloop", "metricloop", "metafold"])
        self.assertTrue(all(x["owner"] and x["closing_probe"] and x["link"] for x in g))
        self.assertEqual(sauce.gaps({}, {}, {}, {}), [])
        d = crit_repo([GOOD_DEPLOY])
        self.assertEqual(C.ignition(d), {"open_ignition_gaps": None, "at": None})
        r = C.compute(d, NOW, feed_ok=True)
        self.assertEqual((r["open_ignition_gaps"], r["self_sustaining"]), (None, False), "an unmeasured chain is not a closed chain")
        (d / "ops/ignition.json").write_text(json.dumps({"at": "2026-11-13T11:00:00Z", "open_ignition_gaps": 2, "gaps": g[:2]}))
        r = C.compute(d, NOW, feed_ok=True); self.assertEqual((r["open_ignition_gaps"], r["self_sustaining"]), (2, False))
        (d / "ops/ignition.json").write_text(json.dumps({"at": "2026-11-13T11:00:00Z", "open_ignition_gaps": 0, "gaps": []}))
        r = C.compute(d, NOW, feed_ok=True); self.assertEqual((r["open_ignition_gaps"], r["self_sustaining"]), (0, True))
        (d / "ops/ignition.json").write_text("{not json"); self.assertEqual(C.ignition(d)["open_ignition_gaps"], None)
        low = crit_repo([]); (low / "ops/ignition.json").write_text(json.dumps({"open_ignition_gaps": 0})); self.assertFalse(C.compute(low, NOW, feed_ok=True)["self_sustaining"], "k under its floor")

    def test_r72_the_collector_turns_the_repository_records_into_one_sample_for_the_worker(self):
        """US-26-R72: deploy/criticality-collect.mjs builds the sample the tick Worker takes (24-hour verified and failed deploys, spend units, touches, ignition gaps) and sends nothing without the URL and the token."""
        js = """
import { buildSample, main } from './deploy/criticality-collect.mjs';
const now = Date.parse('2026-11-14T12:00:00Z');
const s = buildSample({ deploys: [{ at: '2026-11-14T08:00:00Z', uploaded: true, live_matches_commit: true }, { at: '2026-11-14T09:00:00Z', uploaded: true, live_matches_commit: false },
  { at: '2026-11-12T09:00:00Z', uploaded: true, live_matches_commit: true }, { at: '2026-11-14T10:00:00Z', uploaded: false }],
  crit: [{ cost: 0.4 }, { cost: 1.25 }], ignition: { gaps: [{ link: 'l', owner: 'o', closing_probe: 'p', source: 'x' }] }, touches: 2, now });
let calls = 0; const code = await main(['--dry'], { CRITICALITY_URL: 'u', CRITICALITY_TOKEN: 't' }, async () => { calls++; return { ok: false }; }, now);
console.log(JSON.stringify({ s, code, calls }));
"""
        out = subprocess.run(["node", "--input-type=module", "-e", js], cwd=REPO, capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        r = json.loads(out.stdout.strip().splitlines()[-1]); s = r["s"]
        self.assertEqual((s["deploys_ok"], s["deploys_fail"], s["spend_units"], s["cap_breached"], s["human_touches"], s["source"]), (1, 1, 12.5, True, 2, "collector"))
        self.assertEqual(s["at"], "2026-11-14 12:00:00"); self.assertEqual(s["ignition_gaps"], [{"link": "l", "owner": "o", "closing_probe": "p"}])
        self.assertEqual((r["code"], r["calls"]), (0, 0), "a dry run sends nothing")


class ProductManagerKnobs(unittest.TestCase):
    def tree(self, runs=4, share=0.3):
        d = Path(scratch()); (d / "doctrine").mkdir()
        for f in ("doctrine/knobs.json", "doctrine/growth.json", "doctrine/clocks.json"):
            shutil.copy(REPO / f, d / f)
        for rel, fn in (("doctrine/clocks.json", lambda c: c["chain"].update(max_runs_per_day=runs)), ("doctrine/growth.json", lambda c: c.update(target_growth_share=share))):
            doc = json.loads((d / rel).read_text()); fn(doc); (d / rel).write_text(json.dumps(doc))
        return d

    def test_r77_the_product_manager_turns_only_declared_bounded_knobs_once_a_week_and_keeps_or_reverts_each_by_the_metric_it_was_meant_to_move(self):
        """US-26-R77: GROWTH-2 knobs are declared with bounds, changed at most once a week, one at a time, logged with a prediction, and reverted at review when the metric is no better."""
        k = json.loads((REPO / "doctrine/knobs.json").read_text())
        self.assertEqual((k["min_days_between_changes"], k["review_after_days"]), (7, 7))
        self.assertEqual([x["id"] for x in k["knobs"]], ["target_growth_share", "chain_max_runs_per_day", "window_merges"])
        self.assertTrue(all(x["min"] < x["max"] and x["step"] > 0 and x["keep_if"] in ("hold", "improve") for x in k["knobs"]))
        d, now, day = self.tree(), 1_800_000_000.0, 86400
        waiting = {"takeable": 6, "executor_merged_7d": 0}
        r = pm.tune(d, waiting, now)
        self.assertEqual(r["changed"]["knob"], "chain_max_runs_per_day"); self.assertEqual((r["changed"]["old"], r["changed"]["new"]), (4, 5))
        self.assertEqual(r["changed"]["prediction"], "executor_merged_7d rises above 0 within 7 days")
        self.assertEqual(json.loads((d / "doctrine/clocks.json").read_text())["chain"]["max_runs_per_day"], 5)
        log = pm.knob_log(d); self.assertEqual((len(log), log[0]["metric"], log[0]["baseline"], log[0]["reviewed"]), (1, "executor_merged_7d", 0, None))
        self.assertEqual(pm.tune(d, waiting, now + 6 * day)["changed"], None, "not again inside the week, and not reviewed before its time")
        self.assertEqual(len(pm.knob_log(d)), 1)
        rev = pm.tune(d, waiting, now + 8 * day)   # the metric did not move: the change is undone
        self.assertEqual(rev["reviewed"]["kept"], False); self.assertEqual(json.loads((d / "doctrine/clocks.json").read_text())["chain"]["max_runs_per_day"], 4)
        log = pm.knob_log(d); self.assertEqual(log[0]["reviewed"], "reverted"); self.assertIn("was no better after 7 days", log[1]["why"])
        # a change that moved its metric is kept; a knob at its bound is not pushed past it
        d2 = self.tree(); pm.tune(d2, waiting, now)
        kept = pm.tune(d2, {**waiting, "executor_merged_7d": 3}, now + 8 * day)
        self.assertEqual((kept["reviewed"]["kept"], pm.knob_log(d2)[0]["reviewed"]), (True, "kept")); self.assertEqual(json.loads((d2 / "doctrine/clocks.json").read_text())["chain"]["max_runs_per_day"], 5)
        d3 = self.tree(runs=8); self.assertIsNone(pm.tune(d3, waiting, now)["changed"]); self.assertFalse((d3 / "ops/growth/knob-log.jsonl").exists())
        # the bar is raised only when the share is well above it, and kept while the metric holds
        d4 = self.tree(share=0.3)
        up = pm.tune(d4, {"growth_share": 0.5}, now)["changed"]
        self.assertEqual((up["knob"], up["old"], up["new"]), ("target_growth_share", 0.3, 0.35))
        self.assertIsNone(pm.tune(self.tree(share=0.3), {"growth_share": 0.44}, now)["changed"], "under the bar plus 0.15 nothing moves")
        held = pm.tune(d4, {"growth_share": 0.5}, now + 8 * day)
        self.assertTrue(held["reviewed"]["kept"], "a bar that holds is kept when the metric is no worse")
        self.assertEqual(pm.tune(self.tree(), {}, now, write=False)["changed"], None)
        dry = self.tree(); r = pm.tune(dry, waiting, now, write=False)
        self.assertTrue(r["changed"]["changed"]); self.assertFalse((dry / "ops/growth/knob-log.jsonl").exists()); self.assertEqual(json.loads((dry / "doctrine/clocks.json").read_text())["chain"]["max_runs_per_day"], 4)


class FleetStage(unittest.TestCase):
    def root(self, at, seeds=("a",), url="https://x"):
        d = Path(scratch()); (d / "doctrine").mkdir(); (d / "ops").mkdir()
        (d / "doctrine/seed-deploys.json").write_text(json.dumps({"seeds": list(seeds)}))
        (d / "ops/deploys.jsonl").write_text(json.dumps({"kind": "seed", "slug": "a", "live_ok": True, "url": url, "at": at}) + "\n")
        return d

    def test_r80_a_deployed_system_is_judged_by_the_stage_it_reads_for_itself_not_by_answering_health(self):
        """US-26-R80: after 48 hours a deployed seed must read looping or above on its own /health; a lower stage or no reading is reported with what blocks it, and a younger seed is not judged yet."""
        import datetime as dt
        now = dt.datetime(2026, 11, 30, tzinfo=dt.timezone.utc)
        d = self.root("2026-11-21T00:00:00Z")
        ticking = {"ok": True, "ignition": {"stage": "ticking", "blocking": {"stage": "looping", "why": "not ticking: executor (failing)"}}}
        errs = seedadmit.autonomy(d, fetch=lambda url: ticking, now=now)
        self.assertEqual(len(errs), 1); self.assertIn("at stage ticking, below looping: not ticking: executor (failing)", errs[0]); self.assertTrue(errs[0].startswith("a: "))
        for st in ("looping", "closing", "instrumented", "critical", "self-sustaining"):
            self.assertEqual(seedadmit.autonomy(d, fetch=lambda url, st=st: {"ok": True, "ignition": {"stage": st}}, now=now), [], st)
        self.assertIn("unmeasured", seedadmit.autonomy(d, fetch=lambda url: {"ok": True}, now=now)[0], "no reading is unmeasured, never a pass")
        def down(url):
            raise OSError("refused")
        self.assertIn("did not answer", seedadmit.autonomy(d, fetch=down, now=now)[0])
        self.assertEqual(seedadmit.autonomy(self.root("2026-11-29T12:00:00Z"), fetch=lambda url: ticking, now=now), [], "judged only after the 48 hour grace")
        self.assertEqual(seedadmit.autonomy(self.root("2026-11-21T00:00:00Z", seeds=("a", "never")), fetch=lambda url: {"ok": True, "ignition": {"stage": "looping"}}, now=now), [])
        rep = {"last_tick": {"report": "Happened: tick 2 ran; ignition: stage ticking; next looping blocked: not ticking: lane (failing)."}}
        self.assertEqual(seedadmit.stage_of(rep), ("ticking", "not ticking: lane (failing)."), "a Worker from before the field existed is read from its tick report")
        self.assertEqual(seedadmit.stage_of({"ignition": {"stage": "bogus"}})[0], None)
        src = (REPO / "seed/worker/src/ignition.js").read_text(encoding="utf-8")
        self.assertTrue(all(f"'{st}'" in src for st in seedadmit.STAGES)); self.assertEqual((seedadmit.AUTONOMY_MIN_STAGE, seedadmit.AUTONOMY_GRACE_HOURS), ("looping", 48))


class PublicStage(unittest.TestCase):
    def test_r14_the_public_site_never_shows_a_stage_older_than_two_tick_intervals(self):
        """US-26-R14: the public stage reading comes from the tick Worker at request time, is stamped with the time of the reading, and a reading older than two tick intervals is refused with 503 stale_reading and no stage."""
        js = """
import { ignitionReading, ignitionResponse, TICK_INTERVAL_S } from './site/live.js';
const NOW = Date.parse('2026-11-20T12:00:00Z');
const live = at => ({ ok: true, k_eff: 0.5, k_self: 0.1, self_regime: 'subcritical', open_ignition_gaps: 2, self_sustaining: false, pulse: { at },
  ignition: { stage: 'ticking', since: '2026-11-15 19:40:16', at, bootstrapped: false, blocking: { stage: 'looping', why: 'no loop closed twice' }, log: [] } });
const tick = j => ({ fetch: async req => { if (new URL(req.url).pathname !== '/live') throw new Error('wrong path'); return new Response(JSON.stringify(j)); } });
const old = new Date(NOW - (2 * TICK_INTERVAL_S + 60) * 1000).toISOString().replace('T', ' ').slice(0, 19);
const out = {
  fresh: await ignitionReading({ TICK: tick(live('2026-11-20 11:55:00')) }, NOW),
  freshStatus: (await ignitionResponse({ TICK: tick(live('2026-11-20 11:55:00')) }, NOW)).status,
  stale: await ignitionReading({ TICK: tick(live(old)) }, NOW), staleStatus: (await ignitionResponse({ TICK: tick(live(old)) }, NOW)).status,
  noBinding: await ignitionReading({}, NOW), down: await ignitionReading({ TICK: { fetch: async () => { throw new Error('down'); } } }, NOW),
  none: await ignitionReading({ TICK: tick({ ok: true, ignition: null }) }, NOW), interval: TICK_INTERVAL_S };
console.log(JSON.stringify(out));
"""
        r = subprocess.run(["node", "--input-type=module", "-e", js], cwd=REPO, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        o = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertEqual(o["interval"], 600)
        f = o["fresh"]
        self.assertTrue(f["ok"]); self.assertEqual((f["stage"], f["age_s"], f["reading_at"], f["max_age_s"], f["k_self"]), ("ticking", 300, "2026-11-20 11:55:00", 1200, 0.1)); self.assertEqual(o["freshStatus"], 200)
        s = o["stale"]
        self.assertEqual((s["ok"], s["code"], s["stage"], s["reading_at"], o["staleStatus"]), (False, "stale_reading", None, s["reading_at"], 503)); self.assertGreater(s["age_s"], s["max_age_s"])
        self.assertEqual(o["noBinding"]["code"], "no_binding"); self.assertEqual(o["down"]["code"], "tick_unreachable"); self.assertEqual(o["none"]["code"], "stale_reading")


if __name__ == "__main__":
    unittest.main()
