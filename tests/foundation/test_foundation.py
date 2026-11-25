"""Foundation tests. Ultrastable is the foundation for any autonomous system; these fixtures prove each autonomous route and its fallback."""
import json, subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import doctrine, filing, ladder, manifest as mf, minutes, ownersteps, scaffold  # noqa: E402

BASE = {"name": "Tool Library", "slug": "tool-library", "kind": "community", "goals": ["A booking prototype"],
        "owner": {"name": "Ada", "jurisdiction": "DE"}}


def ctx(env=None, tools=None, runs=None, http=None, exists=()):
    tools, runs = tools or {}, runs or {}
    return ownersteps.StepCtx(env=env or {}, which=lambda t: tools.get(t), run=lambda argv: runs.get(argv[0], (1, "")),
                              exists=lambda p: p in exists, http=http)


class Manifest(unittest.TestCase):
    def test_valid_minimal(self):
        self.assertEqual(mf.validate(BASE), [])

    def test_rejects_secret_email_and_bad_gate(self):
        bad = dict(BASE, notes="a@b.co", token="ghp_" + "a" * 36)
        p = mf.validate(bad)
        self.assertTrue(any("secret" in x for x in p) and any("e-mail" in x for x in p))
        self.assertTrue(mf.validate(dict(BASE, disclosure={"gate": "filed", "public_allowed": True})))

    def test_shipped_instances_valid(self):
        for s in ("ultrastable", "qnfo"):
            self.assertEqual(mf.validate(mf.load(ROOT / "instances" / s / "instance.json")), [], s)

    def test_brands_stay_separate(self):
        u, q = (mf.load(ROOT / "instances" / s / "instance.json") for s in ("ultrastable", "qnfo"))
        self.assertIn("QNFO", u["brand"]["separate_from"])
        self.assertIn("Ultrastable", q["brand"]["separate_from"])


class Ladder(unittest.TestCase):
    def test_env_route_wins_first(self):
        r = ladder.acquire("org_admin", ctx(env={"ORG_ADMIN_TOKEN": "x"}))
        self.assertEqual((r["status"], r["via"], len(r["attempts"])), ("acquired", "env-token", 1))

    def test_device_login_scope_found_after_denials(self):  # BG-13: the credential was already on the device
        c = ctx(env={"GITHUB_ACTIONS": "true"}, tools={"gh": "/bin/gh"}, runs={"gh": (0, "Token scopes: repo, admin:org")})
        r = ladder.acquire("org_admin", c)
        self.assertEqual(r["via"], "gh-login-admin-org")
        self.assertEqual([a["ok"] for a in r["attempts"]], [False, True])

    def test_a_sign_in_on_a_host_that_is_not_server_side_is_not_a_route(self):  # OL-20261112-93
        r = ladder.acquire("org_admin", ctx(tools={"gh": "/bin/gh"}, runs={"gh": (0, "Token scopes: repo, admin:org")}))
        self.assertNotEqual(r.get("via"), "gh-login-admin-org")
        self.assertIn("not server-side", " ".join(a["evidence"] if "evidence" in a else str(a) for a in r["attempts"]))

    def test_all_routes_fail_opens_exactly_one_card_with_every_denial_recorded(self):
        r = ladder.acquire("org_admin", ctx())
        self.assertEqual(r["status"], "carded")
        self.assertEqual(len(r["attempts"]), 3)
        self.assertTrue(r["card"]["line"].startswith("IDENTITY-BOUND"))
        self.assertTrue(r["card"]["default_in_effect"] and r["card"]["closing_probe"])

    def test_scope_absent_is_denial_not_success(self):
        c = ctx(tools={"gh": "/bin/gh"}, runs={"gh": (0, "Token scopes: repo")})
        self.assertEqual(ladder.acquire("org_admin", c)["status"], "carded")

    def test_never_reads_values(self):
        r = ladder.acquire("model_api", ctx(env={"ANTHROPIC_API_KEY": "sk-ant-SECRETVALUE"}))
        self.assertNotIn("SECRETVALUE", json.dumps(r))


