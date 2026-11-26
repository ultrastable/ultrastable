# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-28 (a year unattended: simulation, trajectory and seed lifecycle): the requirements, proved through the public functions of the seed's own
engines (seed/scripts/yearsim.py, trajectory.py, seedlife.py, seedadmit.py, seed/bootstrap/bootstrap.py) and the platform modules that wrap them
(foundation/yearsim.py, yearfail.py, runway.py, unattended.py, seedlife.py, seedadmit.py, seedlaunch.py, trajectory.py, temporal.py, compatdate.py,
modelwatch.py, deprot.py). Every test names the requirement it proves, in the method name and in the first docstring line (US-00-R12).
Nothing here touches the network, an account or the real repository: the clock is injected, scratch directories are removed when each test ends, and
a drill that must run real recovery code runs it against the repository read-only."""
import contextlib, datetime as dt, io, json, os, random, shutil, subprocess, sys, types, unittest, urllib.error
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _repo import scratch  # noqa: E402  (removes each scratch directory when its test ends; also puts the repository root on sys.path)

REPO = HERE.parents[1]
SEED = REPO / "seed"
sys.path.insert(0, str(SEED / "scripts"))
sys.path.insert(0, str(SEED / "bootstrap"))
import yearsim as sy, trajectory as st, seedlife as sl, seedadmit as sa  # noqa: E402  the engines every system carries
import bootstrap as bs  # noqa: E402
from foundation import compatdate, deprot, modelwatch, runway, seedlaunch, temporal, unattended, yearfail  # noqa: E402
from foundation import seedadmit as fa, seedlife as fsl, trajectory as ft, yearsim as fy  # noqa: E402

TODAY = dt.date(2026, 11, 26)
NOW = dt.datetime(2026, 11, 26, 12, tzinfo=dt.timezone.utc)
PY = sys.executable


def write(root, rel, obj):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(obj if isinstance(obj, str) else json.dumps(obj, indent=1) + "\n", encoding="utf-8")
    return p


def drill(code):
    return [PY, "-c", code]


def fault(fid, rate=6, dur=(1, 1), **kw):
    return {"id": fid, "what": fid, "rate_per_year": rate, "duration_days": list(dur), "basis": "assumed: test", **kw}


def conf(*faults, **kw):
    return {"seed": "spec28", "runs": 20, "days": 730, "target_days": 365, "fatal_floor": 0.05, "fatal_after_days": 3, "faults": list(faults), "scheduled": [], **kw}


OK_DRILL, BAD_DRILL = drill("pass"), drill("import sys; print('boom'); sys.exit(3)")


class FaultRegister(unittest.TestCase):
    def test_us_28_r01_the_register_is_checked(self):
        """US-28-R01: a fault names a basis that says observed or assumed; the target is never below 365 days and the span covers it."""
        root = scratch()
        write(root, sy.CONF, conf(fault("a", basis="observed: 3 events"), fault("b")))
        self.assertEqual(sy.check(root), [])
        write(root, sy.CONF, conf(fault("a"), target_days=200))
        self.assertTrue(any("never below 365" in e for e in sy.check(root)))
        write(root, sy.CONF, conf(fault("a"), days=300))
        self.assertTrue(any("never below 365" in e for e in sy.check(root)))
        c = conf(fault("a"))
        del c["fatal_floor"]
        write(root, sy.CONF, c)
        self.assertIn("missing fatal_floor", sy.check(root))
        write(root, sy.CONF, conf(fault("g", basis="a guess")))
        self.assertTrue(any(e.startswith("g: basis must say observed: or assumed:") for e in sy.check(root)))
        self.assertEqual(sy.check(SEED), [])  # the register every new system is born with

    def test_us_28_r02_a_drill_is_a_command_and_its_exit_code_is_the_verdict(self):
        """US-28-R02: exit 0 recovers at capacity_while (default 0.6); anything else, a timeout or a missing program is fatal at 0; the evidence is the last output line."""
        root = scratch()
        c = conf(fault("ok", drill=drill("print('first'); print('recovered')")), fault("bad", drill=BAD_DRILL), fault("quiet", drill=OK_DRILL, capacity_while=0.3),
                 fault("slow", drill=drill("import time; time.sleep(5)"), drill_timeout=1), fault("gone", drill=["/no/such/program"]),
                 fault("long", drill=drill("print('x' * 500)")))
        r = sy.drills(root, c)
        self.assertEqual((r["ok"]["mode"], r["ok"]["capacity"], r["ok"]["recover"], r["ok"]["exercised"], r["ok"]["evidence"]), ("recovers", 0.6, True, True, "recovered"))
        self.assertEqual((r["bad"]["mode"], r["bad"]["capacity"], r["bad"]["recover"], r["bad"]["exercised"], r["bad"]["evidence"]), ("fatal", 0.0, False, True, "boom"))
        self.assertEqual((r["quiet"]["capacity"], r["quiet"]["evidence"]), (0.3, "(no output)"))
        self.assertTrue(r["slow"]["evidence"].startswith("TimeoutExpired") and r["slow"]["mode"] == "fatal" and r["slow"]["exercised"])
        self.assertTrue(r["gone"]["evidence"].startswith("FileNotFoundError") and not r["gone"]["recover"])
        self.assertEqual(len(r["long"]["evidence"]), 200)

    def test_us_28_r03_a_fault_with_no_drill_is_declared_never_a_pass(self):
        """US-28-R03: no drill means exercised false, mode degrades, capacity from the declaration (default 0.5)."""
        root = scratch()
        r = sy.drills(root, conf(fault("plain"), fault("declared", capacity=0.7)))
        self.assertEqual((r["plain"]["mode"], r["plain"]["capacity"], r["plain"]["exercised"]), ("degrades", 0.5, False))
        self.assertEqual((r["declared"]["capacity"], r["declared"]["recover"], r["declared"]["exercised"]), (0.7, True, False))
        self.assertIn("declared, not exercised", r["plain"]["evidence"])

    def test_us_28_r04_a_platform_drill_result_has_one_shape_and_a_crash_is_never_a_pass(self):
        """US-28-R04: R() rounds capacity to three places and makes recover and exercised booleans; a drill that raises is recorded as not exercised."""
        r = fy.R("recovers", 0.12345, 1, 0, "e", gate=True)
        self.assertEqual((r["capacity"], r["recover"], r["exercised"], r["gate"], r["mode"], r["evidence"]), (0.123, True, False, True, "recovers", "e"))
        boom = mock.Mock(side_effect=RuntimeError("injected"))
        with mock.patch.dict(fy.DRILLS, {"conflict_resolver": boom}):
            c = fy.drills(REPO, TODAY, only="merge-conflict")["merge-conflict"]
        self.assertEqual((c["mode"], c["capacity"], c["recover"], c["exercised"]), ("degrades", 0.5, False, False))
        self.assertTrue(c["evidence"].startswith("drill crashed: RuntimeError"))

    def test_us_28_r05_findings_name_what_nothing_recovers_from(self):
        """US-28-R05: fatal, a permanent capacity loss, a declared-only recovery and a server that ships nothing are each a finding."""
        rs = {"a": fy.R("fatal", 0, False, True, "e"), "b": fy.R("degrades", 0.6, False, True, "e"), "c": fy.R("recovers", 1, True, False, "e"), "d": fy.R("recovers", 0.9, True, True, "e")}
        fs = {f["id"]: f["why"] for f in fy.findings({}, rs, {"release_horizon_p10": 0, "self_rate_per_day": 0})}
        self.assertEqual(list(fs), ["a", "b", "c", "self-release"])
        self.assertEqual(fs["a"], "nothing recovers from it without a person")
        self.assertEqual(fs["b"], "capacity stays at 0.6 after it, for good")
        self.assertEqual(fs["c"], "its recovery is declared but no drill exercises code")
        self.assertEqual([f["id"] for f in fy.findings({}, rs, {"release_horizon_p10": 500, "self_rate_per_day": 0.7})], ["a", "b", "c"])

    def test_us_28_r06_drills_inject_the_fault_into_real_recovery_code(self):
        """US-28-R06: seven classes run real code and say so; github-down, cloudflare-incident, actions-billing and domain-renewal declare a recovery and run nothing."""
        want = {"model-retirement": "vendor-wide retirements through agents.complete", "merge-conflict": "both sides kept: True", "dependency-break": "advanced by Dependabot",
                "token-revoked": "expiring detected: expiring; revoked detected: invalid", "scheduler-silent": "takes over", "node-eol": "automatic rewrite to"}
        if shutil.which("node"):
            want["ai-quota"] = "next day: normal"
        for fid, text in want.items():
            r = fy.drills(REPO, TODAY, only=fid)[fid]
            self.assertTrue(r["exercised"], f"{fid}: {r['evidence']}")
            self.assertIn(text, r["evidence"], fid)
        for fid in ("github-down", "cloudflare-incident", "actions-billing", "domain-renewal"):
            self.assertFalse(fy.drills(REPO, TODAY, only=fid)[fid]["exercised"], fid)

    def test_us_28_r07_the_platform_register_is_checked_against_the_code_and_the_input_register(self):
        """US-28-R07: every drill named exists in foundation/yearsim.py, every depends is a registered external input, the span covers the target, the page data is fresh."""
        root = scratch()
        write(root, "doctrine/unattended.json", (REPO / "doctrine/unattended.json").read_text(encoding="utf-8"))
        base = json.loads((REPO / "doctrine/yearsim.json").read_text(encoding="utf-8"))
        write(root, fy.CONF, base)
        self.assertEqual(fy.check(root), [])
        bad = json.loads(json.dumps(base))
        bad["faults"][0]["drill"] = "nope"
        bad["faults"][1]["basis"] = "a guess"
        bad["faults"][2]["depends"] = ["ghost"]
        bad["days"], bad["target_days"] = 300, 300
        del bad["ledger"]
        write(root, fy.CONF, bad)
        errs = "\n".join(fy.check(root))
        for want in ("drill 'nope' is not in foundation/yearsim.py", "basis must say observed: or assumed:", "depends on ghost, which doctrine/unattended.json does not register",
                     "the simulated span must cover the target", "missing ledger"):
            self.assertIn(want, errs)
        write(root, fy.CONF, base)
        write(root, fy.DATA, "stale")
        self.assertIn("site/yearsim-data.js is stale: run yearsim --run --apply", fy.check(root))


class SimulatedYear(unittest.TestCase):
    def test_us_28_r08_a_seeded_year_is_reproducible(self):
        """US-28-R08: the same configuration, results and seed give the same years; the seed is named by the configuration."""
        c = conf(fault("f", rate=20))
        res = {"f": sy.R("recovers", 0.9, True, True, "e")}
        self.assertEqual(sy.one_year(c, res, "s|1", TODAY), sy.one_year(c, res, "s|1", TODAY))
        self.assertEqual(sy.horizon(c, res, 15, TODAY), sy.horizon(c, res, 15, TODAY))
        self.assertEqual(sy.horizon(c, res, 15, TODAY, seed="a"), sy.horizon(c, res, 15, TODAY, seed="a"))
        self.assertEqual(sy.horizon(c, res, 15, TODAY), sy.horizon(c, res, 15, TODAY, seed="spec28"))  # c["seed"] is the default seed

    def test_us_28_r09_faults_arrive_at_their_yearly_rate_for_a_duration_in_range(self):
        """US-28-R09: stochastic faults arrive as a Poisson process; scheduled ones sit on their date for 30 days and outside the span are ignored."""
        res = {"f": sy.R("recovers", 0.9, True, True, "e")}
        self.assertEqual(sy.events(conf(fault("f", rate=0)), res, random.Random(1), TODAY), [])
        ev = sy.events(conf(fault("f", rate=365, dur=(2, 4))), res, random.Random(1), TODAY)
        self.assertTrue(600 < len(ev) < 860, len(ev))  # about 365 a year over a 730-day span
        self.assertEqual([e[0] for e in ev], sorted(e[0] for e in ev))
        self.assertTrue(all(2 <= e[2] <= 4 and 0 <= e[0] < 730 for e in ev))
        c = conf(scheduled=[{"id": "in"}, {"id": "before"}, {"id": "after"}, {"id": "none"}])
        res = {"in": sy.R("recovers", 0.5, True, True, "e", date=(TODAY + dt.timedelta(days=10)).isoformat()),
               "before": sy.R("recovers", 0.5, True, True, "e", date=(TODAY - dt.timedelta(days=1)).isoformat()),
               "after": sy.R("recovers", 0.5, True, True, "e", date=(TODAY + dt.timedelta(days=730)).isoformat()), "none": sy.R("recovers", 0.5, True, True, "e")}
        ev = sy.events(c, res, random.Random(1), TODAY)
        self.assertEqual([(e[0], e[1], e[2]) for e in ev], [(10, "in", 30.0)])

    def test_us_28_r10_capacities_multiply_and_a_permanent_loss_ends_the_year(self):
        """US-28-R10: active faults multiply their capacities, a fault that does not recover is a permanent factor, fatal_after_days days under the floor end the year at the first of them."""
        d10 = (TODAY + dt.timedelta(days=10)).isoformat()
        two = conf(scheduled=[{"id": "s"}, {"id": "t"}])
        res = {"s": sy.R("recovers", 0.5, True, True, "e", date=d10), "t": sy.R("recovers", 0.5, True, True, "e", date=d10)}
        self.assertEqual(sy.one_year(two, res, "k", TODAY)["capacity_year"], 0.938)  # (335 days at 1 + 30 days at 0.25) / 365
        self.assertEqual(sy.one_year(conf(scheduled=[{"id": "s"}]), res, "k", TODAY)["capacity_year"], 0.959)  # (335 days at 1 + 30 days at 0.5) / 365
        stop = conf(scheduled=[{"id": "s"}])
        y = sy.one_year(stop, {"s": sy.R("recovers", 0.0, True, True, "e", date=(TODAY + dt.timedelta(days=100)).isoformat())}, "k", TODAY)
        self.assertEqual((y["horizon"], y["died"], y["killer"]), (100, True, "s"))
        perm = conf(fault("p", rate=365))
        pres = {"p": sy.R("degrades", 0.0, False, True, "e")}
        first = sy.events(perm, pres, random.Random("k"), TODAY)[0][0]
        y = sy.one_year(perm, pres, "k", TODAY)
        self.assertEqual((y["horizon"], y["died"], y["killer"]), (first, True, "p"))
        blip = conf(fault("b", rate=12, dur=(1, 1)))  # a one-day loss never reaches three days under the floor
        y = sy.one_year(blip, {"b": sy.R("recovers", 0.0, True, True, "e")}, "k", TODAY)
        self.assertEqual((y["horizon"], y["died"], y["killer"]), (730, False, None))

    def test_us_28_r11_a_year_reports_its_mean_capacity_over_the_target(self):
        """US-28-R11: capacity_year is the sum of daily capacity over the first target_days days divided by target_days; days after the end do not count."""
        y = sy.one_year(conf(), {}, "k", TODAY)
        self.assertEqual((y["capacity_year"], y["horizon"], y["died"], y["killer"], y["events"]), (1.0, 730, False, None, {}))
        d = sy.one_year(conf(scheduled=[{"id": "s"}]), {"s": sy.R("recovers", 0.0, True, True, "e", date=(TODAY + dt.timedelta(days=100)).isoformat())}, "k", TODAY)
        self.assertEqual(d["capacity_year"], round(100 / 365, 3))

    def test_us_28_r12_the_horizon_is_a_percentile_over_seeded_years(self):
        """US-28-R12: p10, p50 and p90 are read at index floor(p * (n - 1)) of the sorted horizons; survive_year is the share that reach target_days; killers are counted most first."""
        self.assertEqual((sy.pct([5, 1, 3, 2, 4], 0.10), sy.pct([5, 1, 3, 2, 4], 0.50), sy.pct([5, 1, 3, 2, 4], 0.90)), (1, 3, 4))
        self.assertIsNone(sy.pct([], 0.5))
        calm = sy.horizon(conf(), {}, 8, TODAY)
        self.assertEqual((calm["p10"], calm["p50"], calm["p90"], calm["survive_year"], calm["killers"]), (730, 730, 730, 1.0, {}))
        dead = sy.horizon(conf(fault("x", rate=365)), {"x": sy.R("degrades", 0.0, False, True, "e")}, 12, TODAY)
        self.assertTrue(dead["p10"] < 365 and dead["survive_year"] == 0.0)
        self.assertEqual(dead["killers"], {"x": 12})
        both = sy.horizon(conf(fault("x", rate=365), fault("y", rate=0.0001)), {"x": sy.R("degrades", 0.0, False, True, "e"), "y": sy.R("degrades", 0.0, False, True, "e")}, 12, TODAY)
        self.assertEqual(list(both["killers"])[0], "x")

    def test_us_28_r13_strict_mode_fails_every_identity_gate(self):
        """US-28-R13: in strict mode a result marked gate is fatal at capacity 0; in normal mode it is left as it was."""
        c = conf(scheduled=[{"id": "g"}])
        r = {"g": sy.R("recovers", 0.95, True, False, "e", gate=True, date=(TODAY + dt.timedelta(days=30)).isoformat())}
        self.assertEqual([(e[3]["mode"], e[3]["capacity"], e[3]["recover"]) for e in sy.events(c, r, random.Random(1), TODAY, strict=True)], [("fatal", 0.0, False)])
        self.assertEqual([(e[3]["mode"], e[3]["capacity"]) for e in sy.events(c, r, random.Random(1), TODAY)], [("recovers", 0.95)])
        self.assertTrue(sy.one_year(c, r, "k", TODAY, strict=True)["died"])
        self.assertFalse(sy.one_year(c, r, "k", TODAY)["died"])

    def test_us_28_r14_sensitivity_ranks_the_faults_that_move_the_horizon(self):
        """US-28-R14: each fault's rate is halved and doubled with the rest held; faults are ranked by the largest change in survive_year, ties by id."""
        c = conf(fault("b", rate=6), fault("dies", rate=6), fault("a", rate=6))
        res = {"dies": sy.R("degrades", 0.0, False, True, "e"), "a": sy.R("recovers", 0.9, True, True, "e"), "b": sy.R("recovers", 0.9, True, True, "e")}
        s = sy.sensitivity(c, res, TODAY, runs=30)
        self.assertEqual([r["id"] for r in s["ranked"]], ["dies", "a", "b"])
        self.assertEqual(set(s["ranked"][0]["effect"]), {"0.5", "2.0"})
        self.assertEqual(s["ranked"][0]["swing"], max(abs(e["d_survive"]) for e in s["ranked"][0]["effect"].values()))
        self.assertEqual((s["ranked"][1]["swing"], s["ranked"][2]["swing"], s["runs"]), (0.0, 0.0, 30))
        self.assertEqual(set(s["base"]), {"survive_year", "p10"})

    def test_us_28_r15_the_published_record_is_met_by_the_normal_tenth_percentile(self):
        """US-28-R15: the record holds the normal and strict horizons, the sensitivity, every drill and the observed series used; meets_target is p10 >= target_days; nothing is written without apply."""
        root = scratch()
        write(root, sy.CONF, conf(fault("a", drill=OK_DRILL), fault("b", drill=OK_DRILL)))
        rec = sy.run(root, apply=False, today=TODAY, runs=10)
        self.assertTrue(rec["meets_target"] and rec["horizon"]["p10"] >= 365)
        for k in ("at", "target_days", "runs", "horizon", "strict", "sensitivity", "drills", "rates_observed"):
            self.assertIn(k, rec)
        self.assertFalse((root / sy.LATEST).exists())
        sy.run(root, apply=True, today=TODAY, runs=10)
        self.assertEqual(json.loads((root / sy.LATEST).read_text(encoding="utf-8"))["target_days"], 365)
        write(root, sy.CONF, conf(fault("a", rate=365, drill=BAD_DRILL)))
        self.assertFalse(sy.run(root, today=TODAY, runs=10)["meets_target"])

    def test_us_28_r16_an_observed_rate_replaces_an_assumed_one_only_with_enough_events(self):
        """US-28-R16: with at least 3 observed events a fault that names rate_from takes the larger of the window rate and the recent rate, a trend clamped to [-0.5, 1.0] and an observed basis."""
        c = {"faults": [fault("m", rate=1, rate_from="conflict_merges"), fault("n", rate=5), fault("q", rate=2, rate_from="reverts"), fault("z", rate=3, rate_from="nothing")]}
        obs = {"conflict_merges": {"rate_year": 100, "recent_year": 150, "trend": 5.0, "events": 9, "days": 12},
               "reverts": {"rate_year": 100, "recent_year": 50, "trend": -2.0, "events": 3, "days": 12}, "nothing": {"rate_year": None, "events": 9}}
        out, used = sy.apply_observed(c, obs)
        f = {x["id"]: x for x in out["faults"]}
        self.assertEqual(used, ["m", "q"])
        self.assertEqual((f["m"]["rate_per_year"], f["m"]["growth"], f["q"]["rate_per_year"], f["q"]["growth"]), (150, 1.0, 100, -0.5))
        self.assertEqual(f["m"]["basis"], "observed: 9 events in 12 days of this system's own history (ops/trajectory.json conflict_merges), trend +5.00")
        self.assertEqual((f["n"]["rate_per_year"], f["z"]["rate_per_year"]), (5, 3))
        self.assertEqual(sy.apply_observed(c, {"conflict_merges": {**obs["conflict_merges"], "events": 2}})[1], [])
        root = scratch()
        write(root, sy.CONF, conf(fault("m", rate=1, drill=OK_DRILL, rate_from="conflict_merges")))
        write(root, "ops/trajectory.json", {"observed": obs})
        self.assertEqual(sy.run(root, today=TODAY, runs=5)["rates_observed"], ["m"])

    def test_us_28_r17_a_trend_bends_the_rate_over_the_simulated_year(self):
        """US-28-R17: a growing series brings more faults and a shrinking one fewer, at the same seed."""
        res = {"f": sy.R("recovers", 0.9, True, True, "e")}
        n = lambda **kw: len(sy.events(conf(fault("f", rate=20, **kw)), res, random.Random(1), TODAY))
        self.assertTrue(n(growth=1.0) > n() > n(growth=-0.5), (n(growth=1.0), n(), n(growth=-0.5)))

    def test_us_28_r18_the_release_horizon_is_zero_when_the_server_ships_nothing(self):
        """US-28-R18: a clone that does not reach back past the window is unmeasured, never zero; no substantive server-originated change is the finding self-release."""
        root = scratch()
        self.assertIsNone(fy.self_commits(root))  # not a git checkout: unmeasured
        self.assertIsNone(fy.self_rate(root))
        fs = fy.findings({}, {}, {"release_horizon_p10": 0, "self_rate_per_day": 0})
        self.assertEqual([f["id"] for f in fs], ["self-release"])
        self.assertEqual(fy.findings({}, {}, {"release_horizon_p10": None, "self_rate_per_day": None}), [])
        self.assertEqual(fy.SUBSTANTIVE_LINES, 10)


