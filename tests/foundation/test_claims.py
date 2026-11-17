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


if __name__ == "__main__":
    unittest.main()
