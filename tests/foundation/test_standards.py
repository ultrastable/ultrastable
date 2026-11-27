"""Conformance lint for the agentic standards register: the register, the surfaces and the code must agree."""
import json, shutil, sys, tempfile, tomllib, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import standards  # noqa: E402
import sys as _sys; _sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402  (scratch directories are removed when the run ends)


def copy():
    td = Path(scratch())
    for rel in (standards.REG, standards.SURF, standards.SCHEMA, standards.DOC, standards.SNAP, standards.ENTRY):
        (td / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / rel, td / rel)
    for e in json.loads((ROOT / standards.REG).read_text())["entries"]:
        for rel in (e.get("how") or []) + [t["file"] for t in e.get("tests", [])] + ([e["acl"]] if e.get("acl") else []):
            if (ROOT / rel).is_file() and not (td / rel).exists():
                (td / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(ROOT / rel, td / rel)
    return td


def edit(td, rel, fn):
    p = td / rel
    d = json.loads(p.read_text())
    fn(d)
    p.write_text(json.dumps(d))


class Standards(unittest.TestCase):
    def test_repo_clean(self):
        self.assertEqual(standards.check(ROOT), [])

    def test_conform_probe_reads_the_file_with_its_validator(self):
        """REPO-CONFORM-2: a conform: probe passes only when the named validator accepts the file; a substring is not enough."""
        self.assertEqual(standards.probe(ROOT, "conform:seed::CITATION.cff"), "")
        td = Path(scratch())
        (td / "CITATION.cff").write_text("cff-version: 1.2.0\nlicense: LicenseRef-x\n")
        self.assertIn("CITATION.cff", standards.probe(td, "conform:.::CITATION.cff"))
        self.assertIn("not in the conformance register", standards.probe(ROOT, "conform:.::nothing.txt"))

    def test_declared_standard_without_support_fails(self):
        td = copy()
        edit(td, standards.SURF, lambda d: d["surfaces"][0]["standards"].append("x402-pay-per-crawl"))
        self.assertTrue(any("x402-pay-per-crawl" in b and "not_applicable" in b for b in standards.check(td)))

    def test_supported_without_real_test_fails(self):
        td = copy()
        def f(d):
            next(e for e in d["entries"] if e["id"] == "llms-txt")["tests"][0]["name"] = "no such test"
        edit(td, standards.REG, f)
        self.assertTrue(any("llms-txt" in b and "not found" in b for b in standards.check(td)))

    def test_new_surface_without_registration_fails(self):
        td = copy()
        ix = td / standards.ENTRY
        ix.write_text(ix.read_text() + "\nif (url.pathname === '/secret-new') {}\n")
        self.assertTrue(any("/secret-new" in b and "not registered" in b for b in standards.check(td)))

    def test_surface_without_discovery_fails(self):
        td = copy()
        def f(d):
            s = next(x for x in d["surfaces"] if x["id"] == "next")
            s.pop("reason")
        edit(td, standards.SURF, f)
        self.assertTrue(any("no reason" in b for b in standards.check(td)))

    def test_unstable_standard_needs_isolation_and_planned_needs_tracking(self):
        td = copy()
        def f(d):
            next(e for e in d["entries"] if e["id"] == "otel-genai").pop("acl")
            planned.append(next(e for e in d["entries"] if e.get("support") == "planned" and e.get("tracked_by")))
            planned[-1].pop("tracked_by")
        planned = []
        edit(td, standards.REG, f)
        bad = standards.check(td)
        self.assertTrue(any("otel-genai" in b and "anti-corruption" in b for b in bad))
        self.assertTrue(any(planned[0]["id"] in b and "tracked_by" in b for b in bad))

    def test_stale_register_fails(self):
        import datetime as dt
        self.assertTrue(any("re-check" in b for b in standards.check(ROOT, today=dt.date(2027, 6, 1))))

    def test_doc_table_drift_fails(self):
        td = copy()
        p = td / standards.DOC
        p.write_text(p.read_text().replace("| supported |", "| planned |", 1))
        self.assertTrue(any("out of date" in b for b in standards.check(td)))

    def test_client_configs_parse_and_point_at_mcp(self):
        t = tomllib.loads((ROOT / "docs/standards/clients/codex-config.toml").read_text())
        self.assertTrue(t["mcp_servers"]["ultrastable"]["url"].endswith("/mcp"))
        self.assertNotIn("bearer_token", t["mcp_servers"]["ultrastable"])  # env var name only, never a value
        j = json.loads((ROOT / "docs/standards/clients/mcp.json").read_text())
        self.assertTrue(j["mcpServers"]["ultrastable"]["url"].endswith("/mcp"))


if __name__ == "__main__":
    unittest.main()
