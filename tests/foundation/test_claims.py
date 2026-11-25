# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CLAIMS-1: words must match code, in both directions."""
import json, shutil, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests/foundation"))
import _repo  # noqa: E402
from foundation import claims  # noqa: E402


def copy():
    td = _repo.scratch()
    for f in ("doctrine/claims.json", "README.md", "platform/adapters/README.md", "site/worker.js", "site/promote.js", "site/agentic.js", "site/claims-data.js", ".github/workflows/claims.yml", "tests/foundation/test_claims.py", "agents/AGENTS.md"):
        (td / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / f, td / f)
    for d in ("seed", "platform", "ops", "foundation", "instances", "doctrine", "site", "products"):
        shutil.copytree(ROOT / d, td / d, dirs_exist_ok=True, ignore=shutil.ignore_patterns("node_modules", "__pycache__", "assets"))
    reg = json.loads((ROOT / "doctrine/claims.json").read_text(encoding="utf-8"))   # every surface and every file a probe reads
    need = {c["surface"] for c in reg["claims"]} | {p.split(":", 1)[1].split("::")[0] for c in reg["claims"] + reg["modules"] for p in c["probe"] if p.split(":", 1)[0] in ("file", "grep", "json")} | {m["generator"] for m in reg["modules"]}
    for f in sorted(need):
        if (ROOT / f).is_file() and not (td / f).exists():
            (td / f).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(ROOT / f, td / f)
    # a claim's probe may name any file in the repository (COVERAGE-CITED-1 binds a statement to the code it cites): the copy carries each one
    for c in json.loads((ROOT / "doctrine/claims.json").read_text(encoding="utf-8"))["claims"]:
        for pr in ["file:" + c["surface"]] + ([c["probe"]] if isinstance(c["probe"], str) else c["probe"]):
            f = pr.partition(":")[2].partition("::")[0]
            if pr.startswith(("file:", "grep:")) and (ROOT / f).is_file() and not (td / f).exists():
                (td / f).parent.mkdir(parents=True, exist_ok=True); shutil.copy(ROOT / f, td / f)
    return td


class Coverage(unittest.TestCase):
    def test_coverage_counts_unbound_live_sentences_and_unreachable_pages(self):
        td = copy()
        reg = json.loads((td / "doctrine/claims.json").read_text("utf-8"))
        reg["coverage"]["live_pages"] = ["https://x.test/a", "https://x.test/down"]
        reg["coverage"]["src_globs"] = []
        (td / "doctrine/claims.json").write_text(json.dumps(reg), "utf-8")
        def fetch(u):
            if u.endswith("down"):
                raise OSError("unreachable")
            return "<p>The loop runs every 10 minutes without anyone watching it.</p><p>Plain words here.</p>"
        c = claims.coverage(td, fetch)
        self.assertEqual((c["found"], c["bound"]), (1, 0))
        self.assertFalse([p for p in c["pages"] if p["url"].endswith("down")][0]["ok"])
        self.assertTrue(claims.file_coverage(td, c))

    def test_repo_coverage_is_at_or_above_its_floor(self):
        c = claims.coverage(ROOT, lambda u: "")
        self.assertGreaterEqual(c["ratio"], c["floor"])


class Claims(unittest.TestCase):
    def test_repo_has_no_drift_and_data_is_fresh(self):
        self.assertEqual(claims.main(["--check"]), 0)

    def test_stale_number_is_drift_and_fix_rewrites_it(self):
        td = copy()
        r = (td / "README.md").read_text(encoding="utf-8")
        (td / "README.md").write_text(r.replace("<!-- claim:core-tests -->44 tests", "<!-- claim:core-tests -->12 tests"), encoding="utf-8")
        _, _, drift = claims.evaluate(td)
        self.assertTrue(any(d["id"] == "core-tests" for d in drift), drift)
        self.assertEqual(claims.fix(td), ["README.md"])
        self.assertEqual(claims.evaluate(td)[2], [])

    def test_reworded_claim_and_failed_probe_are_drift(self):
        td = copy()
        w = (td / "site/worker.js").read_text(encoding="utf-8")
        (td / "site/worker.js").write_text(w.replace("A work-claim ledger gives each file to one agent at a time", "Agents share files freely"), encoding="utf-8")
        t = td / "seed/worker/test/handoff.test.js"   # the claim is bound to the test that proves the rollback, so removing that test is drift
        t.write_text(t.read_text(encoding="utf-8").replace("a red probe rolls the deploy back and puts the item back to ready", "a red probe is logged"), encoding="utf-8")
        ids = {d["id"] for d in claims.evaluate(td)[2]}
        self.assertTrue({"how-claim-ledger", "how-probe-revert"} <= ids, ids)

    def test_reverse_drift_page_served_but_not_in_sitemap(self):
        td = copy()
        w = (td / "site/worker.js").read_text(encoding="utf-8")
        (td / "site/worker.js").write_text(w.replace('const PAGES = ["/", ', 'const PAGES = ["/", "/newpage", '), encoding="utf-8")
        drift = claims.evaluate(td)[2]
        self.assertTrue(any(d["id"] == "inv-pages-in-sitemap" and "/newpage" in d["detail"] for d in drift), drift)

    def test_file_items_is_idempotent(self):
        td = copy()
        (td / "docs/issues").mkdir(parents=True)
        d = [{"id": "x-y", "surface": "s", "claim": "c", "detail": "d", "kind": "claim"}]
        self.assertEqual(claims.file_items(td, d), ["Q-CLAIM-x-y"])
        self.assertEqual(claims.file_items(td, d), [])

    def test_live_unreachable_is_drift_not_pass(self):
        rows, drift = claims.live(ROOT, fetch=lambda u: (_ for _ in ()).throw(OSError("offline")))
        self.assertEqual(len(drift), len(rows)); self.assertTrue(all("unmeasured" in r["detail"] for r in drift))
        ok_rows, ok_drift = claims.live(ROOT, fetch=lambda u: " ".join(c for l in claims.load(ROOT)["live"] if l["url"] == u for c in l["contains"]))
        self.assertEqual(ok_drift, [])