class PlatformRun(unittest.TestCase):
    def _root(self):
        root = scratch()
        write(root, "doctrine/yearsim.json", (REPO / "doctrine/yearsim.json").read_text(encoding="utf-8"))
        for d in ("docs/issues", "ops", "site"):
            (root / d).mkdir(parents=True, exist_ok=True)
        return root

    def _results(self, bad=None, **over):
        c = json.loads((REPO / "doctrine/yearsim.json").read_text(encoding="utf-8"))
        rs = {f["id"]: fy.R("recovers", 0.9, True, True, "ok") for f in c["faults"]}
        rs["node-eol"] = fy.R("recovers", 0.95, True, True, "pins", date=over.get("node_date", "2029-01-01"))
        if bad:
            rs[bad] = fy.R("fatal", 0, False, True, "injected")
        return rs

    def test_us_28_r19_a_run_records_files_one_item_per_finding_and_closes_what_recovered(self):
        """US-28-R19: --apply writes the record, one ledger row and the page data, files Q-YEAR-SIM-<id> once, closes it with evidence when the class recovers, and flags a change."""
        root = self._root()
        flag = root / "changed"
        with mock.patch.object(fy, "drills", return_value=self._results(bad="ai-quota")):
            first = fy.run(root, apply=True, today=TODAY, now=NOW, runs=12, changed_file=str(flag))
        self.assertEqual([f["id"] for f in first["findings"]], ["ai-quota"])
        self.assertEqual(first["filed"], ["Q-YEAR-SIM-ai-quota"])
        self.assertTrue(flag.exists())
        self.assertEqual(len((root / "ops/yearsim.jsonl").read_text(encoding="utf-8").splitlines()), 1)
        self.assertTrue((root / fy.DATA).read_text(encoding="utf-8").startswith("// SPDX-License-Identifier"))
        item = root / "docs/issues/Q-YEAR-SIM-ai-quota.json"
        self.assertIn("python3 -m foundation yearsim --probe ai-quota", json.loads(item.read_text(encoding="utf-8"))["body"])
        flag.unlink()
        with mock.patch.object(fy, "drills", return_value=self._results(bad="ai-quota")):
            again = fy.run(root, apply=True, today=TODAY, now=NOW, runs=12, changed_file=str(flag))
        self.assertEqual(again["filed"], [])
        self.assertFalse(flag.exists())  # same day, same horizon, same findings: nothing changed
        with mock.patch.object(fy, "drills", return_value=self._results()):
            healed = fy.run(root, apply=True, today=TODAY, now=NOW, runs=12)
        self.assertEqual(healed["closed"], ["Q-YEAR-SIM-ai-quota"])
        body = json.loads(item.read_text(encoding="utf-8"))["body"]
        self.assertIn("**Status:** closed", body)
        self.assertIn("**Evidence:** year simulation at 2026-11-26T12:00:00Z", body)
        with mock.patch.object(fy, "drills", return_value=self._results(bad="ai-quota")):
            dry = fy.run(self._root(), apply=False, today=TODAY, now=NOW, runs=12)
        self.assertNotIn("filed", dry)

    def test_us_28_r20_the_closing_probe_of_an_item_is_its_drill(self):
        """US-28-R20: probe exits 0 only when the class's drill recovers and exercised code; an unknown class exits 2; self-release needs a non-zero server rate."""
        root = scratch()
        cases = {"good": fy.R("recovers", 0.9, True, True, "e"), "declared": fy.R("recovers", 0.9, True, False, "e"), "bad": fy.R("degrades", 0.5, False, True, "e")}
        with mock.patch.object(fy, "drills", side_effect=lambda r, today=None, only=None: {only: cases[only]} if only in cases else {}), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual([fy.probe(root, k) for k in ("good", "declared", "bad", "ghost")], [0, 1, 1, 2])
            with mock.patch.object(fy, "self_rate", return_value=0.5):
                self.assertEqual(fy.probe(root, "self-release"), 0)
            with mock.patch.object(fy, "self_rate", return_value=None):
                self.assertEqual(fy.probe(root, "self-release"), 1)

    def test_us_28_r21_a_runtime_that_leaves_maintenance_is_moved_ahead_of_its_date(self):
        """US-28-R21: workflow Node pins below node_lts are rewritten to it and higher ones are kept; an end-of-maintenance date inside node_warn_days files Q-YEAR-SIM-node-eol-upgrade."""
        self.assertEqual(fy.rewrite_node("node-version: 20\nnode-version: '26'\nnode-version: \"22\"", "24"), "node-version: 24\nnode-version: '26'\nnode-version: \"24\"")
        root = self._root()
        write(root, ".github/workflows/a.yml", "steps:\n  - uses: actions/setup-node@v4\n    with: {node-version: 22}\n")
        self.assertEqual(fy.node_pins(root), {"22": ["a.yml"]})
        self.assertEqual(fy.fix_node(root, apply=False), ["a.yml"])
        self.assertIn("node-version: 22", (root / ".github/workflows/a.yml").read_text(encoding="utf-8"))
        self.assertEqual(fy.fix_node(root, apply=True), ["a.yml"])
        self.assertEqual(fy.fix_node(root, apply=True), [])
        soon = (TODAY + dt.timedelta(days=100)).isoformat()
        with mock.patch.object(fy, "drills", return_value=self._results(node_date=soon)):
            r = fy.run(root, apply=True, today=TODAY, now=NOW, runs=5)
        self.assertIn("Q-YEAR-SIM-node-eol-upgrade", r["filed"])
        far = self._root()
        with mock.patch.object(fy, "drills", return_value=self._results(node_date=(TODAY + dt.timedelta(days=400)).isoformat())):
            self.assertNotIn("Q-YEAR-SIM-node-eol-upgrade", fy.run(far, apply=True, today=TODAY, now=NOW, runs=5)["filed"])


class _Resp:
    """A urlopen result that works both as a plain object (.read) and as a context manager."""
    def __init__(self, body=b"{}", status=200):
        self._b, self.status = body, status

    def read(self, *_):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _urlopen(seq):
    """A stand-in for urllib.request.urlopen answering from `seq` in order (the last answer repeats); an Exception in it is raised."""
    calls, seq = [], list(seq)

    def urlopen(req, timeout=None):
        calls.append(req)
        x = seq.pop(0) if len(seq) > 1 else seq[0]
        if isinstance(x, Exception):
            raise x
        return x
    return urlopen, calls


def _http(code, body=b"{}"):
    return urllib.error.HTTPError("https://x.example/health", code, "status", {}, io.BytesIO(body))


class BootYearGate(unittest.TestCase):
    def _gate(self, c):
        root = scratch()
        write(root, "scripts/yearsim.py", (SEED / "scripts/yearsim.py").read_text(encoding="utf-8"))
        write(root, sy.CONF, c)
        b = bs.Boot(root, root / "org", apply=False)
        return b, b.year_gate(), root

    def test_us_28_r22_the_year_gate_accepts_a_boot_only_when_drilled_and_above_target(self):
        """US-28-R22: blocked for an invalid register, a fault with no exercised drill, or a p10 below the target; ok otherwise; the record and the state hold the reading."""
        _, (st, why), _ = self._gate(conf(fault("a", drill=OK_DRILL), target_days=100))
        self.assertEqual(st, "blocked")
        self.assertTrue(why.startswith("autonomy/yearsim.json invalid:"), why)
        _, (st, why), _ = self._gate(conf(fault("a", drill=OK_DRILL), fault("undrilled")))
        self.assertEqual(st, "blocked")
        self.assertIn("fault(s) with no exercised drill: undrilled", why)
        _, (st, why), _ = self._gate(conf(fault("bad", rate=365, drill=BAD_DRILL)))
        self.assertEqual(st, "blocked")
        self.assertIn("< 365 days; failing drills: ['bad']", why)
        b, (st, why), root = self._gate(conf(fault("a", drill=OK_DRILL), fault("b", drill=OK_DRILL)))
        self.assertEqual((st, why), ("ok", "year gate: horizon p10 730 >= 365 days (20 simulated years)"))
        self.assertEqual(b.state["year"], {"p10": 730, "target_days": 365, "meets_target": True})
        rec = json.loads((root / "org/yearsim.json").read_text(encoding="utf-8"))
        self.assertEqual(sorted(rec), ["at", "drills", "horizon", "meets_target", "runs", "strict", "target_days"])

    def test_us_28_r23_a_boot_is_live_only_when_the_worker_answers_health_with_200(self):
        """US-28-R23: a dry run or a worker with no public route is degraded; with one, /health is polled every 10 s through 503 for 78 attempts and 200 is ok."""
        root = scratch()
        self.assertEqual(bs.Boot(root, root / "org", apply=False).verify_live(), ("degraded", "dry run: nothing deployed to probe"))
        off = bs.Boot(root, root / "org", apply=True)
        off.runtime = {"workers_dev": "false"}
        self.assertEqual(off.verify_live()[0], "degraded")
        sub = _Resp(b'{"result": {"subdomain": "sub"}}')
        on = bs.Boot(root, root / "org", apply=True)
        on.runtime = {"workers_dev": "true", "worker_name": "w"}
        sleeps = []
        opener, calls = _urlopen([sub, _http(503), _http(503), _Resp(b"ok", 200)])
        with mock.patch("urllib.request.urlopen", opener), mock.patch("time.sleep", sleeps.append):
            self.assertEqual(on.verify_live(), ("ok", "live: https://w.sub.workers.dev/health answered 200 (2 bytes)"))
        self.assertEqual((sleeps, calls[-1].full_url), ([10, 10], "https://w.sub.workers.dev/health"))
        sleeps.clear()
        opener, calls = _urlopen([sub, _http(503)])
        with mock.patch("urllib.request.urlopen", opener), mock.patch("time.sleep", sleeps.append):
            st, why = on.verify_live()
        self.assertEqual((st, len(sleeps), set(sleeps)), ("blocked", 78, {10}))
        self.assertIn("HTTP 503 (serving; no complete tick yet)", why)

    def test_us_28_r24_the_boot_ends_with_the_year_gate_and_the_live_probe_and_both_are_required(self):
        """US-28-R24: year_gate and verify_live are the last two stages, after start; an acceptance verdict needs both ok and a degraded stage is not ok."""
        import inspect, re
        names = re.findall(r'"(\w+)"', re.search(r"for name in \(([^)]*)\)", inspect.getsource(bs.main)).group(1))
        self.assertEqual(names[-3:], ["start", "year_gate", "verify_live"])
        self.assertEqual(seedlaunch.REQUIRED, ("read", "qualify", "write", "provision", "year_gate", "verify_live"))
        ok = [{"stage": s, "status": "ok"} for s in seedlaunch.REQUIRED]
        self.assertTrue(seedlaunch.verdict({"stages": ok})["passed"])
        for stage, status in (("verify_live", "degraded"), ("year_gate", "blocked")):
            v = seedlaunch.verdict({"stages": [{**s, "status": status} if s["stage"] == stage else s for s in ok]})
            self.assertFalse(v["passed"])
            self.assertIn(stage, v["failed_stages"])
        self.assertIn("year_gate", seedlaunch.verdict({"stages": []})["failed_stages"])