class Filing(unittest.TestCase):
    def m(self, j, **ip):
        return mf.resolve({**BASE, "owner": {"jurisdiction": j}, "ip": {"has_invention": True, **ip}})

    def test_foreign_owner_gets_practitioner_rule_and_home_route(self):
        p = filing.plan(self.m("NL"))
        self.assertIn("practitioner", " ".join(p["notes"]))
        self.assertTrue(any("Octrooicentrum" in r for r in p["routes"]))
        self.assertEqual(p["card"]["id"], "FILE-PRIORITY")

    def test_us_owner_self_files(self):
        p = filing.plan(self.m("US"))
        self.assertEqual(p["notes"] if "notes" in p else [], [])
        self.assertTrue(any("USPTO" in r for r in p["routes"]))

    def test_unknown_country_researches_never_guesses(self):
        p = filing.plan(self.m("BR"))
        self.assertTrue(any("no route is chosen from memory" in r for r in p["routes"]))

    def test_unknown_domicile_asked_once(self):
        self.assertTrue(any("domicile" in r for r in filing.plan(self.m(""))["routes"]))

    def test_portal_down_prepends_fallback(self):
        self.assertIn("Portal down", filing.plan(self.m("NL"), portal_ok=False)["routes"][0])

    def test_no_invention_or_filed_means_no_card(self):
        self.assertIsNone(filing.plan(mf.resolve(BASE))["card"])
        self.assertIsNone(filing.plan(self.m("NL", priority_filed=True))["card"])