class CitedBinder(unittest.TestCase):
    """COVERAGE-CITED-1: a statement is bound only to code it names, and every such binding is a probe that can fail."""
    def setUp(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("bind_cited_claims", claims.REPO / "scripts/bind_cited_claims.py")
        self.b = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.b)

    def test_probes_come_from_the_line_and_only_for_code_that_exists(self):
        checks = "run: python3 -m foundation flows --check\n"
        line = "Every loop declares its flows. Check: `python3 -m foundation flows --check`, tests `tests/foundation/test_flows.py`, and `no/such/file.py`."
        self.assertEqual(self.b.probes_for(line, claims.REPO, checks), ["file:tests/foundation/test_flows.py", "file:foundation/flows.py", "grep:.github/workflows/checks.yml::foundation[ .]flows\\b"])
        self.assertEqual(self.b.probes_for("The system always merges every change automatically.", claims.REPO, checks), [])   # cites no code: never bound to itself

    def test_registered_cited_claims_are_current_and_pass(self):
        new, _ = self.b.build()
        have = [c for c in claims.load()["claims"] if c.get("bound_by") == "cited"]
        self.assertEqual(sorted(c["id"] for c in new), sorted(c["id"] for c in have), "run python3 scripts/bind_cited_claims.py --apply")
        reg = claims.load()["claims"]
        mir = self.b.mirrors(claims.REPO, [c for c in reg if c.get("bound_by") != "mirror"])
        self.assertEqual(sorted(c["id"] for c in mir), sorted(c["id"] for c in reg if c.get("bound_by") == "mirror"), "run python3 scripts/bind_cited_claims.py --apply")
        self.assertGreaterEqual(len(have), 50)
        for c in have:
            self.assertTrue(c["probe"])
            for pr in c["probe"]:
                self.assertTrue(claims.probe(claims.REPO, pr)[0], f"{c['id']}: {pr}")
            self.assertFalse(any(pr.startswith("grep:" + c["surface"]) for pr in c["probe"]), "a claim is never proved by its own sentence")

    def test_quote_is_a_prefix_of_the_line(self):
        line = "  " + "word " * 60
        self.assertTrue(line.strip().startswith(self.b.quote(line))); self.assertLessEqual(len(self.b.quote(line)), 140)