class SeedLaunchRecord(unittest.TestCase):
    def _ledger(self, rows):
        root = scratch()
        write(root, seedlaunch.LEDGER, "".join(json.dumps(r) + "\n" for r in rows))
        return root

    def test_us_28_r25_the_launch_ledger_must_hold_a_fresh_passing_end_to_end_proof(self):
        """US-28-R25: no proof, a failed one, one older than 8 days, or a failing fleet seed in the last 50 rows each fail the check."""
        at = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
        self.assertEqual(seedlaunch.check(scratch(), NOW), ["no e2e seed launch recorded (run seed-launch.yml)"])
        good = {"kind": "e2e", "at": at(NOW), "passed": True}
        self.assertEqual(seedlaunch.check(self._ledger([good]), NOW), [])
        self.assertTrue(any("latest e2e seed launch failed" in e for e in seedlaunch.check(self._ledger([{**good, "passed": False, "failed_stages": {"verify_live": "x"}}]), NOW)))
        old = {**good, "at": at(NOW - dt.timedelta(days=9))}
        self.assertEqual(seedlaunch.check(self._ledger([old]), NOW), ["latest e2e seed launch is 9 days old (> 8)"])
        self.assertEqual(seedlaunch.check(self._ledger([old]), NOW, max_age_days=10), [])
        fleet = {"kind": "fleet", "repo": "o/seed-a", "passed": False, "failed_stages": {"clone": "x"}}
        self.assertEqual(seedlaunch.check(self._ledger([good, fleet]), NOW), ["seed o/seed-a failed: ['clone']"])
        self.assertEqual(seedlaunch.MAX_AGE_DAYS, 8)

    def test_us_28_r26_a_seed_is_launched_only_into_the_required_account_and_passes_only_with_a_year(self):
        """US-28-R26: another Cloudflare account is refused; an OIDC launch passes only with no failed stage and a year p10 of at least 365."""
        with mock.patch.dict(os.environ, {"CLOUDFLARE_ACCOUNT_ID": "0" * 32}):
            r = seedlaunch.launch(Path("/nonexistent"), "e2e")
        self.assertFalse(r["passed"])
        self.assertIn("account", r["failed_stages"])
        row = lambda p10: {"kind": "seed", "slug": "s", "url": "https://x", "year_p10": p10, "uploaded": True, "live_ok": True}

        def e2e(row_, cold=lambda u: [{"capability": "frontend", "path": "/", "ok": True, "why": ""}]):
            root = scratch()
            write(root, "ops/deploys.jsonl", json.dumps(row_) + "\n")
            return seedlaunch.e2e_oidc(root=root, run=lambda a: (0, "OK"), sleep=lambda s: None, coldstart_live=cold)
        self.assertTrue(e2e(row(730))["passed"])
        self.assertFalse(e2e(row(100))["passed"])
        self.assertFalse(e2e(row(None))["passed"])
        miss = e2e(row(730), lambda u: [{"capability": "discoverable", "path": "/.well-known/ultrastable.json", "ok": False, "why": "404"}])
        self.assertFalse(miss["passed"])
        self.assertIn("/.well-known/ultrastable.json", miss["failed_stages"]["coldstart"])


def kit(**over):
    k = {"version": "1.0.0", "target_days": 365, "max_age_days": 8, "required_faults": ["f1"],
         "components": [{"id": "c", "what": "w", "files": ["a.txt"], "probe": [PY, "-c", "pass"], "covers": ["f1"]}]}
    k.update(over)
    return k


class SeedAdmission(unittest.TestCase):
    def _system(self, faults=None, **kit_over):
        root = scratch()
        write(root, "a.txt", "x")
        write(root, sa.KIT, kit(**kit_over))
        write(root, sy.CONF, conf(*(fault("f1", drill=OK_DRILL),) if faults is None else faults))
        return root

    def test_us_28_r27_the_kit_is_data_and_is_checked_against_the_seed(self):
        """US-28-R27: target_days is never below 365, component ids are unique, every required fault is covered, every file and probe test exists."""
        self.assertEqual(sa.check(SEED), [])
        src = scratch()
        self.assertTrue(sa.check(src)[0].startswith("kit unreadable"))
        write(src, sa.KIT, kit(target_days=100, required_faults=["z"], components=[
            {"id": "a", "files": ["x.txt"], "probe": ["worker/test/x.test.js"], "covers": []}, {"id": "a", "files": [], "probe": [PY], "covers": []}]))
        errs = "\n".join(sa.check(src))
        for want in ("target_days is never below 365", "duplicate component id", "required fault z is covered by no component", "a: x.txt does not exist in the seed",
                     "a: probe test worker/test/x.test.js does not exist"):
            self.assertIn(want, errs)

    def test_us_28_r28_a_component_counts_only_with_its_files_a_green_probe_and_no_import_out_of_the_system(self):
        """US-28-R28: a component is ok when every file is present and its probe exits 0; self-contained fails on a relative import that leaves the system, except the generated config."""
        root = scratch()
        write(root, "a.txt", "x")
        k = kit(components=[{"id": "ok", "files": ["a.txt"], "probe": [PY, "-c", "pass"], "covers": []}, {"id": "missing", "files": ["a.txt", "m.txt"], "probe": [PY, "-c", "pass"], "covers": []},
                            {"id": "red", "files": ["a.txt"], "probe": drill("print('boom'); raise SystemExit(1)"), "covers": []}])
        a = sa.audit(root, k)
        self.assertEqual((a["ok"]["ok"], a["missing"]["ok"], a["red"]["ok"]), (True, False, False))
        self.assertEqual((a["missing"]["missing"], a["missing"]["evidence"], a["red"]["evidence"]), (["m.txt"], "missing: m.txt", "boom"))
        self.assertEqual(sa.audit(root, k, probes=False)["red"], {"ok": True, "evidence": "files present", "missing": []})
        self.assertTrue(a["self-contained"]["ok"])
        write(root, "worker/src/b.js", "export const b = 1;")
        write(root, "worker/src/a.js", "import { b } from './b.js';\nimport cfg from './config.js';\nimport leak from '../../../site/x.js';\n")
        self.assertEqual(sa.escapes(root), ["worker/src/a.js imports ../../../site/x.js, which is not in the system"])
        self.assertFalse(sa.audit(root, k, probes=False)["self-contained"]["ok"])

    def test_us_28_r29_wiring_a_system_is_additive_and_idempotent(self):
        """US-28-R29: wire copies what the kit names and the system lacks, installs the workflow from its template, never overwrites, and lists what the source does not hold."""
        src, dst = scratch(), scratch()
        k = kit(components=[{"id": "c", "files": ["a.txt", ".github/workflows/autonomy.yml", "gone.txt"], "probe": [PY], "covers": [], "template": {"from": "autonomy-kit/w.yml"}}])
        write(src, sa.KIT, k)
        write(src, "a.txt", "from the kit")
        write(src, "autonomy-kit/w.yml", "name: autonomy\n")
        write(dst, "a.txt", "mine")
        first = sa.wire(dst, src, k)
        self.assertEqual((first["added"], first["absent"]), ([sa.KIT, ".github/workflows/autonomy.yml"], ["gone.txt"]))
        self.assertEqual((dst / "a.txt").read_text(encoding="utf-8"), "mine")
        self.assertEqual((dst / ".github/workflows/autonomy.yml").read_text(encoding="utf-8"), "name: autonomy\n")
        self.assertEqual(sa.wire(dst, src, k)["added"], [])

    def test_us_28_r30_admission_needs_every_component_every_required_drill_and_a_year_at_the_target(self):
        """US-28-R30: admitted only when components are green, required faults are declared with exercised drills that recover and p10 (normal and strict) reaches the kit target; else held with each reason."""
        ok = sa.admit(self._system(), slug="x", today=TODAY, runs=10)
        self.assertEqual((ok["status"], ok["reasons"], ok["components"]), ("admitted", [], {"c": True, "self-contained": True}))
        self.assertEqual((ok["year"]["p10"], ok["year"]["strict_p10"], ok["kit_version"], ok["slug"]), (730, 730, "1.0.0", "x"))
        life = dt.datetime.fromisoformat(ok["expires"].replace("Z", "+00:00")) - dt.datetime.fromisoformat(ok["at"].replace("Z", "+00:00"))
        self.assertEqual(life, dt.timedelta(days=8))
        self.assertEqual(len(ok["yearsim_config_sha"]), 16)
        held = lambda **kw: sa.admit(self._system(**kw), slug="x", today=TODAY, runs=10)
        r = held(faults=[fault("other", drill=OK_DRILL)])
        self.assertEqual(r["status"], "held")
        self.assertIn("required fault f1 is not declared", r["reasons"])
        self.assertIn("fault f1 has no drill: declared, not exercised", held(faults=[fault("f1")])["reasons"])
        r = held(faults=[fault("f1", rate=365, drill=BAD_DRILL)])
        self.assertTrue(any(x.startswith("drill f1 did not recover: boom") for x in r["reasons"]))
        self.assertTrue(any("year simulation p10" in x and "is below 365" in x for x in r["reasons"]))
        self.assertTrue(any(x.startswith("strict year simulation p10") for x in r["reasons"]))
        self.assertIn("target_days 365 is below the kit minimum 400", held(target_days=400)["reasons"])
        root = self._system()
        (root / "a.txt").unlink()
        self.assertTrue(any(x.startswith("c: missing: a.txt") for x in sa.admit(root, slug="x", today=TODAY, runs=10)["reasons"]))
        self.assertFalse((root / sa.RECORD).exists())  # nothing is written without apply
        applied = self._system()
        sa.admit(applied, slug="x", apply=True, today=TODAY, runs=10)
        self.assertEqual(json.loads((applied / sa.RECORD).read_text(encoding="utf-8"))["status"], "admitted")

    def test_us_28_r31_an_admission_expires_and_only_a_fresh_admitted_record_counts_as_launched(self):
        """US-28-R31: a record is fresh while status is admitted and expires is in the future; the platform reads it from instances/<slug>/admission.json."""
        rec = {"status": "admitted", "expires": "2026-12-01T00:00:00Z"}
        self.assertTrue(sa.fresh(rec, NOW))
        self.assertFalse(sa.fresh({**rec, "expires": "2026-11-26T11:00:00Z"}, NOW))
        self.assertFalse(sa.fresh({**rec, "status": "held"}, NOW))
        self.assertFalse(sa.fresh({"status": "admitted"}, NOW))
        self.assertFalse(sa.fresh({"status": "admitted", "expires": "soon"}, NOW))
        root = scratch()
        self.assertFalse(fa.launched(root, "x", NOW))
        write(root, "instances/x/admission.json", rec)
        self.assertTrue(fa.launched(root, "x", NOW))
        write(root, "instances/x/admission.json", {**rec, "expires": "2020-01-01T00:00:00Z"})
        self.assertFalse(fa.launched(root, "x", NOW))

    def test_us_28_r32_the_autonomy_workflow_carries_its_budget_its_guards_and_no_new_credential(self):
        """US-28-R32: the workflow needs the budget, trigger and free-alternative headers, a timeout, a concurrency group and the HALT guard, and may use only the built-in token."""
        self.assertEqual(sa.workflow_check(SEED), [])
        root = scratch()
        write(root, ".github/workflows/autonomy.yml", "name: x\n")
        errs = sa.workflow_check(root)
        for w in ("budget header", "trigger header", "free-alternative header", "timeout", "concurrency group", "HALT guard"):
            self.assertIn(f"autonomy workflow lacks {w}", errs)
        good = (SEED / "autonomy-kit/autonomy.workflow.yml").read_text(encoding="utf-8")
        write(root, ".github/workflows/autonomy.yml", good + "\n      - run: echo ${{ secrets.GITHUB_TOKEN }} ${{ secrets.DEPLOY_KEY }}\n")
        self.assertEqual(sa.workflow_check(root), ["autonomy workflow uses secrets.DEPLOY_KEY (only the built-in token is allowed)"])

    def test_us_28_r33_the_platform_refuses_a_launched_seed_without_a_fresh_admission(self):
        """US-28-R33: instance.json status launched needs a fresh admitted record, an admitted record may not carry reasons, and the generator must wire and admit."""
        engine = types.SimpleNamespace(check=lambda src: [], workflow_check=lambda src: [], fresh=sa.fresh)
        root = scratch()
        write(root, "foundation/scaffold.py", "from . import seedadmit\n")
        write(root, "instances/x/instance.json", {"slug": "x", "status": "launched"})
        with mock.patch.object(fa, "_engine", return_value=engine):
            self.assertEqual(fa.check(root), ["x: status launched without a fresh admitted record at instances/x/admission.json"])
            write(root, "instances/x/admission.json", {"status": "admitted", "expires": "2999-01-01T00:00:00Z", "reasons": []})
            self.assertEqual(fa.check(root), [])
            write(root, "instances/x/admission.json", {"status": "admitted", "expires": "2999-01-01T00:00:00Z", "reasons": ["drill x"]})
            self.assertTrue(any("admitted with open reasons" in e for e in fa.check(root)))
            write(root, "foundation/scaffold.py", "pass\n")
            self.assertIn("foundation/scaffold.py does not wire and admit a new system (SEED-ADMIT-1)", fa.check(root))


LC_CFG = {"target_days": 365, "verify_max_age_hours": 48, "verify_ledger": "ops/seeds/{slug}.jsonl", "topology": "autonomy/topology.json", "clocks": "autonomy/clocks.json",
          "progress": "autonomy/progress.json", "seed_deploys": "autonomy/seed-deploys.json", "survival": [{"id": "health", "what": "w"}, {"id": "privacy", "what": "w"}]}
IDEA = "---\nslug: s1\n---\n\n# Idea\n\nA tracker that keeps running.\n\n# System test\n\n- Loop: x\n"


def iso(d):
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


