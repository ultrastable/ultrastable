# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""MANAGERS-1: every manager role is a running loop that owns code; every loop has a manager; the seed carries every platform manager."""
import json
import re, shutil, unittest
from pathlib import Path
from foundation import managers as M
from _repo import scratch

REPO = Path(__file__).resolve().parents[2]
FILES = [M.POLICY, "seed/autonomy/managers.json", "seed/ultrastable.json", "instances/ultrastable/loop-registry.json", "doctrine/clocks.json", "seed/worker/src/tick.js", "doctrine/team.json"]


def copy():
    d = scratch()
    for f in FILES:
        (d / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / f, d / f)
    for tree in M.TREES.values():
        shutil.copytree(REPO / tree, d / tree)
    pol = json.loads((REPO / M.POLICY).read_text())
    for r in pol["roles"].values():  # every path the register names, so only the edit under test can fail
        specs = list(r["runs"]) + [s.partition(":")[2].partition("::")[0] for s in (r["probe"], r["settles"]) if s.split(":")[0] in ("file", "grep")]
        specs += [".github/workflows/" + c.partition(":")[2] for c in r["clock"] if c.startswith("workflow:")]
        specs += ["foundation/" + s.split()[3] + ".py" for s in (r["probe"],) if s.startswith("cmd:python3 -m foundation ")]
        for p in specs:
            (d / p).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / p, d / p)
        for p in r["inputs"]:  # ROLE-ALIGN-1: an input only has to exist
            (d / p).parent.mkdir(parents=True, exist_ok=True)
            (d / p).mkdir(exist_ok=True) if (REPO / p).is_dir() else (d / p).touch()
    (d / "docs/issues").mkdir(parents=True, exist_ok=True)
    for f in pol["software_roles"]:
        for p in f["code"]:
            (d / p).parent.mkdir(parents=True, exist_ok=True)
            (d / p).touch()
        if f.get("item"):
            shutil.copy(REPO / "docs/issues" / (f["item"] + ".json"), d / "docs/issues" / (f["item"] + ".json"))
    return d


def edit(d, rel, fn):
    p = d / rel
    j = json.loads(p.read_text())
    fn(j)
    p.write_text(json.dumps(j))


def agents(rows):
    return {"agents": [{"id": f"{r}-1", "role": r, "last_tick_at": "2026-11-25 18:00:00", "last_tick_age_s": age, "dispatches": {"total": 4, "settled": 3, "last_24h": 1}} for r, age in rows]}


