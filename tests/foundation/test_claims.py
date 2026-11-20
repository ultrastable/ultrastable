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
    for d in ("seed", "platform", "ops", "foundation", "instances", "doctrine", "site"):
        shutil.copytree(ROOT / d, td / d, dirs_exist_ok=True, ignore=shutil.ignore_patterns("node_modules", "__pycache__", "assets"))
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
        (td / "site/probes.json").write_text(json.dumps({"mode": "observe"}), encoding="utf-8")
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
        self.assertGreaterEqual(len(have), 50)
        for c in have:
            self.assertTrue(c["probe"])
            for pr in c["probe"]:
                self.assertTrue(claims.probe(claims.REPO, pr)[0], f"{c['id']}: {pr}")
            self.assertFalse(any(pr.startswith("grep:" + c["surface"]) for pr in c["probe"]), "a claim is never proved by its own sentence")

    def test_quote_is_a_prefix_of_the_line(self):
        line = "  " + "word " * 60
        self.assertTrue(line.strip().startswith(self.b.quote(line))); self.assertLessEqual(len(self.b.quote(line)), 140)

if __name__ == "__main__":
    unittest.main()