class SeedLifecycle(unittest.TestCase):
    def setUp(self):
        self.root = scratch()
        write(self.root, "IDEA.md", IDEA)
        write(self.root, "instance.json", {"slug": "s1"})
        write(self.root, "app.js", "export default {}")
        write(self.root, "app.test.js", "")
        self.lc = {"slug": "s1", "build": {"paths": [], "tests": []}, "deploy": {"worker": ""}, "verify": {"url": "", "expect": ""}, "loops": [],
                   "survival": {"health": {"status": "closed", "probe": "file:app.js"}, "privacy": {"status": "n/a", "why": "no personal data is stored"}}}
        self.save()

    def save(self):
        write(self.root, "autonomy/lifecycle.json", self.lc)

    def stage(self, core=None, now=NOW):
        return sl.evaluate(self.root, self.root, self.root / "autonomy/lifecycle.json", LC_CFG, core or {}, now)

    def build(self):
        self.lc["build"] = {"paths": ["app.js"], "tests": ["app.test.js"]}
        self.save()

    def deploy(self, **row):
        self.build()
        self.lc["deploy"] = {"worker": "s1-app"}
        self.save()
        write(self.root, "ops/deploys.jsonl", json.dumps({"worker": "s1-app", "uploaded": True, "live_matches_commit": True, **row}) + "\n")

    def live(self, age_h=0, ok=True):
        self.deploy()
        self.lc["verify"] = {"url": "https://s1.example/health", "expect": "ok"}
        self.save()
        sl.record_verify(self.root, LC_CFG, "s1", {"at": iso(NOW - dt.timedelta(hours=age_h)), "ok": ok})

    def autonomous(self):
        self.live()
        self.lc["loops"] = ["watchdog"]
        self.save()
        write(self.root, "autonomy/topology.json", {"workers": [{"id": "s1-app", "state": "live"}]})
        write(self.root, "autonomy/clocks.json", {"clocks": [{"id": "watchdog"}]})
        write(self.root, "autonomy/progress.json", {"systems": [{"id": "s1"}]})

    def test_us_28_r34_a_stage_is_reached_only_by_evidence(self):
        """US-28-R34: no seed without IDEA.md and instance.json; then seeded, planned, built, deployed, live and autonomous, each only with the evidence the next stage names."""
        (self.root / "IDEA.md").unlink()
        r = self.stage()
        self.assertEqual((r["stage"], r["next"], r["need"]), (None, "seeded", ["IDEA.md and instance.json"]))
        write(self.root, "IDEA.md", "---\nslug: s1\n---\n# Idea\n")
        (self.root / "autonomy/lifecycle.json").unlink()
        r = self.stage()
        self.assertEqual((r["stage"], r["next"]), ("seeded", "planned"))
        self.assertEqual(r["need"], ["IDEA.md has a '# System test' section", "autonomy/lifecycle.json exists"])
        write(self.root, "IDEA.md", IDEA)
        self.save()
        r = self.stage()
        self.assertEqual((r["stage"], r["next"]), ("planned", "built"))
        self.assertIn("(none named)", r["need"][0])
        self.lc["build"] = {"paths": ["app.js", "nope.js"], "tests": ["app.test.js"]}
        self.save()
        self.assertIn("(missing: nope.js)", self.stage()["need"][0])
        self.build()
        r = self.stage()
        self.assertEqual((r["stage"], r["next"]), ("built", "deployed"))
        self.deploy(live_matches_commit=False)
        self.assertEqual(self.stage()["stage"], "built")  # a deploy that did not match the commit is not a deploy
        self.deploy(uploaded=False)
        self.assertEqual(self.stage()["stage"], "built")
        self.deploy()
        r = self.stage()
        self.assertEqual((r["stage"], r["next"]), ("deployed", "live"))
        self.live(age_h=49)
        self.assertEqual(self.stage()["stage"], "deployed")  # a reading older than 48 h is not live
        self.live(ok=False)
        self.assertEqual(self.stage()["stage"], "deployed")
        self.live(age_h=48)
        r = self.stage()
        self.assertEqual((r["stage"], r["next"]), ("live", "autonomous"))
        self.autonomous()
        r = self.stage()
        self.assertEqual((r["stage"], r["next"], r["need"]), ("autonomous", None, []))

    def test_us_28_r35_every_survival_class_is_answered_inherited_or_open(self):
        """US-28-R35: an unanswered class is open, an inherited one takes the core input's status and says so, an unknown core input is open, an own answer is kept."""
        core = {"offsite-backup": {"status": "gate", "expires": "2027-03-01", "item": None}}
        lc = {"survival": {"health": {"status": "closed", "probe": "file:x"}, "backups": {"inherit": "offsite-backup"}, "payment": {"inherit": "ghost"}}}
        cfg = {"survival": [{"id": "health"}, {"id": "privacy"}, {"id": "backups"}, {"id": "payment"}]}
        s = sl.survival(lc, cfg, core)
        self.assertEqual((s["health"]["status"], s["health"]["via"]), ("closed", "file:x"))
        self.assertEqual((s["privacy"]["status"], s["privacy"]["via"]), ("open", "unanswered"))
        self.assertEqual((s["backups"]["status"], s["backups"]["via"], s["backups"]["expires"]), ("gate", "core:offsite-backup", "2027-03-01"))
        self.assertEqual((s["payment"]["status"], s["payment"]["via"]), ("open", "core:ghost (unknown)"))

    def test_us_28_r36_autonomous_needs_the_lane_the_clocks_the_cadence_and_no_open_class(self):
        """US-28-R36: the lane owns the worker (topology live or the seed deploy list), every loop is a clock, the progress list names the seed, no class is open and no gate lapses inside the target."""
        self.autonomous()
        self.assertEqual(self.stage()["stage"], "autonomous")
        write(self.root, "autonomy/topology.json", {"workers": []})
        self.assertEqual(self.stage()["stage"], "live")
        write(self.root, "autonomy/seed-deploys.json", {"seeds": ["s1"]})
        self.assertEqual(self.stage()["stage"], "autonomous")
        self.lc["loops"] = ["watchdog", "ghost"]
        self.save()
        r = self.stage()
        self.assertEqual(r["stage"], "live")
        self.assertIn("missing: ghost", r["need"][0])
        self.lc["loops"] = []
        self.save()
        self.assertEqual(self.stage()["stage"], "live")
        self.lc["loops"] = ["watchdog"]
        self.save()
        write(self.root, "autonomy/progress.json", {"systems": []})
        self.assertEqual(self.stage()["stage"], "live")
        write(self.root, "autonomy/progress.json", {"systems": [{"id": "s1"}]})
        self.lc["survival"]["privacy"] = {"status": "open", "item": "Q-SEED-s1"}
        self.save()
        r = self.stage()
        self.assertEqual((r["stage"], r["open"]), ("live", ["privacy"]))
        self.lc["survival"]["privacy"] = {"inherit": "payment-method"}
        self.save()
        gate = {"payment-method": {"status": "gate", "expires": None}}
        r = self.stage(gate)
        self.assertEqual((r["stage"], r["gates"], r["horizon_days"]), ("autonomous", ["privacy"], None))  # an honest gate does not hold the stage
        gate["payment-method"]["expires"] = "2027-03-01"
        r = self.stage(gate)
        self.assertEqual((r["stage"], r["horizon_days"]), ("live", 95))  # but one that lapses inside the 365-day target does

    def test_us_28_r37_a_seed_is_never_reported_further_along_than_its_evidence(self):
        """US-28-R37: a claim above the evidence, a done-looking manifest status on a seed that is not autonomous, and a progress listing before a deploy are each a failure."""
        r = {"slug": "s1", "stage": "built"}
        self.assertEqual(sl.false_claims(r, {"claim": "built"}, {"status": "planned"}, False), [])
        self.assertIn("lifecycle claims live but the evidence reaches built", sl.false_claims(r, {"claim": "live"}, None, False)[0])
        for word in ("done", "complete", "completed", "launched", "autonomous", "live", "shipped"):
            self.assertTrue(sl.false_claims(r, None, {"status": word.upper()}, False), word)
        self.assertEqual(sl.false_claims({"slug": "s1", "stage": "autonomous"}, None, {"status": "launched"}, True), [])
        self.assertIn("nothing of it is deployed", sl.false_claims(r, None, None, True)[0])
        self.assertEqual(sl.false_claims({"slug": "s1", "stage": "deployed"}, None, None, True), [])
        self.assertIn("claim 'done' is not a stage", sl.check_lifecycle(self.root, {"claim": "done"}, LC_CFG, {}, "w")[0])

    def test_us_28_r38_an_answer_is_valid_only_with_its_proof(self):
        """US-28-R38: closed needs a probe that resolves, n/a a reason of 12 characters, a gate a default, an https link and a why, open a queue item; unknown classes and unknown inputs fail."""
        write(self.root, "foundation/seedlife.py", "")
        self.assertTrue(sl.resolves(self.root, "file:app.js") and not sl.resolves(self.root, "file:nope") and not sl.resolves(self.root, "file:"))
        self.assertTrue(sl.resolves(self.root, "cmd:python3 -m foundation seedlife --verify") and not sl.resolves(self.root, "cmd:python3 -m foundation nothing"))
        self.assertTrue(sl.resolves(self.root, "cmd:python3 app.js") is False and sl.resolves(self.root, "cmd:node --test app.test.js"))
        self.assertFalse(sl.resolves(self.root, "cmd:node --test app.test.js nope.test.js"))
        self.assertFalse(sl.resolves(self.root, "http://x"))
        bad = lambda survival, **kw: "\n".join(sl.check_lifecycle(self.root, {"survival": survival, **kw}, LC_CFG, {"core-1": {}}, "w"))
        self.assertEqual(bad({"health": {"status": "closed", "probe": "file:app.js"}, "privacy": {"status": "n/a", "why": "a sufficient reason"}}), "")
        self.assertIn("health is closed but its probe `file:nope` does not resolve", bad({"health": {"status": "closed", "probe": "file:nope"}}))
        self.assertIn("privacy is n/a and needs a reason", bad({"privacy": {"status": "n/a", "why": "short"}}))
        self.assertIn("health is a gate and needs why", bad({"health": {"status": "gate", "default": "d", "connect": "http://insecure", "why": "w"}}))
        self.assertEqual(bad({"health": {"status": "gate", "default": "d", "connect": "https://x.example/c", "why": "identity-bound"}}), "")
        self.assertIn("health is open and needs a queue item", bad({"health": {"status": "open"}}))
        self.assertIn("health needs a status in", bad({"health": {"status": "maybe"}}))
        self.assertIn("unknown survival class bogus", bad({"bogus": {"status": "open", "item": "x"}}))
        self.assertIn("health inherits ghost, which is not a core input", bad({"health": {"inherit": "ghost"}}))
        self.assertEqual(bad({"health": {"inherit": "core-1"}}), "")

    def test_us_28_r39_verify_readings_are_kept_thirty_to_a_seed(self):
        """US-28-R39: a reading goes to one JSONL file per seed or to a key per seed in one JSON store, which keeps the newest 30."""
        store = {**LC_CFG, "verify_store": "ops/runway.json", "verify_key": "seed_verify"}
        for i in range(35):
            sl.record_verify(self.root, store, "s1", {"at": f"t{i}", "ok": True})
        sl.record_verify(self.root, store, "s2", {"at": "other", "ok": False})
        rows = sl.verify_rows(self.root, store, "s1")
        self.assertEqual((len(rows), rows[0]["at"], rows[-1]["at"]), (30, "t5", "t34"))
        self.assertEqual(sl.verify_rows(self.root, store, "s2"), [{"at": "other", "ok": False}])
        sl.record_verify(self.root, LC_CFG, "s1", {"at": "a", "ok": True})
        sl.record_verify(self.root, LC_CFG, "s1", {"at": "b", "ok": False})
        self.assertEqual([r["at"] for r in sl.verify_rows(self.root, LC_CFG, "s1")], ["a", "b"])
        self.assertEqual(sl.verify_rows(self.root, LC_CFG, "nobody"), [])

    def _platform(self):
        root = scratch()
        c = json.loads((REPO / "doctrine/seed-lifecycle.json").read_text(encoding="utf-8"))
        c["not_seeds"], c["fixtures"] = {"skipme": "a directory that is not a seed, with a long enough reason"}, {}
        write(root, fsl.RULES, c)
        write(root, "doctrine/unattended.json", {"dependencies": [{"id": x["default_inherit"], "status": "closed"} for x in c["survival"] if x.get("default_inherit")]})
        write(root, "foundation/seedlife.py", "")
        for s in ("s1", "skipme"):
            write(root, f"instances/{s}/IDEA.md", IDEA)
            write(root, f"instances/{s}/instance.json", {"slug": s})
        return root

    def test_us_28_r40_the_platform_files_one_item_per_seed_that_is_not_autonomous(self):
        """US-28-R40: declared non-seeds are skipped; --run scaffolds a lifecycle that inherits core answers, files Q-SEED-<slug> with its probe, never closes it while the seed is not autonomous, and the probe passes only when it is."""
        root = self._platform()
        self.assertEqual(fsl.seeds(root), ["s1"])
        r = fsl.run(root, apply=True, now=NOW, live=False)
        self.assertEqual([(s["slug"], s["stage"], s["next"]) for s in r["seeds"]], [("s1", "planned", "built")])
        lc = json.loads((root / "instances/s1/lifecycle.json").read_text(encoding="utf-8"))
        self.assertEqual(lc["survival"]["credentials"], {"inherit": "cloudflare-api-tokens"})
        self.assertEqual(lc["survival"]["health"]["status"], "closed")
        self.assertEqual(lc["survival"]["privacy"], {"status": "open", "item": "Q-SEED-s1"})
        item = json.loads((root / "docs/issues/Q-SEED-s1.json").read_text(encoding="utf-8"))
        self.assertIn("cmd:python3 -m foundation seedlife --probe s1", item["body"])
        self.assertIn("**Status:** open", item["body"])
        self.assertFalse(fsl.run(root, apply=True, now=NOW, live=False)["changed"])
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(fsl.probe("s1", root, NOW), 1)
        self.assertEqual(fsl.check(root, NOW), [])
        p = root / "docs/issues/Q-SEED-s1.json"
        p.write_text(json.dumps({**item, "body": item["body"].replace("**Status:** open", "**Status:** closed")}), encoding="utf-8")
        self.assertEqual(fsl.check(root, NOW), ["Q-SEED-s1: closed while the seed is planned; it closes only when --probe s1 passes"])
        p.write_text(json.dumps({**item, "body": item["body"].replace("**Status:** open", "**Status:** closed") + "\n**Disposition:** shelved (ttl)\n"}), encoding="utf-8")
        self.assertEqual(fsl.check(root, NOW), [])

    def test_us_28_r39_the_platform_fetches_each_seeds_url_and_records_the_reading_even_when_it_fails(self):
        """US-28-R39: a reading is {at, url, status, ok}; ok needs status 200 and the expect text; a failed fetch is a reading with the error; a dry verify records nothing."""
        root = self._platform()
        write(root, "instances/s1/lifecycle.json", {"slug": "s1", "verify": {"url": "https://s1.example/health", "expect": "ok"}})
        write(root, "instances/skipme/lifecycle.json", {"slug": "skipme", "verify": {"url": "http://insecure.example", "expect": "ok"}})
        good = fsl.verify(root, apply=False, fetch=lambda u: (200, "all ok"), now=NOW)
        self.assertEqual(good, [{"slug": "s1", "at": "2026-11-26T12:00:00Z", "url": "https://s1.example/health", "status": 200, "ok": True}])
        self.assertFalse((root / "ops/runway.json").exists())
        self.assertFalse(fsl.verify(root, fetch=lambda u: (200, "no match"), now=NOW)[0]["ok"])
        self.assertFalse(fsl.verify(root, fetch=lambda u: (503, "ok"), now=NOW)[0]["ok"])
        down = fsl.verify(root, apply=True, fetch=mock.Mock(side_effect=OSError("refused")), now=NOW)[0]
        self.assertEqual((down["status"], down["ok"], down["error"]), (None, False, "refused"))
        fsl.verify(root, apply=True, fetch=lambda u: (200, "ok"), now=NOW)
        kept = json.loads((root / "ops/runway.json").read_text(encoding="utf-8"))["seed_verify"]["s1"]
        self.assertEqual([r["ok"] for r in kept], [False, True])
        self.assertEqual(sorted(json.loads((root / "ops/runway.json").read_text(encoding="utf-8"))["seed_verify"]), ["s1"])  # a non-seed is never fetched

    def test_us_28_r41_an_open_core_input_holds_every_seed_below_autonomous(self):
        """US-28-R41: a class that inherits an input the platform has not closed is open for every seed, so none is reported autonomous above it."""
        cfg = {**LC_CFG, "survival": [{"id": "backups"}]}
        self.autonomous()
        self.lc["survival"] = {"backups": {"inherit": "offsite-backup"}}
        self.save()
        run = lambda status: sl.evaluate(self.root, self.root, self.root / "autonomy/lifecycle.json", cfg, {"offsite-backup": {"status": status}}, NOW)
        self.assertEqual(run("closed")["stage"], "autonomous")
        held = run("open")
        self.assertEqual((held["stage"], held["open"]), ("live", ["backups"]))
        self.assertIn("survival class backups is open (core:offsite-backup)", held["need"][-1])


class SeedAutonomy(unittest.TestCase):
    def _root(self, at, seeds=("a",)):
        root = scratch()
        write(root, "doctrine/seed-deploys.json", {"seeds": list(seeds)})
        write(root, "ops/deploys.jsonl", json.dumps({"kind": "seed", "slug": "a", "live_ok": True, "url": "https://x.example", "at": at}) + "\n")
        return root

    def test_us_28_r42_a_deployed_seed_is_judged_on_the_stage_it_reads_for_itself(self):
        """US-28-R42: after a 48 h grace a seed below looping, with no reading, or that does not answer is an error naming what blocks it; a seed never deployed is left to seed-live."""
        now = dt.datetime(2026, 11, 30, tzinfo=dt.timezone.utc)
        old = self._root("2026-11-21T00:00:00Z")
        ticking = {"ok": True, "ignition": {"stage": "ticking", "blocking": {"stage": "looping", "why": "not ticking: executor (failing)"}}}
        errs = fa.autonomy(old, fetch=lambda u: ticking, now=now)
        self.assertEqual(len(errs), 1)
        self.assertIn("deployed 216 h ago and at stage ticking, below looping: not ticking: executor (failing)", errs[0])
        for stage in ("looping", "closing", "self-sustaining"):
            self.assertEqual(fa.autonomy(old, fetch=lambda u, s=stage: {"ignition": {"stage": s}}, now=now), [])
        self.assertIn("at stage unmeasured", fa.autonomy(old, fetch=lambda u: {"ok": True}, now=now)[0])
        boom = mock.Mock(side_effect=OSError("refused"))
        self.assertIn("/health did not answer: refused", fa.autonomy(old, fetch=boom, now=now)[0])
        self.assertEqual(fa.autonomy(self._root("2026-11-29T12:00:00Z"), fetch=boom, now=now), [])
        self.assertEqual(fa.autonomy(self._root("2026-11-01T00:00:00Z", seeds=["never-deployed"]), fetch=boom, now=now), [])
        self.assertEqual(fa.AUTONOMY_GRACE_HOURS, 48)

    def test_us_28_r42_the_stage_comes_from_health_or_from_its_tick_report(self):
        """US-28-R42: the structured ignition field wins, a worker without it is read from its last tick report, and a 503 with a JSON body is a reading that names its client."""
        self.assertEqual(fa.stage_of({"ignition": {"stage": "closing"}}), ("closing", ""))
        rep = "Happened: tick 2 ran; ignition: stage ticking; next looping blocked: not ticking: lane (failing)"
        self.assertEqual(fa.stage_of({"last_tick": {"report": rep}}), ("ticking", "not ticking: lane (failing)"))
        self.assertEqual(fa.stage_of({"ignition": {"stage": "bogus"}}), (None, "no ignition reading in /health"))
        self.assertEqual(fa.STAGES, ("unseeded", "seeded", "ticking", "looping", "closing", "instrumented", "critical", "self-sustaining"))
        opener, calls = _urlopen([_Resp(b'{"ok": true}')])
        with mock.patch("urllib.request.urlopen", opener):
            self.assertEqual(fa._health("https://x.example"), {"ok": True})
        self.assertEqual((calls[0].full_url, calls[0].get_header("User-agent")), ("https://x.example/health", "ultrastable-seedadmit"))
        body = b'{"ok": false, "ignition": {"stage": "ticking"}}'
        opener, _ = _urlopen([_http(503, body)])
        with mock.patch("urllib.request.urlopen", opener):
            self.assertEqual(fa._health("https://x.example", allow_503=True)["ignition"]["stage"], "ticking")
            with self.assertRaises(urllib.error.HTTPError):
                fa._health("https://x.example")

    def test_us_28_r43_a_standing_seed_needs_a_verified_deploy_and_an_answering_health(self):
        """US-28-R43: every seed in doctrine/seed-deploys.json has a live-verified deploy row in ops/deploys.jsonl and a /health that answers JSON now."""
        root = scratch()
        write(root, "doctrine/seed-deploys.json", {"seeds": ["a", "b"]})
        write(root, "ops/deploys.jsonl", "".join(json.dumps(r) + "\n" for r in (
            {"kind": "seed", "slug": "a", "live_ok": True, "url": "https://a.example"}, {"kind": "seed", "slug": "b", "live_ok": False, "url": "https://b.example"})) + "not json\n")
        errs = fa.live(root, fetch=lambda u: {"ok": True})
        self.assertEqual(errs, ["b: no live-verified seed deploy recorded in ops/deploys.jsonl"])
        down = mock.Mock(side_effect=OSError("refused"))
        self.assertIn("a: https://a.example/health did not answer: refused", fa.live(root, fetch=down))