class Check(unittest.TestCase):
    def test_the_repository_holds(self):
        self.assertEqual(M.check(REPO), [])

    def test_scratch_copy_holds(self):
        self.assertEqual(M.check(copy()), [])

    def test_a_role_file_with_no_register_row_is_a_title(self):
        d = copy()
        (d / "agents/roles/chief-of-vibes.md").write_text("# Role: chief-of-vibes\n")
        self.assertTrue(any("chief-of-vibes" in b and "a title, not a manager" in b for b in M.check(d)))

    def test_a_role_that_owns_only_its_role_loop_fails(self):
        d = copy()
        def strip(j):
            for l in j["loops"]:
                if l["owner"] == "program-manager" and l["id"] != "role-program-manager":
                    l["owner"] = "operations"
        edit(d, "instances/ultrastable/loop-registry.json", strip)
        self.assertTrue(any(b.startswith("program-manager: owns no loop") for b in M.check(d)))

    def test_a_loop_owned_by_no_manager_fails(self):
        d = copy()
        def orphan(j):
            next(l for l in j["loops"] if l["id"] == "fleet-lane")["owner"] = "system"
        edit(d, "instances/ultrastable/loop-registry.json", orphan)
        self.assertTrue(any("fleet-lane" in b and "owner system is not a manager role" in b for b in M.check(d)))

    def test_missing_code_clock_probe_or_settler_fails(self):
        for field, value, want in (("runs", ["foundation/nothing_here.py"], "does not exist"), ("runs", [], "no code"), ("clock", [], "no clock"),
                                   ("clock", ["clock:not-a-clock"], "not in doctrine/clocks.json"), ("clock", ["workflow:checks.yml"], "no schedule"),
                                   ("probe", "file:agents/roles/uiux-manager.md", "its own role file"), ("probe", "cmd:python3 -m foundation nomodule --check", "does not exist"),
                                   ("settles", "", "only files items never closes a loop"), ("settles", "grep:foundation/uiux.py::def no_such_function", "does not contain")):
            d = copy()
            if value == ["workflow:checks.yml"]:
                (d / ".github/workflows/checks.yml").write_text("on:\n  pull_request:\n")
            edit(d, M.POLICY, lambda j: j["roles"]["uiux-manager"].__setitem__(field, value))
            bad = M.check(d)
            self.assertTrue(any(b.startswith("uiux-manager") and want in b for b in bad), (field, value, bad))

    def test_the_seed_must_carry_every_platform_manager_or_a_reason(self):
        d = copy()
        (d / "seed/agents/roles/design-manager.md").unlink()
        edit(d, "seed/autonomy/managers.json", lambda j: j.__setitem__("managers", [m for m in j["managers"] if m["id"] != "design-manager"]))
        edit(d, "seed/ultrastable.json", lambda j: j.__setitem__("roles", [m for m in j["roles"] if m["id"] != "design-manager"]))
        bad = M.check(d)
        self.assertTrue(any("design-manager: a platform manager the seed lacks" in b for b in bad), bad)
        edit(d, M.POLICY, lambda j: (j["seed_absent"].__setitem__("design-manager", "the design language is served to seeds by the platform"), j["roles"]["design-manager"].__setitem__("clock", ["clock:a11y"])))
        M.sync_roles(d)  # the clock changed, so the role file is regenerated
        self.assertEqual(M.check(d), [])

    def test_a_seed_manager_the_platform_lacks_needs_a_reason(self):
        d = copy()
        (d / "seed/agents/roles/night-watch.md").write_text("# Role: night-watch\n")
        self.assertTrue(any(b.startswith("night-watch: a seed manager the platform lacks") for b in M.check(d)))

    def test_register_and_bootstrap_roster_are_one_truth(self):
        d = copy()
        edit(d, "seed/autonomy/managers.json", lambda j: j["managers"][0].__setitem__("tick_every", 99))
        self.assertTrue(any("tick_every/count differ" in b for b in M.check(d)))

    def test_unsafe_switches_fail(self):
        d = copy()
        edit(d, "seed/autonomy/managers.json", lambda j: j.__setitem__("switch", {"operations": {"state": "off", "reason": "cost"}, "design-manager": {"state": "off", "reason": ""}, "ghost": "off"}))
        bad = "\n".join(M.check(d))
        self.assertIn("operations: switch refused: core manager cannot be switched off", bad)
        self.assertIn("design-manager: switch refused: off switch has no reason", bad)
        self.assertIn("switch names ghost", bad)

    def test_a_reasoned_switch_is_accepted(self):
        d = copy()
        edit(d, "seed/autonomy/managers.json", lambda j: j.__setitem__("switch", {"funding-manager": {"state": "off", "reason": "the owner pays the running cost"}}))
        self.assertEqual(M.check(d), [])
        self.assertFalse(next(m for m in M.seed_roster(json.loads((d / "seed/autonomy/managers.json").read_text())) if m["id"] == "funding-manager")["on"])

    def test_a_role_file_that_does_not_name_its_loops_and_code_fails_and_sync_repairs_it(self):
        d = copy()
        f = d / "agents/roles/program-manager.md"
        f.write_text(f.read_text().replace("`fleet-lane`", "`something-else`"))
        self.assertTrue(any(b.startswith("agents/roles/program-manager.md") and "stale" in b for b in M.check(d)))
        self.assertEqual(M.sync_roles(d), ["agents/roles/program-manager.md"])
        self.assertEqual(M.check(d), [])
        self.assertIn("`fleet-lane`", f.read_text())
        self.assertIn("autonomy/managers.json", (d / "seed/agents/roles/program-manager.md").read_text())

    def test_the_tick_must_hire(self):
        d = copy()
        (d / "seed/worker/src/tick.js").write_text("// no hire\n")
        self.assertTrue(any("does not call hireStep" in b for b in M.check(d)))


