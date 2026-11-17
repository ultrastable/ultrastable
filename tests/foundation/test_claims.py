"""CLAIMS-1: words must match code, in both directions."""
import json, shutil, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import claims  # noqa: E402


def copy():
    td = Path(tempfile.mkdtemp())
    for f in ("doctrine/claims.json", "README.md", "platform/adapters/README.md", "site/worker.js", "site/promote.js", "site/agentic.js", "site/claims-data.js"):
        (td / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / f, td / f)
    for d in ("seed", "platform", "ops", "foundation", "instances", "doctrine", "site"):
        shutil.copytree(ROOT / d, td / d, dirs_exist_ok=True, ignore=shutil.ignore_patterns("node_modules", "__pycache__", "assets"))
    return td


class Claims(unittest.TestCase):
    def test_repo_has_no_drift_and_data_is_fresh(self):
        self.assertEqual(claims.main(["--check"]), 0)

    def test_stale_number_is_drift_and_fix_rewrites_it(self):
        td = copy(); self.addCleanup(shutil.rmtree, td, ignore_errors=True)
        r = (td / "README.md").read_text(encoding="utf-8")
        (td / "README.md").write_text(r.replace("<!-- claim:core-tests -->44 tests", "<!-- claim:core-tests -->12 tests"), encoding="utf-8")
        _, _, drift = claims.evaluate(td)
        self.assertTrue(any(d["id"] == "core-tests" for d in drift), drift)
        self.assertEqual(claims.fix(td), ["README.md"])
        self.assertEqual(claims.evaluate(td)[2], [])

    def test_reworded_claim_and_failed_probe_are_drift(self):
        td = copy(); self.addCleanup(shutil.rmtree, td, ignore_errors=True)
        w = (td / "site/worker.js").read_text(encoding="utf-8")
        (td / "site/worker.js").write_text(w.replace("A work-claim ledger gives each file to one agent at a time", "Agents share files freely"), encoding="utf-8")
        (td / "site/probes.json").write_text(json.dumps({"mode": "observe"}), encoding="utf-8")
        ids = {d["id"] for d in claims.evaluate(td)[2]}
        self.assertTrue({"how-claim-ledger", "how-probe-revert"} <= ids, ids)

    def test_reverse_drift_page_served_but_not_in_sitemap(self):
        td = copy(); self.addCleanup(shutil.rmtree, td, ignore_errors=True)
        w = (td / "site/worker.js").read_text(encoding="utf-8")
        (td / "site/worker.js").write_text(w.replace('const PAGES = ["/", ', 'const PAGES = ["/", "/newpage", '), encoding="utf-8")
        drift = claims.evaluate(td)[2]
        self.assertTrue(any(d["id"] == "inv-pages-in-sitemap" and "/newpage" in d["detail"] for d in drift), drift)

    def test_file_items_is_idempotent(self):
        td = copy(); self.addCleanup(shutil.rmtree, td, ignore_errors=True)
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