D20 = dt.date(2026, 11, 20)
COST_SHARES = lambda a, b: [{"ts": "2026-11-09T00:00:00Z", "d1": [{"name": "x", "rows_read": a}]}, {"ts": "2026-11-19T00:00:00Z", "d1": [{"name": "x", "rows_read": b}]}]
CALM_COST = [{"ts": "2026-11-19T00:00:00Z", "d1": [{"name": "x", "rows_read": 100}], "neurons": 5}]
CALM_CRED = [{"name": "T", "state": "ok", "expires": None}, {"name": "domain-a", "state": "ok", "expires": "2027-01-01"}, {"name": "U", "state": "unbound", "expires": None}]


class Runway(unittest.TestCase):
    def tree(self, cost=CALM_COST, cred=CALM_CRED, issues=()):
        root = scratch()
        write(root, "doctrine/runway.json", (REPO / "doctrine/runway.json").read_text(encoding="utf-8"))
        write(root, "doctrine/credwatch.json", {"registrations": [{"name": "domain-a", "auto_renew": True}]})
        write(root, "ops/cost-thresholds.json", {"rows_read_max": 1000, "neurons_max": 100})
        if cost is not None:
            write(root, "ops/cost.jsonl", "".join(json.dumps(x) + "\n" for x in cost))
        if cred is not None:
            write(root, "ops/credwatch.json", {"rows": cred})
        (root / "docs/issues").mkdir(parents=True)
        for iid, labels, status in issues:
            write(root, f"docs/issues/{iid}.json", {"id": iid, "body": f"**Status:** {status}\n", "labels": labels})
        return root

    def test_us_28_r44_the_runway_is_the_smallest_limit_found_and_none_means_no_limit(self):
        """US-28-R44: runway_days is the smallest whole-day component; with no limit it is None and the target is met; any component under target_days is below."""
        m = runway.measure(self.tree(), D20)
        self.assertEqual((m["runway_days"], m["meets_target"], m["below"], m["target_days"]), (None, True, [], 365))
        self.assertEqual(set(m["components"]), {"credentials", "cost", "failures"})
        m = runway.measure(self.tree(cost=COST_SHARES(100, 500), cred=[{"name": "T", "state": "ok", "expires": "2027-02-28"}]), D20)
        self.assertEqual((m["components"]["cost"]["days"], m["components"]["credentials"]["days"], m["runway_days"]), (12, 100, 12))
        self.assertEqual((m["meets_target"], m["below"]), (False, ["cost", "credentials"]))

    def test_us_28_r45_a_component_that_cannot_be_measured_is_never_ok(self):
        """US-28-R45: no credential ledger, a cost reading older than 3 days, a reading that measured nothing, or no cost ledger is unmeasured, below the target and not a day count."""
        m = runway.measure(self.tree(cost=[{"ts": "2026-11-10T00:00:00Z", "d1": [{"name": "x", "rows_read": 1}]}], cred=None), D20)
        self.assertEqual((m["unmeasured"], m["below"], m["meets_target"], m["runway_days"]), (["cost", "credentials"], ["cost", "credentials"], False, None))
        self.assertIn("has not been written yet", m["components"]["credentials"]["why"])
        self.assertEqual(m["components"]["cost"]["why"], "last measured cost reading is 2026-11-10")
        nothing = runway.measure(self.tree(cost=[{"ts": "2026-11-19T00:00:00Z", "unmeasured": "no credential", "d1": []}]), D20)
        self.assertEqual(nothing["components"]["cost"], {"days": "unmeasured", "why": "last measured cost reading is absent"})
        root = self.tree()
        (root / "ops/cost.jsonl").unlink()
        self.assertEqual(runway.measure(root, D20)["components"]["cost"], {"days": "unmeasured", "why": "no cost ledger"})
        stale_ok = runway.measure(self.tree(cost=CALM_COST), dt.date(2026, 11, 22))  # three days is still inside the limit
        self.assertEqual(stale_ok["components"]["cost"]["days"], None)

    def test_us_28_r46_only_credentials_that_lapse_and_are_in_use_bound_the_runway(self):
        """US-28-R46: unbound, optional and auto-renewed registrations are skipped; invalid or expired is 0 days; otherwise days to the earliest expiry; a row that could not be probed is unmeasured."""
        c = lambda rows: runway.credentials(self.tree(cred=rows), D20)
        self.assertEqual(c(CALM_COST and [{"name": "T", "state": "ok", "expires": "2027-01-19"}, {"name": "V", "state": "ok", "expires": "2026-12-20"},
                                           {"name": "U", "state": "unbound", "expires": "2026-11-21"}, {"name": "domain-a", "state": "ok", "expires": "2026-11-22"},
                                           {"name": "O", "state": "ok", "expires": "2026-11-23", "optional": True}]), {"days": 30, "why": "V is ok, expires 2026-12-20"})
        self.assertEqual(c([{"name": "T", "state": "invalid", "expires": None}]), {"days": 0, "why": "T is invalid"})
        self.assertEqual(c([{"name": "T", "state": "expired", "expires": "2026-11-01"}])["days"], 0)
        self.assertEqual(c([{"name": "T", "state": "unmeasured"}]), {"days": "unmeasured", "why": "T could not be probed"})
        self.assertEqual(c([{"name": "T", "state": "ok", "expires": None}]), {"days": None, "why": "nothing that lapses"})

    def test_us_28_r47_cost_is_projected_from_the_measured_growth_toward_a_free_plan_limit(self):
        """US-28-R47: at or over a limit is 0 days; otherwise the days to 100 percent at the growth over the trend window; no growth is no limit; neurons count; an unmeasured reading is skipped."""
        cost = lambda rows, today=D20: runway.cost(self.tree(cost=rows), today, runway.cfg(self.tree()))
        over = cost([{"ts": "2026-11-19T00:00:00Z", "d1": [{"name": "x", "rows_read": 1500}]}])
        self.assertEqual((over["days"], over["share"], over["why"]), (0, 1.5, "a free-plan limit is at 150%"))
        grow = cost(COST_SHARES(100, 500))
        self.assertEqual((grow["days"], grow["share"]), (12, 0.5))
        self.assertIn("growing 4.00% a day", grow["why"])
        flat = cost(COST_SHARES(300, 300))
        self.assertEqual(flat["days"], None)
        self.assertTrue(flat["why"].endswith(", not growing"))
        self.assertEqual(cost([{"ts": "2026-11-19T00:00:00Z", "ai": {"neurons": 80}, "d1": [{"name": "x", "rows_read": 100}]}])["share"], 0.8)
        skip = cost([{"ts": "2026-11-19T00:00:00Z", "d1": [{"name": "x", "rows_read": 100}]}, {"ts": "2026-11-20T00:00:00Z", "unmeasured": "n/a", "d1": []}])
        self.assertEqual(skip["share"], 0.1)

    def test_us_28_r48_a_failure_item_nothing_repairs_ends_the_runway(self):
        """US-28-R48: open failure items (by id prefix or label) are aged from first sight; one open past max_failure_open_days (7) is 0 days; closed and unrelated items do not count."""
        root = self.tree(issues=[("Q-CIFAIL-a", [], "open"), ("Q-OTHER-b", [], "open"), ("Q-LAB", ["credential"], "open"), ("Q-CRED-c", [], "closed")])
        c = runway.cfg(root)
        late, seen = runway.failures(root, D20, c, {"Q-CIFAIL-a": "2026-11-10"})
        self.assertEqual(late, {"days": 0, "why": "Q-CIFAIL-a has been open 10 days", "open": 2})
        self.assertEqual(sorted(seen), ["Q-CIFAIL-a", "Q-LAB"])
        self.assertEqual(seen["Q-LAB"], "2026-11-20")  # first sighting is today
        edge, _ = runway.failures(root, D20, c, {"Q-CIFAIL-a": "2026-11-13"})
        self.assertEqual(edge, {"days": None, "why": "2 open, oldest 7 days", "open": 2})
        none, _ = runway.failures(self.tree(), D20, c, {})
        self.assertEqual(none, {"days": None, "why": "no open failure item", "open": 0})

    def test_us_28_r49_a_shortfall_files_one_item_whose_probe_is_the_same_measurement(self):
        """US-28-R49: --apply records ops/runway.json and files Q-RUNWAY-<component> once; the probe exits 0 only when the component is not below target; the watchdog pass also runs the compat and seed loops."""
        root = self.tree(cred=None)
        r = runway.run(root, apply=True, today=D20)
        self.assertEqual(r["below"], ["credentials"])
        self.assertTrue(r["changed"])
        item = root / "docs/issues/Q-RUNWAY-credentials.json"
        self.assertIn("cmd:python3 -m foundation runway --probe credentials", json.loads(item.read_text(encoding="utf-8"))["body"])
        item.write_text('{"id": "Q-RUNWAY-credentials", "edited": true}', encoding="utf-8")
        self.assertFalse(runway.run(root, apply=True, today=D20)["changed"])  # nothing new, the existing item is left alone
        self.assertIn("edited", item.read_text(encoding="utf-8"))
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(runway.probe("credentials", root), 1)
            write(root, "ops/credwatch.json", {"rows": CALM_CRED})
            runway.run(root, apply=True, today=D20)
            self.assertEqual(runway.probe("credentials", root), 0)
        self.assertFalse((self.tree() / "ops/runway.json").exists())
        dry = self.tree(cred=None)
        runway.run(dry, apply=False, today=D20)
        self.assertFalse((dry / "ops/runway.json").exists())
        keep = self.tree()
        write(keep, "ops/runway.json", {"seed_verify": {"s": [{"ok": True}]}})
        runway.run(keep, apply=True, today=D20)
        self.assertEqual(json.loads((keep / "ops/runway.json").read_text(encoding="utf-8"))["seed_verify"], {"s": [{"ok": True}]})
        with mock.patch.object(compatdate, "run", return_value={"changed": False}) as cd, mock.patch.object(fsl, "run", return_value={"changed": True}) as sd:
            self.assertTrue(runway.run(self.tree(), apply=False, today=D20, seeds=True)["changed"])
        self.assertTrue(cd.called and sd.called)
        self.assertIn("foundation runway --run --apply", (REPO / ".github/workflows/watchdog.yml").read_text(encoding="utf-8"))

    def test_us_28_r50_the_target_is_a_year_in_whole_numbers(self):
        """US-28-R50: target_days is never below 365 and every window is a positive whole number."""
        root = scratch()
        base = json.loads((REPO / "doctrine/runway.json").read_text(encoding="utf-8"))
        write(root, "doctrine/runway.json", base)
        self.assertEqual(runway.check(root), [])
        write(root, "doctrine/runway.json", {**base, "target_days": 100, "cost_trend_days": "30", "max_failure_open_days": 0})
        errs = runway.check(root)
        self.assertIn("target_days is below the owner's minimum of 365", errs)
        self.assertIn("cost_trend_days must be a positive whole number", errs)
        self.assertIn("max_failure_open_days must be a positive whole number", errs)


PILLARS = [{"id": "cost", "source": "ops/criticality.jsonl", "field": "cost", "op": "<=", "value": 0},
           {"id": "repair", "source": "ops/resilience.jsonl", "where": {"kind": "beat"}, "field": "stalled", "op": "<=", "value": 0},
           {"id": "improve", "source": "ops/criticality.jsonl", "field": "self_deploys", "op": ">", "value": 0}]


def dep(i, status, **kw):
    return {"id": i, "class": "credential", "what": "w", "status": status, "evidence": "e", "probe": "file:foundation/unattended.py", **kw}


class ExternalInputs(unittest.TestCase):
    def reg(self, deps, pillars=PILLARS, **target):
        root = scratch()
        write(root, "foundation/unattended.py", "")
        write(root, unattended.DATA, {"target": {"statement": "s", "metric": "m", "op": ">=", "value": 365, "probe": "cmd:python3 -m foundation unattended --horizon", "pillars": pillars, **target},
                                      "warn_days": 60, "dependencies": deps})
        return root

    def test_us_28_r51_every_external_input_is_closed_a_gate_or_an_open_item(self):
        """US-28-R51: closed names a probe that resolves; a gate is identity-bound with a default and one https link; open has a queue item and does not lapse inside warn_days; ids are unique."""
        gate = dep("g1", "gate", renewal="identity", default="the staged default", connect="https://x.example/connect")
        good = self.reg([dep("c1", "closed"), gate, dep("o1", "open", item="Q-O1", expires="2027-12-01")])
        write(good, "docs/issues/Q-O1.json", {"id": "Q-O1"})
        self.assertEqual(unattended.check(good, TODAY), [])
        errs = lambda deps, **kw: "\n".join(unattended.check(self.reg(deps, **kw), TODAY))
        self.assertIn("target lacks the pillar improve", errs([], pillars=PILLARS[:2]))
        self.assertIn("pillar cost needs a source, a field, an op and a value", errs([], pillars=[{"id": "cost"}, *PILLARS[1:]]))
        self.assertIn("x: needs a class, a status, what and evidence", errs([dep("x", "closed", **{"class": "bogus"})]))
        self.assertIn("c1: listed twice", errs([dep("c1", "closed"), dep("c1", "closed")]))
        self.assertIn("c1: probe `file:nope` does not resolve", errs([dep("c1", "closed", probe="file:nope")]))
        self.assertIn("g1: a gate is identity-bound and needs a default in effect and one https link", errs([dep("g1", "gate", renewal="identity", connect="http://x")]))
        self.assertIn("o1: an open input needs a queue item in docs/issues", errs([dep("o1", "open", item="Q-NONE")]))
        soon = errs([dep("o1", "open", item="Q-O1", expires=(TODAY + dt.timedelta(days=45)).isoformat())])
        self.assertIn("o1: an open input needs a queue item in docs/issues", soon)  # no item file in this fixture
        write(good, "docs/issues/Q-O1.json", {"id": "Q-O1"})
        write(good, unattended.DATA, {**json.loads((good / unattended.DATA).read_text(encoding="utf-8")),
                                      "dependencies": [dep("o1", "open", item="Q-O1", expires=(TODAY + dt.timedelta(days=45)).isoformat())]})
        self.assertEqual(unattended.check(good, TODAY), ["o1: lapses in 45 day(s) and nothing renews it"])

    def test_us_28_r52_the_horizon_is_the_first_lapse_and_the_pillars_are_read_from_ledgers(self):
        """US-28-R52: the horizon is days to the earliest dated input that is not closed; met needs it at the target, no open input and every pillar met from the newest matching ledger row."""
        far = (TODAY + dt.timedelta(days=45)).isoformat()
        root = self.reg([dep("c1", "closed", expires="2026-12-01"), dep("o1", "open", item="Q-O1", expires=far), dep("g1", "gate", renewal="identity")])
        h = unattended.horizon(root, TODAY)
        self.assertEqual((h["horizon_days"], h["bounded_by"], h["open"], h["gates"], h["closed"], h["total"], h["met"]), (45, ["o1"], ["o1"], ["g1"], 1, 3, False))
        calm = self.reg([dep("c1", "closed"), dep("g1", "gate", renewal="identity")])
        self.assertEqual(unattended.horizon(calm, TODAY)["horizon_days"], None)
        self.assertEqual({p["status"] for p in unattended.pillars(calm)}, {"unmeasured"})
        self.assertFalse(unattended.horizon(calm, TODAY)["met"])  # no reading is never met
        write(calm, "ops/criticality.jsonl", json.dumps({"at": "t1", "cost": 0.0, "self_deploys": 2}) + "\n")
        write(calm, "ops/resilience.jsonl", "".join(json.dumps(r) + "\n" for r in ({"kind": "beat", "stalled": 3}, {"kind": "other", "stalled": 9}, {"kind": "beat", "stalled": 0})))
        ps = {p["id"]: p for p in unattended.pillars(calm)}
        self.assertEqual({k: p["status"] for k, p in ps.items()}, {"cost": "met", "repair": "met", "improve": "met"})
        self.assertEqual((ps["cost"]["at"], ps["improve"]["want"]), ("t1", "> 0"))
        self.assertTrue(unattended.horizon(calm, TODAY)["met"])
        write(calm, "ops/resilience.jsonl", json.dumps({"kind": "beat", "stalled": 2}) + "\n")
        self.assertEqual({p["id"]: p["status"] for p in unattended.pillars(calm)}["repair"], "unmet")
        self.assertFalse(unattended.horizon(calm, TODAY)["met"])

    def test_us_28_r53_the_probe_of_an_input_passes_only_when_it_is_closed(self):
        """US-28-R53: --probe ID exits 0 for a closed input and 1 for a gate, an open input or an unknown id."""
        reg = unattended.load()["dependencies"]
        closed = next(x["id"] for x in reg if x["status"] == "closed")
        other = next(x["id"] for x in reg if x["status"] != "closed")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual((unattended.main(["--probe", closed]), unattended.main(["--probe", other]), unattended.main(["--probe", "no-such-input"])), (0, 1, 1))


