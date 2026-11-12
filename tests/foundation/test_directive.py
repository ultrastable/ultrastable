"""The guiding directive as code: text vs JSON, registers, durable facts, accounting, loop-breaker, provenance, scorecard, owner-handback lint."""
import unittest
from _repo import ROOT, copy_repo, edit
from foundation import directive


class Directive(unittest.TestCase):
    def test_repo_directive_clean(self):
        self.assertEqual(directive.check(ROOT), [])

    def test_text_drift_fails(self):
        r = copy_repo(); (r / "docs/doctrine/GUIDING-DIRECTIVE.md").write_text((r / "docs/doctrine/GUIDING-DIRECTIVE.md").read_text().replace("## 13. Control disposition mandate", "## 13. Renamed"))
        got = directive.check(r)
        self.assertTrue(any("13. Control disposition" in p for p in got) and any("byte copy" in p for p in got), got)

    def test_precedence_order_is_checked(self):
        r = copy_repo(); edit(r / "doctrine/directive.json", lambda d: d["precedence"].reverse())
        self.assertTrue(any("precedence" in p for p in directive.check(r)))

    def test_missing_durable_fact_fails(self):
        r = copy_repo(); edit(r / "doctrine/durable-facts.json", lambda d: d["facts"].append({"id": "x", "statement": "s", "probe": "grep:docs/PROJECT-MEMORY.md::a fact only in tool memory"}))
        self.assertTrue(any("exists only outside it" in p for p in directive.check(r)))

    def test_instruction_file_without_directive_fails(self):
        r = copy_repo(); p = r / "agents/roles/staff.md"; p.write_text(p.read_text().replace("GUIDING-DIRECTIVE", "x"))
        self.assertTrue(any("staff.md" in p for p in directive.check(r)))

    def test_register_rules(self):
        r = copy_repo(); edit(r / "doctrine/registers.json", lambda d: d["controls"][1].update(critical_path=True))
        self.assertTrue(any("critical path" in p for p in directive.check(r)))
        r = copy_repo(); edit(r / "doctrine/registers.json", lambda d: d["spofs"][0].update(second_path_exercised=""))
        self.assertTrue(any("exercised" in p for p in directive.check(r)))
        r = copy_repo(); edit(r / "doctrine/registers.json", lambda d: d["controls"][3].update(disposition="keep"))
        self.assertTrue(any("only the interrupt gate" in p for p in directive.check(r)))

    def test_accounting_invariant(self):
        ok = directive.accounting([{"id": 1, "state": "open"}, {"id": 2, "state": "closed", "disposition": "fixed", "evidence": "PR 1"}, {"id": 3, "state": "superseded", "evidence": "see 1"},
                                   {"id": 4, "state": "backlogged", "owner": "ops", "trigger": "t", "verification": "v"}])
        self.assertTrue(ok["balanced"], ok)
        bad = directive.accounting([{"id": 1, "state": "closed"}, {"id": 2, "state": "gone"}, {"id": 3, "state": "backlogged", "owner": "ops"}])
        self.assertEqual(len(bad["problems"]) >= 4, True, bad)
        self.assertEqual(directive.issue_ledger(ROOT)["entered"] > 0, True)

    def test_loop_breaker(self):
        h = [{"signature": "403", "approach": "api"}]
        self.assertEqual(directive.loop_breaker(h)["action"], "retry-allowed")
        h.append({"signature": "403", "approach": "api"})
        self.assertEqual(directive.loop_breaker(h)["action"], "mutate")
        h.append({"signature": "403", "approach": "cli"})
        self.assertEqual(directive.loop_breaker(h)["action"], "incident")
        h.append({"signature": "other", "approach": "cli"})
        self.assertEqual(directive.loop_breaker(h)["action"], "retry-allowed")

    def test_provenance(self):
        rec = {k: "x" for k in directive.load(ROOT)["provenance_fields"]}
        rec["surfaces_tested"] = ["cli"]
        self.assertEqual(directive.validate_provenance(rec), [])
        del rec["rollback_path"]
        self.assertEqual(directive.validate_provenance(rec), ["provenance lacks rollback_path"])

    def test_blocker_log_scorecard(self):
        ev = [{"kind": "action"}] * 9 + [{"kind": "stop", "justified": True},
              {"kind": "blocker", "surfaces_tested": ["cli", "rest_api", "dashboard_ui", "ci_workflow", "sibling_agent", "sub_agent", "composition", "self_modification"], "surfaces_available": 8, "reported_as_user_decision": False}]
        sc = directive.scorecard(ev)
        self.assertEqual((sc["autonomy_rate"], sc["blocker_survival_rate"], sc["surface_coverage"], sc["regressions"]), (0.9, 0.0, 1.0, []))
        ev.append({"kind": "blocker", "surfaces_tested": ["cli"], "surfaces_available": 8, "reported_as_user_decision": True})
        sc = directive.scorecard(ev)
        self.assertTrue({"blocker_survival_rate", "surface_coverage"} <= set(sc["regressions"]), sc)

    def test_lint_flags_owner_handback(self):
        got = {f["recognition"] for f in directive.lint("Option 1 is the API.\nThis is your decision.\nReady for your review.\nWould you prefer the CLI?\nPlease approve the merge.\nDone?\n")}
        self.assertTrue({"menu", "blocker-as-owner-issue", "courtesy-stop", "question-to-owner"} <= got, got)
        self.assertEqual(directive.lint("I merged the change on green CI and the probe passes.\nThe gate card IDENTITY-BOUND step has its default in effect.\n"), [])
        self.assertEqual(directive.lint("> Would you prefer\n`your decision`\n"), [])

    def test_bootstrap_without_memory(self):
        self.assertFalse([x for x in directive.bootstrap(ROOT) if x.startswith("MISSING") or "problems" in x])

    def test_probe_log_is_append_only(self):
        r = copy_repo(); (r / "doctrine/probe-log.jsonl").write_text('{"keep": 1}\n')
        rows = directive.probe_all(r)
        self.assertTrue(all(x["ok"] for x in rows), rows)
        self.assertEqual((r / "doctrine/probe-log.jsonl").read_text().splitlines()[0], '{"keep": 1}')


if __name__ == "__main__":
    unittest.main()