class Live(unittest.TestCase):
    def test_missing_late_stopped_and_ticking_are_told_apart(self):
        rows = {r["id"]: r for r in M.live(REPO, payload=agents([("operations", 300), ("staff", 2400), ("reviewer", 90000), ("portfolio-manager", 3000)]))}
        self.assertEqual(rows["operations"]["state"], "ticking")
        self.assertEqual(rows["staff"]["state"], "late")        # due every 600 s, late past 3 intervals
        self.assertEqual(rows["reviewer"]["state"], "stopped")  # past 12 intervals
        self.assertEqual(rows["portfolio-manager"]["state"], "ticking")  # due every 6 ticks
        self.assertEqual(rows["program-manager"]["state"], "missing")
        self.assertEqual(rows["operations"]["dispatches"], 4)

    def test_an_off_manager_is_never_a_failure_and_an_unreadable_runtime_is_unmeasured(self):
        d = copy()
        edit(d, "seed/autonomy/managers.json", lambda j: j.__setitem__("switch", {"funding-manager": {"state": "off", "reason": "self-funded"}}))
        rows = {r["id"]: r for r in M.live(d, payload=agents([]))}
        self.assertEqual(rows["funding-manager"]["state"], "off")
        def down(*a):
            raise OSError("no route")
        self.assertTrue(all(r["state"] == "unmeasured" for r in M.live(REPO, fetch=down)))


class Matrix(unittest.TestCase):
    def test_every_role_has_a_row_with_loops_code_and_seed_parity(self):
        m = M.matrix(REPO)
        self.assertEqual([r["role"] for r in m], M.role_files(REPO, "platform"))
        for r in m:
            self.assertTrue(r["loops"] and r["runs"] and r["clock"] and r["probe"] and r["settles"] and r["in_seed"] and r["seed_on"], r["role"])

    def test_items_are_counted_by_owner_and_ending(self):
        d = copy()
        for i, (st, disp) in enumerate((("open", ""), ("closed", "fixed"), ("closed", "shelved"), ("closed", ""))):
            (d / f"docs/issues/Q-T-{i}.json").write_text(json.dumps({"id": f"Q-T-{i}", "body": f"**Owner:** uiux-manager\n**Status:** {st}\n" + (f"\n**Disposition:** {disp} (x)\n" if disp else "")}))
        self.assertEqual(M.items_by_owner(d)["uiux-manager"], {"open": 1, "fixed": 1, "shelved": 1, "closed": 1})

    def test_a_manager_whose_items_mostly_end_shelved_is_over(self):
        d = copy()
        for i in range(6):
            (d / f"docs/issues/Q-S-{i}.json").write_text(json.dumps({"id": f"Q-S-{i}", "body": "**Owner:** reviewer\n**Status:** closed\n\n**Disposition:** " + ("fixed" if i < 2 else "shelved") + " (x)\n"}))
        rows = {r["role"]: r for r in M.closure(d)}
        self.assertTrue(rows["reviewer"]["over"])
        self.assertEqual(rows["reviewer"]["shelved_share"], 0.667)
        self.assertFalse(rows["staff"]["over"])  # nothing ended: not judged

    def test_a_scheduled_manager_workflow_outside_the_clock_register_is_listed(self):
        rows = M.unclocked(REPO)
        clocks = {c.get("workflow") for c in json.loads((REPO / "doctrine/clocks.json").read_text())["clocks"]}
        self.assertTrue(all(r["workflow"][:-4] not in clocks for r in rows))
        self.assertNotIn({"role": "design-manager", "workflow": "a11y.yml"}, rows)