D = 30
EMPTY_ISSUES = {"opened": [0] * D, "closed": [0] * D}
kinds = lambda r: [(f["kind"], f["id"]) for f in r["findings"]]


class Trajectory(unittest.TestCase):
    def test_us_28_r54_a_hotspot_is_a_rising_share_of_change_or_a_file_rewritten_on_many_days(self):
        """US-28-R54: an area with at least 30 percent of the last week's change, 1.5 times its earlier weekly pace and 40 lines is a hotspot; a file rewritten on 6 or more days is one (five at most)."""
        hot = st.analyze({"a": [0] * 23 + [30] * 7, "b": [10] * D}, {}, {}, EMPTY_ISSUES, D)
        self.assertIn(("hotspot", "a"), kinds(hot))
        self.assertNotIn(("hotspot", "b"), kinds(hot))
        self.assertIn("drew 75% of the last week's change", [f for f in hot["findings"] if f["id"] == "a" and f["kind"] == "hotspot"][0]["why"])
        small = st.analyze({"a": [0] * 23 + [5] * 7, "x": [10] * D}, {}, {}, EMPTY_ISSUES, D)  # 35 lines: under 40
        self.assertNotIn(("hotspot", "a"), kinds(small))
        broad = st.analyze({"a": [0] * 23 + [30] * 7, "b": [100] * D}, {}, {}, EMPTY_ISSUES, D)  # 23 percent of the change: under 30
        self.assertNotIn(("hotspot", "a"), kinds(broad))
        files = {f"f{i}.py": set(range(6 + i)) for i in range(8)}
        files["rare.py"] = set(range(5))
        r = st.analyze({"x": [10] * D}, {}, files, EMPTY_ISSUES, D)
        hot_files = [f["id"] for f in r["findings"] if f["kind"] == "hotspot"]
        self.assertEqual(hot_files, ["f7.py", "f6.py", "f5.py", "f4.py", "f3.py"])
        self.assertEqual([x["file"] for x in r["files"]][:2], ["f7.py", "f6.py"])

    def test_us_28_r55_neglect_is_steady_activity_that_went_quiet_while_the_system_moved(self):
        """US-28-R55: at least 7 quiet days after 20 lines on 3 or more days, while the system moved over 40 lines, is neglected; the 8 largest are kept."""
        busy = [10] * D
        self.assertIn(("neglected", "old"), kinds(st.analyze({"old": [10] * 10 + [0] * 20, "busy": busy}, {}, {}, EMPTY_ISSUES, D)))
        for name, series in (("once", [0] * 5 + [50] + [0] * 24), ("short", [10] * 10 + [0] * 4 + [10] * 16), ("small", [1] * 10 + [0] * 20), ("two", [0] * 10 + [30, 30] + [0] * 18)):
            self.assertNotIn(("neglected", name), kinds(st.analyze({name: series, "busy": busy}, {}, {}, EMPTY_ISSUES, D)), name)
        self.assertNotIn(("neglected", "old"), kinds(st.analyze({"old": [10] * 10 + [0] * 20, "busy": [1] * D}, {}, {}, EMPTY_ISSUES, D)))  # the rest of the system did not move
        many = {f"q{i}": [3 + i] * 10 + [0] * 20 for i in range(10)}
        got = [f["id"] for f in st.analyze({**many, "busy": busy}, {}, {}, EMPTY_ISSUES, D)["findings"] if f["kind"] == "neglected"]
        self.assertEqual(got, [f"q{i}" for i in range(9, 1, -1)])

    def test_us_28_r56_drift_is_a_share_that_moved_and_bookkeeping_is_never_a_finding(self):
        """US-28-R56: a share moved by 0.15 or more between halves is drift; a loop ledger quiet for 7 days after 6 rows is neglected; a backlog growing over 14 or more days is drift; record areas are measured, never named."""
        r = st.analyze({"a": [2] * 15 + [10] * 15, "b": [10] * 15 + [2] * 15}, {}, {}, EMPTY_ISSUES, D)
        self.assertEqual({k for k in kinds(r) if k[0] == "drift"}, {("drift", "a"), ("drift", "b")})
        self.assertEqual([k for k in kinds(st.analyze({"a": [10] * D, "b": [10] * D}, {}, {}, EMPTY_ISSUES, D)) if k[0] == "drift"], [])
        rec = st.analyze({"ops": [0] * 23 + [500] * 7, "docs/issues": [0] * 23 + [500] * 7, "x": [10] * D}, {}, {}, EMPTY_ISSUES, D)
        self.assertFalse([f for f in rec["findings"] if f["id"] in ("ops", "docs/issues")])
        self.assertEqual([a["area"] for a in rec["areas"]], ["x"])
        loops = st.analyze({"x": [10] * D}, {"beat": [3] * 10 + [0] * 20, "rare": [1] + [0] * 29, "live": [3] * D}, {}, EMPTY_ISSUES, D)
        self.assertEqual([f["id"] for f in loops["findings"]], ["loop:beat"])
        self.assertEqual({l["loop"]: l["quiet_days"] for l in loops["loops"]}, {"beat": 20, "live": 0, "rare": 29})
        grow = st.analyze({"x": [10] * D}, {}, {}, {"opened": [2] * D, "closed": [0] * D}, D)
        self.assertEqual([f["why"][:50] for f in grow["findings"]], ["issues are opening faster than they close: backlog"])
        self.assertEqual(grow["issues"]["backlog_series"][:3], [2, 4, 6])
        self.assertEqual(st.analyze({"x": [10] * 10}, {}, {}, {"opened": [2] * 10, "closed": [0] * 10}, 10)["findings"], [])
        self.assertEqual(st.analyze({"x": [10] * D}, {}, {}, {"opened": [2] * D, "closed": [2] * D}, D)["findings"], [])

    def test_us_28_r57_observed_series_become_a_yearly_rate_from_the_systems_own_history(self):
        """US-28-R57: a rate needs 7 days; the trend compares the last third with the rest; reverts, merge commits, CI refusals and deploys that did not go live are read from git and the ledgers."""
        self.assertIsNone(st.observed_rate([1, 1]))
        up = st.observed_rate([0] * 8 + [1, 1, 2, 2])
        self.assertEqual(up, {"rate_year": 182.5, "recent_year": 547.5, "trend": 4.0, "days": 12, "events": 6})
        self.assertEqual(st.observed_rate([1] * 12)["trend"], 0.0)
        self.assertEqual(st.observed_rate([2] * 8 + [0] * 4)["trend"], -0.9)
        self.assertEqual(st.observed_rate([0] * 12)["trend"], 0.0)
        root = scratch()
        write(root, "ops/checks-session.jsonl", "".join(json.dumps({"at": a}) + "\n" for a in ("2026-11-25T01:00:00Z", "2026-11-25T20:00:00Z", "2026-11-20T01:00:00Z", "2026-01-01T00:00:00Z")))
        write(root, "ops/deploys.jsonl", json.dumps({"at": "2026-11-24T00:00:00Z", "live_matches_commit": False}) + "\n" + json.dumps({"at": "2026-11-24T01:00:00Z", "live_matches_commit": True}) + "\n")
        ev = st.observed_events(root, 10, TODAY)
        self.assertEqual(set(ev), {"reverts", "conflict_merges", "ci_unavailable", "deploy_not_live"})
        self.assertEqual((ev["ci_unavailable"][8], ev["ci_unavailable"][3], sum(ev["ci_unavailable"])), (2, 1, 3))
        self.assertEqual((ev["deploy_not_live"][7], sum(ev["deploy_not_live"]), sum(ev["reverts"])), (1, 1, 0))
        empty = st.run(root, apply=False, today=TODAY, days=10)
        self.assertEqual(empty["history_days"], 0)  # no git history: days before it are unknown, never zero
        self.assertIsNone(empty["observed"]["ci_unavailable"]["rate_year"])

    def test_us_28_r57_the_rate_is_taken_over_the_days_the_history_covers(self):
        """US-28-R57: from a git history the revert, merge and CI series are rates over the days since the first change; the run writes the record and appends one ledger row."""
        root = scratch()
        subprocess.run(["git", "init", "-q", str(root)], check=True)
        base = int(dt.datetime(2026, 11, 18, 12, tzinfo=dt.timezone.utc).timestamp())
        for i in range(9):
            f = root / "a/x.txt"
            f.parent.mkdir(exist_ok=True)
            f.write_text(f"{i}\n", encoding="utf-8")
            subject = {2: 'Revert "bad change"', 4: "Merge main into side"}.get(i, f"work {i}")
            env = {**os.environ, "GIT_AUTHOR_DATE": f"{base + i * 86400} +0000", "GIT_COMMITTER_DATE": f"{base + i * 86400} +0000"}
            subprocess.run(["git", "-C", str(root), "add", "-A"], check=True, capture_output=True)
            subprocess.run(["git", "-C", str(root), "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", subject], check=True, env=env, capture_output=True)
        write(root, "ops/checks-session.jsonl", "".join(json.dumps({"at": "2026-11-25T0%d:00:00Z" % i}) + "\n" for i in (1, 2)))
        rec = st.run(root, apply=True, today=TODAY, days=14)
        self.assertEqual(rec["history_days"], 9)
        o = rec["observed"]
        self.assertEqual((o["reverts"]["rate_year"], o["reverts"]["events"], o["reverts"]["days"], o["reverts"]["trend"]), (40.6, 1, 9, -0.9))
        self.assertEqual((o["conflict_merges"]["events"], o["ci_unavailable"]["rate_year"], o["ci_unavailable"]["events"]), (1, 81.1, 2))
        self.assertEqual(json.loads((root / st.LATEST).read_text(encoding="utf-8"))["days"], 14)
        row = json.loads((root / st.LEDGER).read_text(encoding="utf-8").splitlines()[0])
        self.assertEqual(sorted(row), ["at", "days", "findings", "hot", "observed"])

    def _rec(self, *findings):
        return {"at": "2026-11-26T00:00:00Z", "days": 30, "history_days": 30, "areas": [], "loops": [], "files": [], "issues": {"opened": 0, "closed": 0, "backlog_series": []},
                "observed": {}, "findings": [{"kind": k, "id": i, "why": "w", "evidence": "e"} for k, i in findings]}

    def test_us_28_r58_findings_become_items_with_a_probe_and_close_when_the_shape_clears(self):
        """US-28-R58: at most 3 Q-TRAJ items a run, drift only for the issue backlog, ids made safe, none refiled; an item whose finding is gone is closed with evidence; the probe passes once the finding is absent."""
        root = scratch()
        (root / "site").mkdir()
        write(root, "docs/issues/Q-TRAJ-hotspot-old.json", {"id": "Q-TRAJ-hotspot-old", "body": "**Status:** open\n"})
        rec = self._rec(("hotspot", "a"), ("hotspot", "b b/c"), ("neglected", "loop:c"), ("neglected", "d"), ("drift", "e"), ("drift", "issues"))
        with mock.patch.object(ft.core, "run", side_effect=lambda *a, **k: json.loads(json.dumps(rec))):
            out = ft.run(root, apply=True)
            again = ft.run(root, apply=True)
        self.assertEqual(out["filed"], ["Q-TRAJ-hotspot-a", "Q-TRAJ-hotspot-b-b-c", "Q-TRAJ-neglected-loop-c"])
        self.assertEqual(out["closed"], ["Q-TRAJ-hotspot-old"])
        self.assertEqual(again["filed"], [])
        body = json.loads((root / "docs/issues/Q-TRAJ-hotspot-a.json").read_text(encoding="utf-8"))["body"]
        self.assertIn("cmd:python3 -m foundation trajectory --probe hotspot:a", body)
        self.assertIn("**Status:** open", body)
        old = json.loads((root / "docs/issues/Q-TRAJ-hotspot-old.json").read_text(encoding="utf-8"))["body"]
        self.assertIn("**Status:** closed", old)
        self.assertIn("the shape no longer shows it", old)
        self.assertFalse((root / "docs/issues/Q-TRAJ-drift-e.json").exists())
        with mock.patch.object(ft.core, "run", return_value=rec), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual((ft.probe(root, "hotspot:a"), ft.probe(root, "hotspot:nobody")), (1, 0))
        self.assertEqual(ft._id({"kind": "hotspot", "id": "x" * 100}), "Q-TRAJ-hotspot-" + "x" * 60)

    def test_us_28_r59_the_public_page_never_names_another_tenant_and_says_when_nothing_is_measured(self):
        """US-28-R59: page data is {measured: false} before a first reading; areas and findings whose name matches the private-name filter are left out; lists are capped."""
        root = scratch()
        self.assertEqual(ft.page_data(root), {"measured": False})
        area = lambda n: {"area": n, "total": 5, "recent7": 1, "share_recent": 0.1, "share_trend": 0.0, "quiet_days": 0, "series": [1], "extra": "dropped"}
        write(root, st.LATEST, {"at": "t", "days": 30, "history_days": 9, "areas": [area("site"), area("QNFO-x"), *[area(f"a{i}") for i in range(12)]],
                                "loops": [{"loop": f"l{i}", "rows": i, "quiet_days": 0, "series": [1]} for i in range(12)], "issues": {"opened": 0, "closed": 0, "backlog_series": []},
                                "findings": [{"kind": "hotspot", "id": "qnfo-thing", "why": "w", "evidence": "e"}, *[{"kind": "drift", "id": f"f{i}", "why": "w", "evidence": "e"} for i in range(15)]],
                                "observed": {"ci_unavailable": {"series": [1], "rate_year": 1.0, "recent_year": 2.0, "trend": 0.5, "events": 3, "days": 9}}})
        p = ft.page_data(root)
        self.assertTrue(p["measured"])
        self.assertEqual(len(p["areas"]), 8)
        self.assertNotIn("QNFO-x", [a["area"] for a in p["areas"]])
        self.assertNotIn("extra", p["areas"][0])
        self.assertEqual((len(p["loops"]), p["loops"][0]["loop"]), (8, "l11"))
        self.assertEqual((len(p["findings"]), "qnfo-thing" in [f["id"] for f in p["findings"]]), (12, False))
        self.assertEqual(p["observed"]["ci_unavailable"], {"rate_year": 1.0, "recent_year": 2.0, "trend": 0.5, "events": 3, "days": 9})
        self.assertTrue(ft.render(root).startswith("// SPDX-License-Identifier"))