class OwnerSteps(unittest.TestCase):
    def run_all(self, c, **over):
        m = mf.resolve({**BASE, "funding": {"routes": [{"id": "grants"}]}, "ip": {"has_invention": True}, **over})
        c.facts = mf.facts_for(m)
        with tempfile.TemporaryDirectory() as d:
            return ownersteps.evaluate_all(m, c, d)

    def test_credential_found_means_automated_no_card(self):
        res = self.run_all(ctx(env={"ORG_ADMIN_TOKEN": "x", "CLOUDFLARE_API_TOKEN": "x", "CLOUDFLARE_ACCOUNT_ID": "x"}))
        by = {r["id"]: r for r in res["results"]}
        self.assertEqual((by["OS-3"]["status"], by["OS-4"]["status"]), ("automated", "automated"))
        self.assertNotIn("ORG-TOKEN", [c["id"] for c in res["cards"]])

    def test_everything_failing_gives_prepared_cards_each_with_default_and_probe(self):
        res = self.run_all(ctx())
        for card in res["cards"]:
            self.assertTrue(card["line"].startswith("IDENTITY-BOUND") and card["default_in_effect"] and card["closing_probe"], card["id"])
        ids = [c["id"] for c in res["cards"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn("FILE-PRIORITY", ids)

    def test_non_identity_step_never_becomes_a_card(self):
        res = self.run_all(ctx())
        os9 = [r for r in res["results"] if r["id"] == "OS-9"][0]
        self.assertEqual((os9["status"], os9["card"]), ("degraded", None))
        self.assertIn("backlog", os9)

    def test_email_alias_created_with_fixture_and_refusal_not_circumvented(self):
        calls = []
        env = {"CLOUDFLARE_ZONE_ID": "z", "CLOUDFLARE_ACCOUNT_ID": "a", "OWNER_CONTACT": "dest"}
        ok = ctx(env=env, http=lambda m_, u, b: (calls.append((m_, u)) or (200, {})))
        m = mf.resolve({**BASE, "domain": "example.org"})
        with tempfile.TemporaryDirectory() as d:
            step = [s for s in json.loads(ownersteps.DATA.read_text())["steps"] if s["id"] == "OS-9"][0]
            c = ownersteps.evaluate(step, m, ok, d, apply=True)
            self.assertEqual(c["status"], "automated")
            self.assertEqual(len(calls), 2)
            calls.clear()
            denied = ctx(env=env, http=lambda m_, u, b: (calls.append(u) or (403, {})))
            c = ownersteps.evaluate(step, m, denied, d, apply=True)
            self.assertEqual(c["status"], "degraded")
            self.assertEqual(len(calls), 1)  # one refusal, no retry through another path

    def test_handler_exception_is_recorded_not_swallowed(self):
        from foundation import handlers
        old = handlers.REGISTRY["funding_packets"]
        handlers.REGISTRY["funding_packets"] = lambda *a: 1 / 0
        try:
            res = self.run_all(ctx())
        finally:
            handlers.REGISTRY["funding_packets"] = old
        os7 = [r for r in res["results"] if r["id"] == "OS-7"][0]
        self.assertIn("ZeroDivisionError", os7["failures"][0]["error"])
        self.assertEqual(os7["status"], "prepared")

    def test_every_owner_step_in_the_document_is_encoded(self):
        steps = json.loads(ownersteps.DATA.read_text())["steps"]
        doc = (ROOT / "docs/ops/OWNER-STEPS.md").read_text()
        import re
        n = len(re.findall(r"^\| \d+ \|", doc, re.M))
        self.assertGreaterEqual(len([s for s in steps if s["id"] != "OS-9"]), n)


class Doctrine(unittest.TestCase):
    def test_repo_is_consistent_with_the_doctrine_file(self):
        self.assertEqual(doctrine.check(ROOT), [])

    def test_tagline_constant_comes_from_the_file(self):
        from foundation import TAGLINE
        self.assertEqual(TAGLINE, doctrine.load(ROOT)["tagline"])

    def test_check_flags_missing_contradiction_and_external_memory_and_apply_fixes(self):
        import shutil
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "doctrine").mkdir()
            shutil.copy2(ROOT / "doctrine/positioning.json", Path(d) / "doctrine/positioning.json")
            (Path(d) / "docs").mkdir(); (Path(d) / "agents").mkdir()
            (Path(d) / "docs/PROJECT-MEMORY.md").write_text("# Memory\n")
            (Path(d) / "README.md").write_text("# X\nUltrastable is only a tool.\n")
            (Path(d) / "agents/AGENTS.md").write_text("# A\nSave it to tool memory.\n")
            bad = doctrine.check(d)
            self.assertTrue(any("lacks the positioning" in b for b in bad))
            self.assertTrue(any("contradicts" in b for b in bad))
            self.assertTrue(any("external memory" in b for b in bad))
            self.assertTrue(any("memory rule" in b for b in bad))
            self.assertIn("README.md", doctrine.apply(d))
            self.assertFalse(any("lacks the positioning" in b for b in doctrine.check(d)))

    def test_zero_fuss_rule_is_required_and_flags_setup_burden(self):
        import shutil
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "doctrine").mkdir()
            shutil.copy2(ROOT / "doctrine/positioning.json", Path(d) / "doctrine/positioning.json")
            (Path(d) / "docs").mkdir(); (Path(d) / "agents").mkdir(); (Path(d) / "seed").mkdir()
            (Path(d) / "docs/PROJECT-MEMORY.md").write_text("# Memory\n")
            (Path(d) / "agents/AGENTS.md").write_text("# A\n")
            (Path(d) / "seed/README.md").write_text("# S\nYou need to generate an API key first.\n")
            bad = doctrine.check(d)
            self.assertTrue(any("zero-fuss rule ('" in b for b in bad))
            self.assertTrue(any("makes the user do setup work" in b for b in bad))
        self.assertEqual([b for b in doctrine.check(ROOT) if "zero-fuss" in b], [])

    def test_first_run_needs_only_a_name_and_a_goal(self):
        """Zero-fuss first-run probe: a manifest of just name + one goal must validate and generate with no prompt, key or config."""
        import json as _j
        raw = {"name": "Probe Org", "goals": ["Ship the first thing"]}
        self.assertEqual(mf.validate(raw), [])
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "m.json"; p.write_text(_j.dumps(raw))
            r = subprocess.run([sys.executable, "-m", "foundation", "new-system", "--manifest", str(p), "--out", str(Path(d) / "out"), "--date", "2026-01-01"],
                               cwd=ROOT, input="", capture_output=True, text=True, timeout=120)
            self.assertIn(r.returncode, (0,), r.stdout + r.stderr)
            self.assertNotIn("api key", (r.stdout + r.stderr).lower())

    def test_gaplint_reads_doctrine(self):
        r = subprocess.run([sys.executable, "-m", "gaplint", str(ROOT), "--rules", "GL008,GL009"], cwd=ROOT / "products/gaplint", capture_output=True, text=True, env={"PYTHONPATH": str(ROOT / "products/gaplint")})
        self.assertEqual(r.returncode, 0, r.stdout)


