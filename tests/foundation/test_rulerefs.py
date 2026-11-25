# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""RULE-REFS-1: every path, command, test, workflow and endpoint a rule file names resolves; code nothing names is listed and only shrinks."""
import json, unittest
from pathlib import Path
from foundation import rulerefs as R
from _repo import scratch

REPO = Path(__file__).resolve().parents[2]
POL = {"sources": ["agents/AGENTS.md"], "roots": ["seed/"], "route_globs": ["site/*.js"], "word_globs": ["agents/*.md"], "caller_globs": [],
       "hosts": ["ultrastable.io"], "loop_registry": "loops.json", "site_router": "site/*.js", "repositories": ["ultrastable/ops"],
       "external": [], "corrections": [], "undescribed": {"modules": [], "workflows": [], "routes": []}}
MAIN = 'def main(_av):\n    if _av[:1] == ["real"]:\n        from . import real\n'


def tree(rules, pol=None, extra=None):
    d = scratch()
    files = {"agents/AGENTS.md": rules, R.POLICY: json.dumps({**POL, **(pol or {})}), "foundation/__main__.py": MAIN,
             "foundation/real.py": 'import sys\nA = ["--check", "--probe"]\n', "tests/foundation/test_real.py": "", "seed/scripts/claims.py": "",
             ".github/workflows/checks.yml": "", "site/worker.js": 'if (u.pathname === "/live") x();\nif (u.pathname === "/year.json") y();\nif (/^\\/s\\//.test(p)) z();\n',
             "loops.json": json.dumps({"loops": [{"id": "ci", "workflow": "checks.yml"}]}), **(extra or {})}
    for rel, text in files.items():
        (d / rel).parent.mkdir(parents=True, exist_ok=True)
        (d / rel).write_text(text, encoding="utf-8")
    return d


def statuses(d):
    return {r["ref"]: r["status"] for r in R.resolve(d, siblings=d / "none")}


class Classify(unittest.TestCase):
    def test_kinds(self):
        c = lambda t: (R.classify(t) or (None,))[0]
        self.assertEqual(c("python3 -m foundation claims --check"), "command")
        self.assertEqual(c("python3 -m foundation.tenantsync --check"), "command")
        self.assertEqual(c("node --test seed/worker/test/handoff.test.js"), "script")
        self.assertEqual(c("foundation/claims.py"), "path")
        self.assertEqual(c("tests/foundation/test_reach.py (ConnectLink)"), "path")
        self.assertEqual(c("checks.yml"), "file")
        self.assertEqual(c("/api/freshness"), "route")
        self.assertEqual(c("GET /api/audit/verify?deep=1"), "route")
        self.assertEqual(c("POST https://ultrastable.io/api/directory/register"), "route")
        self.assertEqual(c("/year.json"), "route")

    def test_ids_formulas_and_fields_are_not_references(self):
        for t in ("Q-OPENLOOP-*", "entered = open + closed + superseded", "k_self", "HALT=1", "idle_ttl_hours", "<metric> <op> <number> within <N> h", "24/7"):
            self.assertIsNone(R.classify(t), t)