NOW_T = 1_800_000_000.0 + 40 * 86400
DAY = 86400
TODAY_D = temporal._day(NOW_T)
TCFG = {"history_days": 90, "recent_days": 3, "baseline_days": 14, "min_baseline_days": 5, "spark_days": 28, "publish_areas": 14, "history_rows": 50,
        "hot_ratio": 3.0, "hot_floor_rate": 1.0, "hot_min_recent": 12, "file_churn_min": 8, "max_file_hotspots": 3,
        "decay_ratio": 0.2, "neglect_min_base": 12, "revive_ratio": 0.5, "stop_factor": 4, "stop_min_events": 4, "min_gap_s": 3600, "fail_streak": 3, "fail_min": 3,
        "settle_days": 7, "escalate_runs": 2, "max_items_per_run": 5, "attention_step": 0.25, "attention_min": 0.5, "attention_max": 2.0, "default_advocate": "operations",
        "auto_areas": True, "noise": ["ops/", "docs/issues/"], "tenant": "ultrastable",
        "areas": [{"id": "site", "paths": ["site/"], "advocate": "uiux-manager"}, {"id": "docs", "paths": ["docs/"], "advocate": "project-manager"}],
        "ledgers": [{"id": "deploys", "file": "ops/deploys.jsonl", "time": "at", "key": ["worker"], "ok_field": "ok", "ok_values": [True], "area": "workflows",
                     "advocate": "infrastructure-manager", "files": ["deploy.mjs"]}],
        "entries": [{"id": "open-items", "glob": "docs/issues/Q-*.json", "open_only": "**Status:** open", "stale_days": 10, "min_count": 2, "batch": 2, "area": "docs", "advocate": "project-manager"}]}


def ev_of(areas, files=None, last_touch=None):
    return {"areas": areas, "files": files or {}, "last_touch": last_touch or {}, "first": NOW_T - 30 * DAY, "commits": 99}


def span(frm, to, n):
    return {d: n for d in range(TODAY_D - frm, TODAY_D - to)}


class Temporal(unittest.TestCase):
    def found(self, ev, led=None, root=None, cfg=TCFG):
        f, summary = temporal.diagnose(root or scratch(), cfg, NOW_T, ev, led)
        return {(x["kind"], x["subject"]): x for x in f}, summary

    def test_us_28_r60_windows_are_complete_days_and_the_baseline_shrinks_to_the_history(self):
        """US-28-R60: recent and baseline totals are over complete days; the baseline never reaches before the first recorded day."""
        counts = {d: 2 for d in range(0, 40)}
        self.assertEqual(temporal.windows(counts, 40, 3, 14, 0), (6, 28, 14))
        self.assertEqual(temporal.windows(counts, 40, 3, 14, 30), (6, 14, 7))
        self.assertEqual(temporal.windows({10: 5, 11: 5, 12: 5}, 13, 3, 14, 11), (15, 0, 0))  # a young series has no baseline to be judged against
        self.assertEqual(temporal.windows({}, 40, 3, 14, 50), (0, 0, 0))

    def test_us_28_r61_a_hotspot_is_a_rate_at_a_multiple_of_its_own_baseline_or_a_file_edited_again_and_again(self):
        """US-28-R61: an area at hot_ratio times its baseline with enough commits is a watch finding for its advocate; the worst few files edited file_churn_min times are too; a steady area files nothing."""
        site = {**span(30, 3, 2), **span(3, 0, 30)}
        files = {f"site/hot{i}.txt": {TODAY_D - 1: 40 - i} for i in range(5)}
        files["site/mild.txt"] = {TODAY_D - 1: 3}
        got, summary = self.found(ev_of({"site": site, "calm": span(30, 0, 2)}, files))
        a = got[("hotspot", "area:site")]
        self.assertEqual((a["severity"], a["advocate"], a["area"]), ("watch", "uiux-manager", "site"))
        self.assertIn("90 commits in 3 days against a baseline of 2.0 a day", a["evidence"])
        self.assertIn("recent_rate returns below 3.0x baseline within 7 days", a["prediction"])
        self.assertNotIn(("hotspot", "area:calm"), got)
        hot_files = sorted(k[1] for k in got if k[0] == "hotspot" and k[1].startswith("file:"))
        self.assertEqual(hot_files, ["file:site/hot0.txt", "file:site/hot1.txt", "file:site/hot2.txt"])  # three at most, the worst first
        self.assertEqual(got[("hotspot", "file:site/hot0.txt")]["files"], ["site/hot0.txt"])
        self.assertEqual(summary["areas"]["site"]["recent"], 90)
        young = {**ev_of({"young": span(3, 0, 40)}), "first": NOW_T - 6 * DAY}  # six days of history: fewer than min_baseline_days to judge against
        self.assertEqual(self.found(young)[0], {})

    def test_us_28_r62_neglect_is_an_active_area_that_decayed_or_went_untouched(self):
        """US-28-R62: an area whose recent rate fell to decay_ratio of a real baseline is neglect (decay, or untouched at zero), an act finding naming a revival prediction."""
        gone = span(30, 3, 2)
        got, _ = self.found(ev_of({"docs": gone, "site": {**gone, TODAY_D - 1: 1}, "calm": span(30, 0, 2)}))
        untouched = got[("neglect", "area:docs")]
        self.assertEqual((untouched["severity"], untouched["advocate"]), ("act", "project-manager"))
        self.assertTrue(untouched["evidence"].startswith("untouched: 0 commits in 3 days after 28 in the 14 days before (2.0 a day)"))
        self.assertIn("gets at least 3 commits in 3 days within 7 days", untouched["prediction"])
        self.assertTrue(got[("neglect", "area:site")]["evidence"].startswith("decay: 1 commits in 3 days"))
        self.assertNotIn(("neglect", "area:calm"), got)
        self.assertNotIn(("neglect", "area:thin"), self.found(ev_of({"thin": {TODAY_D - 20: 1}}))[0])  # too little to call it neglected

    def test_us_28_r63_a_loop_that_stopped_or_keeps_failing_is_a_finding_with_the_commit_it_last_worked_at(self):
        """US-28-R63: a ledger quiet for stop_factor intervals after 4 events is a stopped loop; fail_streak failures in a row is a repeated failure; both carry the ledger's files."""
        t = lambda days_ago: NOW_T - days_ago * DAY
        led = {"deploys": [(t(8) - i * 6 * 3600, "tick", True) for i in range(20, 0, -1)]
                          + [(t(d), "site", d > 2) for d in range(10, 0, -1)] + [(t(0.5), "site", False)]
                          + [(t(0.1) - i * 6 * 3600, "fresh", True) for i in range(10, 0, -1)] + [(t(40) + i * 3600, "short", True) for i in range(3)]
                          + [(t(d), "twice", d > 2) for d in range(5, 0, -1)]}
        got, summary = self.found(ev_of({"x": span(30, 0, 2)}), led)
        stopped = got[("stopped_loop", "ledger:deploys:tick")]
        self.assertEqual((stopped["severity"], stopped["files"], stopped["advocate"]), ("act", ["deploy.mjs"], "infrastructure-manager"))
        self.assertIn("it used to arrive every 6.0 h", stopped["evidence"])
        self.assertNotIn(("stopped_loop", "ledger:deploys:fresh"), got)
        self.assertNotIn(("stopped_loop", "ledger:deploys:short"), got)  # fewer than 4 events is not a rhythm
        fail = got[("repeated_failure", "ledger:deploys:site")]
        self.assertIn("3 failures in a row", fail["evidence"])
        self.assertNotIn(("repeated_failure", "ledger:deploys:tick"), got)
        self.assertIn("ledger:deploys:site", summary["series"])
        self.assertEqual(temporal.diagnose(scratch(), TCFG, NOW_T, ev_of({"x": span(30, 0, 2)}), {"deploys": []})[0], [])

    def test_us_28_r64_entries_nobody_has_touched_are_one_finding_for_the_set(self):
        """US-28-R64: when min_count open entries are untouched for stale_days, one stale_entry finding names the oldest and a batch of paths; closed items are not entries."""
        root = scratch()
        touch = {}
        for i in range(1, 5):
            write(root, f"docs/issues/Q-{i}.json", {"id": f"Q-{i}", "body": "**Status:** open"})
            touch[f"docs/issues/Q-{i}.json"] = NOW_T - 20 * DAY
        write(root, "docs/issues/Q-5.json", {"id": "Q-5", "body": "**Status:** open"})
        touch["docs/issues/Q-5.json"] = NOW_T - DAY
        write(root, "docs/issues/Q-6.json", {"id": "Q-6", "body": "**Status:** closed"})
        got, summary = self.found(ev_of({"x": span(30, 0, 2)}, last_touch=touch), root=root)
        s = got[("stale_entry", "entries:open-items")]
        self.assertEqual(s["evidence"], "4 of 5 open-items untouched for 10+ days; oldest docs/issues/Q-1.json (20.0 d)")
        self.assertEqual((s["files"], s["severity"], summary["entries"]), (["docs/issues/Q-1.json", "docs/issues/Q-2.json"], "act", {"open-items": 5}))
        one = {k: v for k, v in touch.items() if k in ("docs/issues/Q-1.json", "docs/issues/Q-5.json")}
        self.assertNotIn(("stale_entry", "entries:open-items"), self.found(ev_of({"x": span(30, 0, 2)}, last_touch=one), root=root)[0])

    def test_us_28_r65_a_finding_counts_its_runs_settles_with_a_record_and_reopens_under_a_new_id(self):
        """US-28-R65: seen again is a run, not a duplicate; gone is settled with a record and never dropped; seen after settling it reopens and its item id gets a suffix."""
        f = temporal.finding("neglect", "area:docs", "docs", "project-manager", "act", "e", "p")
        self.assertEqual(f["id"], temporal.fid("neglect", "area:docs"))
        st1 = temporal.advance({"findings": {}, "settled": []}, [f], NOW_T)
        self.assertEqual((st1["findings"][f["id"]]["status"], st1["findings"][f["id"]]["runs"]), ("open", 1))
        st2 = temporal.advance(st1, [f], NOW_T + DAY)
        self.assertEqual(st2["findings"][f["id"]]["runs"], 2)
        st3 = temporal.advance(st2, [], NOW_T + 2 * DAY)
        self.assertEqual(st3["findings"][f["id"]]["status"], "settled")
        self.assertEqual([(s["id"], s["runs"]) for s in st3["settled"]], [(f["id"], 2)])
        st4 = temporal.advance(st3, [f], NOW_T + 3 * DAY)
        s = st4["findings"][f["id"]]
        self.assertEqual((s["status"], s["runs"], s["reopened"]), ("open", 1, 1))
        self.assertEqual(temporal.item_id(s), f"Q-TEMPORAL-{f['id']}-r1")
        for i in range(250):
            st4 = temporal.advance(st4, [temporal.finding("hotspot", f"x{i}", "a", "o", "watch", "e", "p")], NOW_T + i)
        self.assertEqual(len(st4["settled"]), 200)  # the record is kept to the last 200

    def test_us_28_r66_items_are_filed_act_first_watch_after_escalation_capped_and_owned(self):
        """US-28-R66: an act finding becomes a queue item at once, a watch finding after escalate_runs, at most max_items_per_run a run, once each; a tenant's go to its own queue file."""
        mk = lambda kind, i, sev: temporal.finding(kind, f"s{i}", "loops", "operations", sev, "ev", "pred")
        found = [mk("hotspot", 0, "watch"), mk("hotspot", 1, "watch")] + [mk("stopped_loop", i, "act") for i in range(2, 9)]
        root = scratch()
        (root / "docs/issues").mkdir(parents=True)
        state = temporal.advance({"findings": {}, "settled": []}, found, NOW_T)
        first = temporal.file_items(root, TCFG, state, NOW_T)
        self.assertEqual(len(first), 5)
        self.assertTrue(all(i.startswith("Q-TEMPORAL-") for i in first))
        self.assertEqual({state["findings"][fid]["kind"] for fid in (i[len("Q-TEMPORAL-"):] for i in first)}, {"stopped_loop"})
        body = json.loads((root / f"docs/issues/{first[0]}.json").read_text(encoding="utf-8"))["body"]
        self.assertIn("Prediction:", body)
        self.assertIn(f"cmd:python3 -m foundation temporal --settled {first[0][len('Q-TEMPORAL-'):]}", body)
        self.assertIn("**Owner:** operations", body)
        state = temporal.advance(state, found, NOW_T + DAY)
        second = temporal.file_items(root, TCFG, state, NOW_T + DAY)
        self.assertEqual(len(second), 4)  # two watch findings now escalated, the last two act findings
        self.assertTrue(set(first).isdisjoint(second))
        self.assertEqual(temporal.file_items(root, TCFG, state, NOW_T + DAY), [])
        out = scratch()
        tenant = {**TCFG, "tenant": "px"}
        tstate = temporal.advance({"findings": {}, "settled": []}, found[2:4], NOW_T)
        filed = temporal.file_items(root, tenant, tstate, NOW_T, out=out)
        queue = json.loads((out / "to_file.json").read_text(encoding="utf-8"))
        self.assertEqual([q["id"] for q in queue], filed)
        self.assertEqual(queue[0]["labels"], ["temporal", "agent-task"])
        self.assertEqual(temporal.file_items(root, tenant, tstate, NOW_T, out=out), [])

    def test_us_28_r67_attention_rises_for_a_neglected_area_and_falls_for_a_hot_one_within_bounds(self):
        """US-28-R67: each neglected area raises its advocate's weight by attention_step and each hot one lowers it, between attention_min and attention_max; file hotspots do not move it."""
        mk = lambda kind, subj, who: temporal.finding(kind, subj, "a", who, "act", "e", "p")
        w = temporal.attention({}, [mk("neglect", "area:docs", "project-manager"), mk("hotspot", "area:site", "uiux-manager"), mk("hotspot", "file:site/x", "operations")], TCFG)
        self.assertEqual(w, {"project-manager": 1.25, "uiux-manager": 0.75})
        many_up = temporal.attention({}, [mk("neglect", f"area:a{i}", "pm") for i in range(8)], TCFG)
        many_down = temporal.attention({}, [mk("hotspot", f"area:a{i}", "pm") for i in range(8)], TCFG)
        self.assertEqual((many_up["pm"], many_down["pm"]), (2.0, 0.5))

    def test_us_28_r68_a_finding_settles_by_recomputation_and_the_detector_fires_after_escalation(self):
        """US-28-R68: --settled passes once the finding is no longer produced; the detector lists open findings still produced after escalate_runs runs; check names missing keys and bad windows."""
        root = scratch()
        write(root, "doctrine/temporal.json", TCFG)
        f = temporal.finding("hotspot", "area:x", "x", "operations", "watch", "why", "pred")
        with mock.patch.object(temporal, "diagnose", return_value=([f], {})):
            self.assertEqual(temporal.settled(root, f["id"], NOW_T), (False, "still holds: why"))
        with mock.patch.object(temporal, "diagnose", return_value=([], {})):
            self.assertEqual(temporal.settled(root, f["id"], NOW_T), (True, "no longer detected"))
        state = lambda runs: {"findings": {f["id"]: {**f, "status": "open", "runs": runs}}, "settled": []}
        write(root, "ops/temporal/findings.json", state(2))
        with mock.patch.object(temporal, "diagnose", return_value=([f], {})):
            self.assertEqual(temporal.probe(root, NOW_T), [f"hotspot area:x stood for 2 runs: why"])
            write(root, "ops/temporal/findings.json", state(1))
            self.assertEqual(temporal.probe(root, NOW_T), [])
            write(root, "ops/temporal/findings.json", state(5))
        with mock.patch.object(temporal, "diagnose", return_value=([], {})):
            self.assertEqual(temporal.probe(root, NOW_T), [])  # the finding cleared by itself
        bad = scratch()
        write(bad, "doctrine/temporal.json", {k: v for k, v in TCFG.items() if k != "recent_days"})
        self.assertIn("doctrine/temporal.json: missing recent_days", temporal.check(bad))
        write(bad, "doctrine/temporal.json", {**TCFG, "recent_days": 20})
        self.assertIn("windows must satisfy recent < baseline <= history - recent", temporal.check(bad))
        write(bad, "doctrine/temporal.json", {**TCFG, "ledgers": [{"id": "x"}], "areas": [{"id": "a"}]})
        errs = "\n".join(temporal.check(bad))
        self.assertIn("ledger source needs id and file", errs)
        self.assertIn("area needs id and paths", errs)


def m(area, scenario, **kw):
    return {"area": area, "failure": "failure in " + area, "scenario": scenario, **kw}


def _boom(root, today):
    raise RuntimeError("scenario crashed")


def _unmeasured(root, today):
    raise yearfail.Unmeasured("the result is not readable from here")


SCENARIOS = {"found": lambda root, today: (True, True, "found and fixed"), "missed": lambda root, today: (False, False, "not noticed"),
             "unfixed": lambda root, today: (True, False, "seen, not fixed"), "boom": _boom, "gone": _unmeasured, "ci": lambda root, today: (True, True, "reverted")}