class Alignment(unittest.TestCase):
    """ROLE-ALIGN-1: every role names its human counterpart, its decisions, its inputs and its hand-offs; every software function has an owner or an item."""

    def bad(self, fn, rel=M.POLICY):
        d = copy()
        edit(d, rel, fn)
        return M.check(d)

    def test_every_role_is_aligned_and_every_function_is_in_the_map(self):
        a = M.alignment(REPO)
        self.assertEqual(len(a["roles"]), len(M.role_files(REPO, "platform")))
        self.assertTrue(all(r[k] for r in a["roles"] for k in M.ALIGN))
        self.assertEqual(sorted(f["id"] for f in a["functions"]), sorted(M.FUNCTIONS))
        self.assertEqual(a["covered"] + len(a["gaps"]), len(M.FUNCTIONS))

    def test_a_role_missing_an_alignment_field_fails(self):
        for k, needle in (("human_role", "no human_role"), ("decides", "decides is missing"), ("inputs", "inputs is missing"), ("hands_to", "hands_to is missing"), ("cadence", "no cadence")):
            with self.subTest(k):
                self.assertTrue(any("staff" in b and needle in b for b in self.bad(lambda j: j["roles"]["staff"].pop(k))))

    def test_an_input_that_does_not_exist_fails(self):
        self.assertTrue(any("reviewer: input ops/no-such-ledger.jsonl does not exist" in b for b in self.bad(lambda j: j["roles"]["reviewer"]["inputs"].append("ops/no-such-ledger.jsonl"))))

    def test_a_hand_off_to_nobody_or_to_itself_fails(self):
        self.assertTrue(any("hands_to chief-of-vibes, which is not a role" in b for b in self.bad(lambda j: j["roles"]["staff"]["hands_to"].append("chief-of-vibes"))))
        self.assertTrue(any("staff: hands_to itself" in b for b in self.bad(lambda j: j["roles"]["staff"]["hands_to"].append("staff"))))

    def test_the_seed_register_tells_the_same_alignment(self):
        def drift(j):
            next(m for m in j["managers"] if m["id"] == "reviewer")["human_role"] = "something else"
        self.assertTrue(any("reviewer: human_role differs" in b for b in self.bad(drift, "seed/autonomy/managers.json")))

    def test_a_function_left_out_of_the_map_fails(self):
        def drop(j):
            j["software_roles"] = [f for f in j["software_roles"] if f["id"] != "qa-test"]
        self.assertTrue(any("the function qa-test is not in the coverage map" in b for b in self.bad(drop)))

    def row(self, j, fid):
        return next(f for f in j["software_roles"] if f["id"] == fid)

    def test_covered_needs_a_role_that_owns_the_code(self):
        self.assertTrue(any("code-review" in b and "covered needs at least one role and one code path" in b for b in self.bad(lambda j: self.row(j, "code-review").update(code=[]))))
        self.assertTrue(any("code-review" in b and "foundation/pm.py is owned by none of reviewer" in b for b in self.bad(lambda j: self.row(j, "code-review")["code"].append("foundation/pm.py"))))
        self.assertTrue(any("code-review" in b and "funding-manager is named and owns none" in b for b in self.bad(lambda j: self.row(j, "code-review")["roles"].append("funding-manager"))))
        self.assertTrue(any("code-review" in b and "nobody is not a role" in b for b in self.bad(lambda j: self.row(j, "code-review")["roles"].append("nobody"))))

    def test_a_gap_needs_a_filed_item(self):
        self.assertTrue(any("sales-partnerships" in b and "a gap needs" in b for b in self.bad(lambda j: self.row(j, "sales-partnerships").pop("item"))))
        self.assertTrue(any("Q-ROLE-nowhere is not filed" in b for b in self.bad(lambda j: self.row(j, "sales-partnerships").update(item="Q-ROLE-nowhere"))))
        self.assertTrue(any("Q-MANAGERS-clocks is not a Q-ROLE-* item" in b for b in self.bad(lambda j: self.row(j, "sales-partnerships").update(item="Q-MANAGERS-clocks"))))
        self.assertTrue(any("`missing` with no item" in b for b in self.bad(lambda j: self.row(j, "security").pop("item"))))

    def test_a_shelved_item_still_stands_for_its_gap_and_a_fixed_one_does_not(self):
        d = copy()
        p = d / "docs/issues/Q-ROLE-sales-partnerships.json"
        j = json.loads(p.read_text())
        open_body = re.sub(r"(?m)^\*\*Disposition:\*\*.*\n?", "", re.sub(r"\*\*Status:\*\*\s*\w+", "**Status:** open", j["body"]))
        j["body"] = open_body.replace("**Status:** open", "**Status:** closed") + "\n**Disposition:** shelved (ttl)\n"
        p.write_text(json.dumps(j))
        self.assertEqual(M.item_state(d, "Q-ROLE-sales-partnerships"), "shelved")
        self.assertEqual(M.check(d), [])
        j["body"] = open_body.replace("**Status:** open", "**Status:** closed") + "\n**Disposition:** fixed (probe)\n"
        p.write_text(json.dumps(j))
        self.assertTrue(any("ended fixed" in b for b in M.check(d)))

    def test_the_role_file_block_shows_the_alignment(self):
        r = json.loads((REPO / M.POLICY).read_text())["roles"]["reviewer"]
        for tree in ("platform", "seed"):
            block = M.role_block(REPO, "reviewer", tree)
            self.assertIn("**Stands in for:** " + r["human_role"], block)
            self.assertIn(r["decides"][0], block)
            self.assertIn("`operations`", block)
        self.assertIn("**Reads:**", M.role_block(REPO, "reviewer", "platform"))

    def test_every_scheduled_manager_workflow_is_a_clock(self):
        self.assertEqual(M.unclocked(REPO), [])


if __name__ == "__main__":
    unittest.main()
