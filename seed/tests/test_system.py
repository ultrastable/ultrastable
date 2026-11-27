# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SYSTEM-SPEC-1: the kit carries its own definition, generated from its code, and every clause is probed here."""
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("system", KIT / "scripts" / "system.py")
system = importlib.util.module_from_spec(spec)
spec.loader.exec_module(system)


class SystemSpec(unittest.TestCase):
    def test_kit_passes_its_own_definition(self):
        self.assertEqual(system.check(KIT), [])

    def test_definition_covers_identity_run_bootstrap_autonomy_and_rules(self):
        md = (KIT / "SYSTEM.md").read_text()
        for h in ("## What an Ultrastable system is", "## How it runs", "## What an autonomous development system does", "## How it bootstraps",
                  "## How it deploys", "## Machine-readable by birth", "## How it becomes autonomous and reaches criticality", "## Standing rules"):
            self.assertIn(h, md)
        for word in ("`self-sustaining`", "`year_gate`", "`ignition`", "k_eff"):
            self.assertIn(word, md)
        self.assertNotIn("``", md, "an empty enforcement path (`seed/` stripped to nothing) is never listed")
        prose = (KIT / "doctrine/SYSTEM.md").read_text()
        for h in ("What an autonomous development system does", "Machine-readable by birth", "How it deploys"):
            self.assertIn(h, prose)

    def test_steps_run_in_step_order_each_with_its_own_whole_description(self):
        steps = system.tick_steps(KIT)
        order, _ = system.step_names(KIT)
        self.assertEqual([n for n, _ in steps], order)
        self.assertEqual(order[0], "migrate", "the schema comes first")
        d = dict(steps)
        self.assertTrue(d["unknowns"].startswith("UNKNOWNS-1"), d["unknowns"])
        self.assertNotIn("UNKNOWNS-1", d["goals"])
        for n, text in steps + system.boot_stages(KIT):  # each source comment ends its sentences, so a whole-sentence cut ends on a stop
            if text:
                self.assertRegex(text, r"[.!?)]$", f"{n} is cut mid-sentence: {text[-40:]!r}")
        self.assertEqual(system.cut("One two. Three four five.", limit=12), "One two.")
        self.assertEqual(system.cut("A first sentence longer than the limit. Next.", limit=10), "A first sentence longer than the limit.")
        names = [n for n, _ in system.boot_stages(KIT)]
        self.assertEqual(names[names.index("read") + 1], "adopt", "a stage guarded right after read is listed where it runs")

    def test_the_constitution_reads_the_same_tick_order(self):
        import importlib.util as u
        s = u.spec_from_file_location("constitution_t", KIT / "scripts" / "constitution.py"); c = u.module_from_spec(s); s.loader.exec_module(c)
        self.assertEqual(c._steps(KIT), system.step_names(KIT)[0])
        self.assertEqual(list(c.load(KIT)["run_loop"]["tick_steps"]), system.step_names(KIT)[0])

    def test_test_probes_are_named_tests_and_only_kit_tests_run(self):
        self.assertTrue(system.probe(KIT, "test:worker/test/tick.test.js::a failing step never kills the tick")[0])
        self.assertFalse(system.probe(KIT, "test:worker/test/tick.test.js::no test has this name")[0])
        self.assertFalse(system.probe(KIT, "test:scripts/system.py::def main")[0], "a script is not a test")
        self.assertEqual(system.test_argv(KIT, "tests/test_system.py")[1:], ["-m", "unittest", "tests.test_system"])
        for argv in (["sh", "-c", "true"], ["node", "--test", "../x.test.js"], ["node", "--test", "worker/src/tick.js"], ["python3", "-c", "1"]):
            self.assertFalse(system.allowed(KIT, argv), argv)
            self.assertFalse(system.run_test(KIT, argv)[0], argv)
        self.assertTrue(system.allowed(KIT, ["node", "--test", "worker/test/greenguard.test.js"]))
        ok, why = system.run_test(KIT, ["node", "--test", "worker/test/greenguard.test.js"])
        self.assertTrue(ok, why)

    def test_a_clause_proven_only_by_names_fails_and_the_presence_list_only_shrinks(self):
        k = self._copy()
        p = k / "autonomy" / "system.json"
        d = json.loads(p.read_text())
        run = next(s for s in d["sections"] if s["id"] == "run")
        run["clauses"][0]["probe"] = [x for x in run["clauses"][0]["probe"] if not x.startswith("test:")]
        d["presence_only"].append("ID-404")
        ident = next(s for s in d["sections"] if s["id"] == "identity")
        ident["clauses"][0]["probe"].append("test:worker/test/tick.test.js::a failing step never kills the tick")
        boot = next(s for s in d["sections"] if s["id"] == "bootstrap")  # a tested clause moved back onto the list once its test is dropped
        boot["clauses"][0]["probe"] = [x for x in boot["clauses"][0]["probe"] if not x.startswith("test:")]
        d["presence_only"].append(boot["clauses"][0]["id"])
        p.write_text(json.dumps(d))
        errs = system.check(k)
        self.assertTrue(any(e.startswith("RUN-1: only presence probes") for e in errs), errs)
        self.assertTrue(any("ID-404" in e for e in errs), errs)
        self.assertTrue(any(e.startswith("ID-1: has a test: probe now") for e in errs), errs)
        self.assertTrue(any(f"presence_only names {boot['clauses'][0]['id']}, which is not on PRESENCE_BASELINE" in e for e in errs), errs)

    def test_the_presence_list_names_only_bare_definitions(self):
        d = json.loads((KIT / "autonomy" / "system.json").read_text())
        self.assertLessEqual(set(d["presence_only"]), set(system.PRESENCE_BASELINE))
        self.assertLessEqual(set(system.PRESENCE_BASELINE), {"ID-1", "ID-2", "ID-3", "ID-4", "ID-5", "ID-6"}, "the baseline itself only shrinks")

    def test_a_clause_bound_to_a_test_a_seeded_system_cannot_run_whole_fails(self):
        k = self._copy()
        p = k / "autonomy" / "system.json"
        d = json.loads(p.read_text())
        boot = next(s for s in d["sections"] if s["id"] == "bootstrap")
        boot["clauses"][3]["probe"].append("test:worker/test/bootaccept.test.js::BOOT-ACCEPT-1: the public page carries the Built on Ultrastable footer")
        boot["clauses"][4]["probe"].append("test:worker/test/unknowns.test.js::UNKNOWNS-1")
        p.write_text(json.dumps(d))
        errs = system.check(k)
        self.assertTrue(any("bootaccept.test.js holds 'BOOT-ACCEPT-1: the platform deploy sets the bindings" in e for e in errs), errs)
        self.assertTrue(any("unknowns.test.js is monorepo-only" in e for e in errs), errs)
        self.assertFalse(any("budget.test.js" in e for e in errs), "a registered test with its own existsSync guard runs anywhere")

    def test_verify_live_accepts_the_boot_only_on_a_200_from_health(self):
        import sys
        import urllib.error
        from unittest import mock
        sys.path.insert(0, str(KIT / "bootstrap"))
        self.addCleanup(sys.path.remove, str(KIT / "bootstrap"))
        import bootstrap as bs

        class Resp:
            def __init__(self, status, body=b"{}"): self.status, self.body = status, body
            def read(self): return self.body
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def serve(codes):
            seen = []
            def urlopen(req, timeout=30):
                url = req.full_url
                if url.endswith("/workers/subdomain"):
                    return Resp(200, b'{"result": {"subdomain": "acct"}}')
                seen.append(url)
                code = codes.pop(0) if codes else 503
                if code != 200:
                    raise urllib.error.HTTPError(url, code, "unavailable", {}, None)
                return Resp(200, b'{"ok": true}')
            return urlopen, seen

        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d, True)
        b = bs.Boot(d, d / "org", apply=True)
        b.runtime = {"workers_dev": "true", "worker_name": "seed-x"}
        with mock.patch("time.sleep"):
            urlopen, seen = serve([503, 503, 200])  # 503 until the first complete tick, then 200
            with mock.patch("urllib.request.urlopen", urlopen):
                status, detail = b.verify_live()
            self.assertEqual(status, "ok", detail)
            self.assertEqual(seen, ["https://seed-x.acct.workers.dev/health"] * 3)
            urlopen, seen = serve([])  # serving but never a complete tick: not accepted
            with mock.patch("urllib.request.urlopen", urlopen):
                status, detail = b.verify_live()
            self.assertEqual(status, "blocked")
            self.assertIn("HTTP 503", detail)
        self.assertNotEqual(bs.Boot(d, d / "org", apply=False).verify_live()[0], "ok", "a dry run deploys nothing, so it proves nothing live")

    def test_the_constitution_reads_the_root_it_checks_after_its_first_root_is_gone(self):
        # a boot imports constitution once (bootstrap.py `constitute`); a later boot in the same process checks another root, after the first
        # root was removed, and must read that root's own scripts/system.py
        a = self._copy()
        import importlib.util as u
        s = u.spec_from_file_location("constitution_gone", a / "scripts" / "constitution.py"); c = u.module_from_spec(s); s.loader.exec_module(c)
        shutil.rmtree(a)
        self.assertEqual(c._steps(KIT), system.step_names(KIT)[0])
        self.assertEqual(c.check(KIT, instruction_files=["AGENTS.md", "agents/AGENTS.md"]), [])

    def test_the_prose_definition_names_only_what_the_kit_carries(self):
        k = self._copy()
        p = k / "doctrine" / "SYSTEM.md"
        p.write_text(p.read_text() + "\nPlatform: `foundation/not-in-a-kit.py` is fine here.\n\nBut `foundation/nowhere.py` is not.\n")
        errs = system.check(k)
        self.assertTrue(any("foundation/nowhere.py" in e for e in errs), errs)
        self.assertFalse(any("not-in-a-kit" in e for e in errs), errs)
        p.write_text(p.read_text().replace("credited loop-originated items) / (spend_units", "loop items) / (spend_units"))
        self.assertTrue(any("criticality formula" in e for e in system.check(k)))

    def test_a_tick_step_with_no_description_fails(self):
        k = self._copy()
        t = k / "worker" / "src" / "tick.js"
        t.write_text(t.read_text().replace("  // Roles whose tick is due pull the top ready item for their role and get a dispatch row.\n", ""))
        self.assertTrue(any("tick step dispatch has no description" in e for e in system.check(k)))

    def test_every_agent_entry_point_loads_it(self):
        claude = (KIT / "CLAUDE.md").read_text()
        self.assertTrue(claude.startswith("@SYSTEM.md") or "@AGENTS.md" in claude.splitlines())
        self.assertIn("SYSTEM.md", (KIT / "AGENTS.md").read_text())

    def _copy(self):
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d, True)
        dst = d / "kit"
        shutil.copytree(KIT, dst, ignore=shutil.ignore_patterns("node_modules", "__pycache__", "org"))
        return dst

    def test_files_a_boot_writes_do_not_make_the_definition_stale(self):
        k = self._copy()  # CLEANROOM-1 finding: org/owner-status.json appears at boot and used to change a rule's citation list
        (k / "org").mkdir(exist_ok=True)
        (k / "org" / "owner-status.json").write_text("{}\n")
        self.assertEqual(system.check(k), [])

    def test_a_clause_whose_code_is_gone_fails(self):
        k = self._copy()
        (k / "worker" / "src" / "ignition.js").write_text("// removed\n")
        errs = system.check(k)
        self.assertTrue(any(e.startswith("AUT-1") for e in errs), errs)

    def test_a_new_rule_with_no_enforcement_in_the_kit_fails(self):
        k = self._copy()
        a = k / "agents" / "AGENTS.md"
        a.write_text(a.read_text() + "\n- **A new rule (NEW-RULE-1, test).** Enforced by `foundation/nowhere.py`.\n")
        self.assertTrue(any(e.startswith("NEW-RULE-1") for e in system.check(k)))

    def test_not_in_kit_only_shrinks(self):
        k = self._copy()
        p = k / "autonomy" / "system.json"
        d = json.loads(p.read_text()); d["not_in_kit"].append("CLAIMS-1"); p.write_text(json.dumps(d))
        self.assertTrue(any("not_in_kit lists rules" in e for e in system.check(k)))

    def test_stale_document_fails(self):
        k = self._copy()
        (k / "SYSTEM.md").write_text("# hand edited\n")
        self.assertTrue(any("SYSTEM.md is stale" in e for e in system.check(k)))


if __name__ == "__main__":
    unittest.main()