class YearFail(unittest.TestCase):
    def run_table(self, *months):
        with mock.patch.object(yearfail, "cfg", return_value={"version": "t", "months": list(months)}), mock.patch.dict(yearfail.FUNCS, SCENARIOS), \
                mock.patch.object(yearfail, "scratch", lambda keep=False: scratch()):
            return yearfail.run(REPO)

    def test_us_28_r69_a_month_passes_only_when_detected_and_repaired_and_never_when_not_simulated(self):
        """US-28-R69: PASS needs detection and a verified repair; a miss, an unfixed finding or a crash is FAIL; a scenario that cannot be observed or is absent is UNCOVERED with its item; labels say what was real."""
        r = self.run_table(m("a", "found"), m("b", "missed"), m("c", "unfixed"), m("d", "boom"), m("e", "gone", item="Q-YEARFAIL-e"), m("f", None, why="no api", item="Q-F"), m("g", "ci"))
        by = {x["area"]: x for x in r["months"]}
        self.assertEqual({k: v["result"] for k, v in by.items()}, {"a": "PASS", "b": "FAIL", "c": "FAIL", "d": "FAIL", "e": "UNCOVERED", "f": "UNCOVERED", "g": "PASS"})
        self.assertEqual(by["a"]["labels"], {"detect": "REAL", "repair": "SIMULATED", "verify": "REAL"})
        self.assertEqual(by["g"]["labels"]["repair"], "REAL")  # only the ci scenario repairs with the repository's own code
        self.assertEqual((by["c"]["detected"], by["c"]["repaired_and_verified"]), (True, False))
        self.assertEqual((by["d"]["crashed"], by["d"]["evidence"]), (True, "RuntimeError: scenario crashed"))
        self.assertEqual((by["e"]["why"], by["e"]["item"], by["f"]["why"], by["f"]["item"]), ("the result is not readable from here", "Q-YEARFAIL-e", "no api", "Q-F"))
        self.assertNotIn("labels", by["f"])
        self.assertEqual((r["pass"], r["fail"], r["uncovered"], r["months_total"], r["ok"]), (2, 3, 2, 7, False))
        self.assertIn("UNCOVERED areas were not simulated", r["honesty"])
        self.assertTrue(self.run_table(m("a", "found"), m("b", None, why="w", item="Q"))["ok"])  # an uncovered area is not a failure, and not a pass
        dates = [x["date"] for x in r["months"]]
        self.assertEqual((dates[0], dates == sorted(dates)), (yearfail.START.isoformat(), True))
        self.assertTrue(dates[-1] < (yearfail.START + dt.timedelta(days=365)).isoformat())

    def test_us_28_r70_the_scenario_table_has_a_year_of_months_and_every_gap_has_an_item(self):
        """US-28-R70: at least twelve months, a scenario that exists, and a Q-YEARFAIL item for every area the simulation cannot reach."""
        twelve = [m(f"a{i}", "boot") for i in range(12)]
        with mock.patch.object(yearfail, "cfg", return_value={"months": twelve}):
            self.assertEqual(yearfail.check(REPO), [])
        with mock.patch.object(yearfail, "cfg", return_value={"months": twelve[:11]}):
            self.assertEqual(yearfail.check(REPO), ["the year has at least twelve months"])
        with mock.patch.object(yearfail, "cfg", return_value={"months": twelve + [m("gap", None, why="w"), m("typo", "no-such-scenario")]}):
            self.assertEqual(yearfail.check(REPO), ["gap: an uncovered area needs a Q-YEARFAIL item id", "typo: no scenario no-such-scenario"])
        self.assertEqual(yearfail.check(REPO), [])  # the committed table

    def test_us_28_r71_apply_writes_the_record_the_page_data_and_one_item_per_failed_month(self):
        """US-28-R71: --apply writes ops/yearfail.json and the page module and files Q-YEARFAIL-<area> for each FAIL; the exit code is 0 only when no month failed; --probe passes only for a PASS month."""
        fake = {"version": "t", "simulated_start": "2027-01-01", "pass": 1, "fail": 1, "uncovered": 0, "months_total": 2, "ok": False, "honesty": "h",
                "months": [{"month": 1, "date": "2027-01-01", "area": "alpha", "failure": "fa", "result": "FAIL", "evidence": "nothing noticed"},
                           {"month": 2, "date": "2027-01-29", "area": "beta", "failure": "fb", "result": "PASS", "evidence": "ok"}]}
        root = scratch()
        (root / "site").mkdir()
        with mock.patch.object(yearfail, "REPO", root), mock.patch.object(yearfail, "run", return_value=fake), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(yearfail.main(["--apply"]), 1)
            self.assertEqual((yearfail.main(["--probe", "alpha"]), yearfail.main(["--probe", "beta"]), yearfail.main(["--probe", "zzz"])), (1, 0, 1))
        self.assertEqual(json.loads((root / "ops/yearfail.json").read_text(encoding="utf-8"))["months_total"], 2)
        page = (root / "site/yearfail-data.js").read_text(encoding="utf-8")
        self.assertTrue(page.startswith("// GENERATED by python3 -m foundation yearfail --apply; do not edit."))
        self.assertIn("export const YEARFAIL =", page)
        item = json.loads((root / "docs/issues/Q-YEARFAIL-alpha.json").read_text(encoding="utf-8"))
        self.assertIn("cmd:python3 -m foundation yearfail --probe alpha", item["body"])
        self.assertFalse((root / "docs/issues/Q-YEARFAIL-beta.json").exists())
        green = scratch()
        (green / "site").mkdir()
        with mock.patch.object(yearfail, "REPO", green), mock.patch.object(yearfail, "run", return_value={**fake, "ok": True, "fail": 0, "months": fake["months"][1:]}), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(yearfail.main(["--apply"]), 0)
        self.assertFalse(list((green / "docs/issues").glob("*")) if (green / "docs/issues").exists() else [])


def catalog(root, text="x('@cf/a/old'); y('@cf/a/old-x'); z('@cf/b/gone'); w('@cf/example/skip')", **over):
    d = {"scan_globs": ["src/*.js"], "exclude": ["src/skip.js"], "fallback_order": ["@cf/c/fb"], "available": ["@cf/a/new", "@cf/b/other", "@cf/c/fb"],
         "retired": {"@cf/a/old": {"evidence": "HTTP 410", "successor": "@cf/a/new"}}, "refused": {"@cf/b/gone": "HTTP 403"}, **over}
    write(root, "doctrine/models.json", d)
    write(root, "src/x.js", text)
    write(root, "src/skip.js", "q('@cf/a/old')")
    return d


class RuntimeLoops(unittest.TestCase):
    def test_us_28_r72_a_hosted_model_that_expires_is_found_replaced_and_never_assumed_healthy(self):
        """US-28-R72: source naming a retired or refused model fails the check; rewrite moves it to its successor without touching a longer id; 410s the executor met become retirements; no credential is unmeasured."""
        root = scratch()
        d = catalog(root)
        self.assertEqual([modelwatch.classify(m_, d) for m_ in ("@cf/a/old", "@cf/b/gone", "@cf/a/new", "@cf/q/none")], ["retired", "refused", "available", "unmeasured"])
        self.assertEqual(sorted(modelwatch.references(root, d)), ["@cf/a/old", "@cf/a/old-x", "@cf/b/gone"])  # skipped files and placeholders are not references
        errs = modelwatch.check(root)
        self.assertEqual(len(errs), 2)
        self.assertTrue(any("@cf/a/old is retired (HTTP 410) and still named in src/x.js; successor @cf/a/new" in e for e in errs))
        self.assertTrue(any("@cf/b/gone is refused on the free plan" in e for e in errs))
        self.assertEqual(modelwatch.rewrite(root, d), ["src/x.js"])
        text = (root / "src/x.js").read_text(encoding="utf-8")
        self.assertIn("x('@cf/a/new')", text)
        self.assertIn("'@cf/a/old-x'", text)
        self.assertEqual(len(modelwatch.check(root)), 1)
        self.assertEqual((modelwatch.successor("@cf/a/zzz", d), modelwatch.successor("@cf/q/zzz", d)), ("@cf/a/new", "@cf/c/fb"))
        self.assertEqual(modelwatch.successor("@cf/q/zzz", {**d, "fallback_order": ["@cf/none/x"]}), "@cf/a/new")
        catalog(root, retired={"@cf/a/old": {"evidence": "e", "successor": "@cf/not/available"}})
        self.assertIn("successor of @cf/a/old is not an available model", "\n".join(modelwatch.check(root)))
        root2 = scratch()
        catalog(root2, "n('@cf/b/other')")
        write(root2, "ops/models-observed.jsonl", "".join(json.dumps(r) + "\n" for r in (
            {"model": "@cf/b/other", "status": 410, "at": "2026-11-25T00:00:00Z", "successor": "@cf/c/fb"}, {"model": "@cf/c/fb", "status": 403, "at": "t"},
            {"model": "@cf/a/old", "status": 410, "at": "t"})))
        r = modelwatch.observed(root2, apply=True)
        self.assertEqual((r["changed"], r["rewritten"]), ([["@cf/b/other", "@cf/c/fb"]], ["src/x.js"]))
        cat = json.loads((root2 / "doctrine/models.json").read_text(encoding="utf-8"))
        self.assertEqual(cat["retired"]["@cf/b/other"], {"evidence": "HTTP 410 seen by the executor at 2026-11-25T00:00:00Z", "successor": "@cf/c/fb"})
        self.assertNotIn("@cf/b/other", cat["available"])
        self.assertEqual(modelwatch.observed(root2, apply=True)["changed"], [])
        self.assertEqual(modelwatch.refresh(root2, env={}), {"measured": 0, "unmeasured": "no Workers AI credential on this host", "changed": []})
        answers = {"@cf/a/new": (410, "gone"), "@cf/c/fb": (403, "plan"), "@cf/b/gone": (0, "no network")}
        rr = modelwatch.refresh(root2, apply=False, env={"CLOUDFLARE_API_TOKEN": "t", "CLOUDFLARE_ACCOUNT_ID": "a"}, run=lambda m_, env: answers.get(m_, (200, "ok")))
        self.assertIn(["@cf/a/new", "retired"], rr["changed"])
        self.assertIn(["@cf/c/fb", "refused"], rr["changed"])
        self.assertNotIn("@cf/b/gone", [c[0] for c in rr["changed"]])  # a request that could not be made measures nothing

    def test_us_28_r73_worker_compatibility_dates_advance_by_a_loop_and_a_stopped_loop_fails(self):
        """US-28-R73: a date at least min_step_days behind today minus lag_days moves to it (topology and wrangler.toml), a recent one stays, a dry run writes nothing, and a date older than max_age_days fails."""
        root = scratch()
        write(root, compatdate.RULES, (REPO / compatdate.RULES).read_text(encoding="utf-8"))
        write(root, "doctrine/topology.json", {"system_compatibility_date": "2026-01-01", "workers": [{"id": "old", "compatibility_date": "2025-06-01"}, {"id": "new", "compatibility_date": "2026-11-01"}]})
        write(root, "a/wrangler.toml", 'name = "a"\ncompatibility_date = "2024-01-01"\n')
        quiet = io.StringIO()
        with contextlib.redirect_stderr(quiet):
            self.assertEqual(len(compatdate.check(root, TODAY)), 3)
            self.assertEqual(compatdate.target(root, TODAY).isoformat(), "2026-10-27")
            dry = compatdate.run(root, apply=False, today=TODAY)
            self.assertEqual((dry["changed"], len(dry["moved"])), (False, 3))
            self.assertIn("2024-01-01", (root / "a/wrangler.toml").read_text(encoding="utf-8"))
            done = compatdate.run(root, apply=True, today=TODAY)
            self.assertTrue(done["changed"])
            t = json.loads((root / "doctrine/topology.json").read_text(encoding="utf-8"))
            self.assertEqual((t["system_compatibility_date"], [w["compatibility_date"] for w in t["workers"]]), ("2026-10-27", ["2026-10-27", "2026-11-01"]))
            self.assertIn('compatibility_date = "2026-10-27"', (root / "a/wrangler.toml").read_text(encoding="utf-8"))
            self.assertEqual(compatdate.check(root, TODAY), [])
            self.assertFalse(compatdate.run(root, apply=True, today=TODAY + dt.timedelta(days=20))["changed"])
            self.assertTrue(compatdate.run(root, apply=True, today=TODAY + dt.timedelta(days=28))["changed"])
            late = compatdate.check(root, TODAY + dt.timedelta(days=400))
        self.assertTrue(any("is 4" in e and "(limit 120); the compatdate loop has stopped" in e for e in late), late)

    def test_us_28_r74_a_node_pin_that_leaves_maintenance_inside_a_year_fails(self):
        """US-28-R74: a workflow node-version whose major leaves maintenance within node_min_days, or is missing from the table, fails; the next long-term release passes."""
        root = scratch()
        write(root, compatdate.RULES, (REPO / compatdate.RULES).read_text(encoding="utf-8"))
        write(root, ".github/workflows/a.yml", "steps:\n  - uses: actions/setup-node@v4\n    with: {node-version: 22}\n")
        self.assertTrue(any("Node 22 leaves maintenance on 2027-04-30" in b for b in compatdate.node_problems(root, TODAY)))
        write(root, ".github/workflows/a.yml", 'with:\n  node-version: "24"\n')
        self.assertEqual(compatdate.node_problems(root, TODAY), [])
        write(root, ".github/workflows/a.yml", "with: {node-version: 99}\n")
        self.assertTrue(any("Node 99 has no end-of-maintenance date" in b for b in compatdate.node_problems(root, TODAY)))
        self.assertEqual(compatdate.node_pins(scratch()), [])

    def test_us_28_r75_every_manifest_directory_has_a_dependabot_entry_and_the_baseline_only_shrinks(self):
        """US-28-R75: each package.json, pyproject.toml directory and the workflows need a Dependabot entry unless baselined; a baseline entry that is covered or gone fails; node_modules is not read."""
        root = scratch()
        write(root, "svc/package.json", "{}")
        write(root, "py/pyproject.toml", "")
        write(root, "node_modules/x/package.json", "{}")
        write(root, ".github/workflows/ci.yml", "name: ci\n")
        self.assertEqual(deprot.check(root), ["no Dependabot entry for github-actions at /", "no Dependabot entry for npm at /svc", "no Dependabot entry for pip at /py"])
        updates = "version: 2\nupdates:\n" + "".join(f"  - package-ecosystem: {e}\n    directory: {d}\n    schedule: {{interval: weekly}}\n" for e, d in (("npm", "/svc"), ("pip", "/py"), ("github-actions", "/")))
        write(root, ".github/dependabot.yml", updates)
        self.assertEqual(deprot.check(root), [])
        write(root, ".github/dependabot.yml", updates.replace("  - package-ecosystem: npm\n    directory: /svc\n    schedule: {interval: weekly}\n", ""))
        write(root, "doctrine/deprot.json", {"baseline": [{"ecosystem": "npm", "directory": "/svc"}, {"ecosystem": "npm", "directory": "/gone"}]})
        self.assertEqual(deprot.check(root), ["baseline entry npm at /gone is covered or gone: remove it from doctrine/deprot.json"])
        write(root, ".github/dependabot.yml", updates)
        self.assertEqual(deprot.check(root), ["baseline entry npm at /gone is covered or gone: remove it from doctrine/deprot.json",
                                              "baseline entry npm at /svc is covered or gone: remove it from doctrine/deprot.json"])


class Clocks(unittest.TestCase):
    def test_us_28_r85_every_reading_of_the_year_runs_on_a_server_side_clock_that_honours_the_halt(self):
        """US-28-R85: the watchdog, temporal and seed-launch workflows and the seeded system's autonomy workflow run the readings on a schedule and are skipped under HALT=1."""
        import inspect
        from foundation import ultrastability
        tick = inspect.getsource(ultrastability._followers)
        for name in ('"yearsim"', '"saydo"', '"trajectory"', "modelwatch.observed"):
            self.assertIn(name, tick)
        wf = lambda f: (REPO / ".github/workflows" / f).read_text(encoding="utf-8")
        watchdog, temporal_wf, launch = wf("watchdog.yml"), wf("temporal.yml"), wf("seed-launch.yml")
        self.assertIn("python3 -m foundation runway --run --apply", watchdog)
        self.assertIn('cron: "23 6 * * *"', watchdog)
        self.assertIn("python3 -m foundation temporal --run --apply", temporal_wf)
        self.assertIn('cron: "17 6 * * *"', temporal_wf)
        self.assertIn("python3 -m foundation seedlaunch --e2e-scratch", launch)
        self.assertIn('cron: "23 7 * * *"', launch)
        self.assertIn('paths: ["seed/worker/src/visibility.js"', launch)
        kit_wf = (SEED / "autonomy-kit/autonomy.workflow.yml").read_text(encoding="utf-8")
        self.assertIn('cron: "17 5 * * 2"', kit_wf)
        self.assertIn('paths: ["worker/**", "scripts/**", "autonomy/**"]', kit_wf)
        self.assertIn("python3 scripts/seedadmit.py --admit --apply", kit_wf)
        self.assertIn("python3 scripts/trajectory.py --run --apply", kit_wf)
        for text in (watchdog, temporal_wf, launch, kit_wf):
            self.assertIn("vars.HALT != '1'", text)


if __name__ == "__main__":
    unittest.main()