class Modules(unittest.TestCase):
    """COVERAGE-MODULES-1: a generated module is bound as a whole, and only while its generator, header and checks hold."""
    def test_every_generated_module_is_current(self):
        import subprocess, sys
        mods = claims.load()["modules"]
        self.assertGreaterEqual(len(mods), 9)
        for m in mods:
            self.assertEqual(claims.module_ok(claims.REPO, m), (True, ""), m["id"])
            if m.get("check") and m["id"] != "claims-data":   # claims --check is this suite's own subject (test_registry_passes)
                r = subprocess.run([sys.executable] + m["check"][1:], cwd=claims.REPO, capture_output=True, text=True, timeout=300)
                self.assertEqual(r.returncode, 0, f"{m['id']} is stale: {' '.join(m['check'])}\n{r.stdout[-400:]}{r.stderr[-400:]}")

    def test_a_hand_edited_or_orphaned_module_is_not_bound(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            d = Path(d); (d / "site").mkdir(); (d / "gen.py").write_text("x")
            m = {"id": "m", "surface": "site/m.js", "header": "gen.py", "generator": "gen.py", "source": ["s.json"], "probe": ["file:gen.py"]}
            (d / "site/m.js").write_text("// generated by gen.py; do not edit\nexport default {a: 'It always works.'};\n")
            self.assertTrue(claims.module_ok(d, m)[0])
            (d / "site/m.js").write_text("export default {a: 'It always works.'};\n")
            self.assertFalse(claims.module_ok(d, m)[0])
            (d / "site/m.js").write_text("// generated by gen.py; do not edit\nexport default {};\n"); (d / "gen.py").unlink()
            self.assertFalse(claims.module_ok(d, m)[0])

    def test_markup_and_code_comments_are_not_statements(self):
        self.assertNotIn("100%", claims.prose("README.md", '<p align="center"><img src="a.png" alt="The loop every manager runs" width="100%"></p>'))
        self.assertIn("The loop every manager runs", claims.prose("README.md", '<p><img src="a.png" alt="The loop every manager runs" width="100%"></p>'))
        self.assertNotIn("never", claims.prose("site/x.js", 'const ok = h === "example.org"; // an internal name is rejected, never a host'))
        self.assertIn("never fails", claims.prose("site/x.js", 'card("It never fails", "see https://example.org/a")'))
        self.assertIn("never", claims.prose("docs/x.md", "owner: x   // never put a token here"))


class Curated(unittest.TestCase):
    """COVERAGE-CURATED-1: a hand-bound statement is proved by code elsewhere, never by its own sentence, and every source statement is bound."""
    def test_curated_claims_have_real_probes(self):
        have = [c for c in claims.load()["claims"] if c.get("bound_by") == "curated"]
        self.assertGreaterEqual(len(have), 100)
        for c in have:
            self.assertTrue(c["probe"], c["id"])
            self.assertFalse(any(pr.split(":", 1)[1].split("::")[0] == c["surface"] for pr in c["probe"]), f"{c['id']}: a claim is never proved by its own surface")
            self.assertTrue(any(not pr.startswith("file:") or pr.endswith((".py", ".js", ".mjs", ".sh", ".yml", ".sql")) for pr in c["probe"]), f"{c['id']}: at least one probe is code or a pattern in code")

    def test_a_repeated_sentence_is_checked_on_each_surface_with_the_probes_of_its_source(self):
        reg = claims.load()["claims"]; by = {c["id"]: c for c in reg}
        mirrors = [c for c in reg if c.get("bound_by") == "mirror"]
        self.assertGreaterEqual(len(mirrors), 50)
        for c in mirrors:
            src = by[c["of"]]
            self.assertEqual(c["text"], src["text"]); self.assertNotEqual(c["surface"], src["surface"])
            self.assertTrue(c["probe"] and set(c["probe"]) <= set(src["probe"]), c["id"])

    def test_a_page_sentence_is_bound_by_a_registered_sentence_a_piece_of_one_or_served_data(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d); (d / "doctrine").mkdir(); (d / "site").mkdir(); (d / "gen.py").write_text("x")
            (d / "site/w.js").write_text('export const p = "<p>The check always runs before a merge, and a red check blocks it.</p>";\n')
            (d / "site/m.js").write_text('// generated by gen.py\nexport default {"so": "we are never surprised by a bill"};\n')
            reg = {"claims": [{"id": "a", "surface": "site/w.js", "text": "The check always runs before a merge, and a red check blocks it.", "probe": ["file:gen.py"]}],
                   "generated": [], "ledgers": [], "inventory": [], "live": [],
                   "modules": [{"id": "m", "surface": "site/m.js", "header": "gen.py", "generator": "gen.py", "source": [], "probe": []}],
                   "coverage": {"src_globs": [], "skip": [], "live_pages": ["u"], "patterns": ["\\b(always|never)\\b"]}}
            (d / "doctrine/claims.json").write_text(json.dumps(reg))
            page = ("<p>The check always runs before a merge, and a red check blocks it.</p>"        # the registered sentence
                    "<li>The check always runs before a merge,<br>and a red check blocks it.</li>"    # cut by a tag: a piece of it
                    "<li>As a small charity, I want the cost up front, so we are never surprised by a bill.</li>"   # stitched from served data
                    "<p>Your data is never shared with anyone at all, ever.</p>")                       # nothing binds this one
            c = claims.coverage(d, fetch=lambda u: page)
            self.assertEqual(c["live_unbound"], {"u": ["Your data is never shared with anyone at all, ever."]})
            (d / "gen.py").unlink()   # the module loses its generator: its strings stop binding anything
            self.assertEqual(len(claims.coverage(d, fetch=lambda u: page)["live_unbound"]["u"]), 2)

    def test_unbound_source_statements_stay_inside_the_budget(self):
        """Every source statement was bound on 2026-11-20. A new unbound line is filed by the daily claims run (Q-CLAIM-COVER-*) and bound by the
        executor; the budget is the most that may wait there, so a change is blocked only when binding has fallen behind. It shrinks, never grows."""
        def offline(u):
            raise OSError("offline in tests")
        c = claims.coverage(fetch=offline)
        n = sum(len(v) for v in c["src_unbound"].values())
        budget = claims.load()["coverage"]["src_unbound_budget"]
        self.assertLessEqual(budget, 10, "the budget only shrinks")
        self.assertLessEqual(n, budget, f"{n} unbound statements: bind them in doctrine/claims.json or change the words to what the code does: {c['src_unbound']}")


if __name__ == "__main__":
    unittest.main()