class Resolve(unittest.TestCase):
    def test_existing_references_resolve(self):
        s = statuses(tree("Code `foundation/real.py`, tests `tests/foundation/test_real.py`, check `python3 -m foundation real --check`, "
                          "workflow `checks.yml`, seed path `scripts/claims.py`, page `/live`, feed `/year.json`, repo `ultrastable/ops`."))
        self.assertEqual(set(s.values()), {"ok"}, s)

    def test_missing_file_command_flag_and_route_dangle(self):
        d = tree("`foundation/gone.py` `python3 -m foundation gone --check` `python3 -m foundation real --nope` `/nowhere` `gone.yml` `python3 scripts/gone.py --x`")
        s = statuses(d)
        self.assertEqual(set(s.values()), {"dangling"}, s)
        self.assertEqual(len(R.check(d, siblings=d / "none")), 6)

    def test_a_route_is_not_proven_by_a_longer_route(self):
        self.assertEqual(statuses(tree("`/year`"))["/year"], "dangling")

    def test_short_form_command_is_checked_against_its_module(self):
        s = statuses(tree("`real --probe ID` and `real --nope` and `other --flag`"))
        self.assertEqual(s, {"real --probe ID": "ok", "real --nope": "dangling"})

    def test_allowlist_needs_a_reason_and_must_be_needed(self):
        ext = [{"ref": "agent/*", "reason": "A git branch name pattern, not a file path."}]
        d = tree("Branch `agent/*`.", {"external": ext})
        self.assertEqual(statuses(d)["agent/*"], "external")
        self.assertEqual(R.check(d, siblings=d / "none"), [])
        d = tree("Branch `agent/*`.", {"external": [{"ref": "agent/*", "reason": "short"}]})
        self.assertTrue(any("needs a reason" in e for e in R.check(d, siblings=d / "none")))
        d = tree("Code `foundation/real.py`.", {"external": [{"ref": "foundation/real.py", "reason": "pretends to live in another repository"}]})
        self.assertTrue(any("resolves here" in e for e in R.check(d, siblings=d / "none")))
        d = tree("Nothing.", {"external": ext})
        self.assertTrue(any("no rule file carries" in e for e in R.check(d, siblings=d / "none")))

    def test_allowlisted_sibling_path_is_verified_when_the_clone_is_present(self):
        ext = [{"ref": "upstream.json", "reason": "A file at the root of a tenant repository.", "repo": "tenant", "path": "upstream.json"}]
        d = tree("Tenant file `upstream.json`.", {"external": ext})
        sib = scratch()
        (sib / "tenant").mkdir()
        self.assertEqual({r["ref"]: r["status"] for r in R.resolve(d, siblings=sib)}["upstream.json"], "dangling")
        (sib / "tenant/upstream.json").write_text("{}")
        self.assertEqual({r["ref"]: r["status"] for r in R.resolve(d, siblings=sib)}["upstream.json"], "external")

    def test_a_recorded_correction_is_reported_and_does_not_hide_other_dangling(self):
        d = tree("`tools/connect.mjs` and `foundation/gone.py`", {"corrections": [{"ref": "tools/connect.mjs", "correct": "tools/connections.mjs", "reason": "renamed"}]})
        s = statuses(d)
        self.assertEqual((s["tools/connect.mjs"], s["foundation/gone.py"]), ("wrong", "dangling"))


class Reverse(unittest.TestCase):
    def test_new_undescribed_code_fails_and_a_described_row_must_leave(self):
        d = tree("Code `foundation/real.py`, pages `/live` and `/year.json`.", extra={"foundation/orphan.py": "", ".github/workflows/stray.yml": "", "site/x.js": 'if (u.pathname === "/hidden") h();\n'})
        errs = "\n".join(R.reverse_check(d))
        for needle in ("foundation/orphan.py", "stray.yml", "/hidden"):
            self.assertIn(needle, errs)
        self.assertNotIn("foundation/real.py:", errs)
        self.assertNotIn("checks.yml", errs)
        pol = json.loads((d / R.POLICY).read_text())
        pol["undescribed"] = {"modules": ["foundation/orphan.py", "foundation/real.py"], "workflows": ["stray.yml"], "routes": ["/hidden"]}
        (d / R.POLICY).write_text(json.dumps(pol))
        errs = R.reverse_check(d)
        self.assertEqual(len(errs), 1, errs)
        self.assertIn("shrink-only", errs[0])


class SeedGap(unittest.TestCase):
    def test_a_rule_the_seed_cannot_run_is_counted(self):
        pol = {"sources": ["seed/agents/AGENTS.md"]}
        d = tree("", pol, extra={"seed/agents/AGENTS.md": "`scripts/claims.py` `seed/scripts/claims.py` `foundation/real.py` `python3 -m foundation real --check`"})
        g = R.seed_gap(d)
        self.assertEqual((g["total"], sorted(r["ref"] for r in g["missing"])), (4, ["foundation/real.py", "python3 -m foundation real --check"]))


class Live(unittest.TestCase):
    def test_get_only_no_placeholders_and_404_fails(self):
        d = tree("`/live` `/year.json` `POST /live` `/s/<id>/own`", extra={"site/worker.js": 'if (u.pathname === "/live") x();\nif (u.pathname === "/year.json") y();\nif (p.startsWith("/s/")) z();\n'})
        seen = []
        def get(url):
            seen.append(url); return 404 if url.endswith("/year.json") else 401
        res = {x["path"]: x["ok"] for x in R.live(d, get=get)}
        self.assertEqual(res, {"/live": True, "/year.json": False})
        self.assertEqual(seen, ["https://ultrastable.io/live", "https://ultrastable.io/year.json"])


class ThisRepository(unittest.TestCase):
    def test_every_rule_reference_resolves_and_nothing_new_is_undescribed(self):
        self.assertEqual(R.check(REPO) + R.reverse_check(REPO), [])

    def test_the_cli_is_dispatched_and_in_checks(self):
        self.assertIn('["rulerefs"]', (REPO / "foundation/__main__.py").read_text())
        self.assertIn("foundation rulerefs --check", (REPO / ".github/workflows/checks.yml").read_text())


if __name__ == "__main__":
    unittest.main()