class Minutes(unittest.TestCase):
    def test_estimate_states(self):
        self.assertEqual(minutes.estimate([{"minutes_per_run": 3, "runs_per_month": 100}])["state"], "ok")
        self.assertEqual(minutes.estimate([{"minutes_per_run": 10, "runs_per_month": 200}])["state"], "pause")

    def test_lint_flags_a_cron_faster_than_daily_and_matrix(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "a.yml").write_text("# budget: x\n# trigger: x\n# free-alternative: x\non:\n  schedule:\n    - cron: '5 */6 * * *'\nconcurrency: {group: a}\njobs:\n  j:\n    runs-on: x\n    timeout-minutes: 1\n    strategy: {matrix: {a: [1]}}\n")
            got = minutes.check_dir(d)
            self.assertTrue(any("more often than daily" in g for g in got) and any("matrix" in g for g in got))
            (Path(d) / "a.yml").write_text((Path(d) / "a.yml").read_text().replace("5 */6 * * *", "5 6 * * *"))
            self.assertFalse(any("more often than daily" in g for g in minutes.check_dir(d)), "a daily clock is allowed")


class EndToEnd(unittest.TestCase):
    """Boots a fake new instance from a manifest, then runs the kernel bootstrap and gaplint on it."""
    def test_new_system_boots(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "tool-library"
            rep = scaffold.generate(BASE, out, "2026-11-10", ctx=ctx())
            self.assertEqual(rep["status"], "ok", rep)
            for rel in ("IDEA.md", "instance.json", "agents/AGENTS.md", "autonomy/policy.json", "docs/PROJECT-MEMORY.md", "org/owner-steps.json", "org/OWNER-CARD.md", "org/bootstrap-cases.json", ".github/workflows/checks.yml"):
                self.assertTrue((out / rel).exists(), rel)
            self.assertNotIn("funding-manager", (out / "ultrastable.json").read_text())  # no funding routes: no funding roles
            self.assertEqual(minutes.check_dir(out / ".github/workflows"), [])
            r = subprocess.run([sys.executable, "bootstrap/bootstrap.py", "--root", ".", "--dry-run"], cwd=out, capture_output=True, text=True)
            self.assertIn(r.returncode, (0, 2), r.stderr)
            self.assertTrue((out / "org/boot-log.json").exists(), r.stdout + r.stderr)
            g = subprocess.run([sys.executable, "-m", "gaplint", str(out)], cwd=ROOT / "products/gaplint", capture_output=True, text=True, env={"PYTHONPATH": str(ROOT / "products/gaplint")})
            self.assertEqual(g.returncode, 0, g.stdout + g.stderr)

    def test_scaffold_is_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            a = scaffold.generate(BASE, d, "2026-11-10", ctx=ctx())
            b = scaffold.generate(BASE, d, "2026-11-10", ctx=ctx())
            self.assertEqual(a, b)

    def test_invalid_manifest_refused(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                scaffold.generate({"name": "x"}, d, "2026-11-10")


if __name__ == "__main__":
    unittest.main()
