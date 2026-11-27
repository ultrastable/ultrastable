# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""PUBLICATION-GUARD-1: this repository passes the publication check, and the check catches what the 2026-11-15 publication found by hand."""
import json, sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import fleet, publication  # noqa: E402

POL = publication.load(ROOT)
ORG_REPOS = [".github", "license", "ops", "seed", "spec", "ultrastable", "workers"]


class Publication(unittest.TestCase):
    def test_this_repository_passes(self):
        self.assertEqual(publication.check(ROOT), [])

    def test_case_collision_is_caught(self):
        # ultrastable/spec lost LICENSE to a checkout that could not hold it beside license/
        self.assertEqual(publication.case_collisions(["LICENSE", "license/FAQ.md", "docs/a.md"]), [["LICENSE", "license"]])
        self.assertEqual(publication.case_collisions(["LICENSE", "licensing/FAQ.md"]), [])

    def test_license_blob_is_the_git_blob_id(self):
        self.assertEqual(publication.blob_sha(b"hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a")
        self.assertEqual(publication.blob_sha((ROOT / "LICENSE").read_bytes().replace(b"\r\n", b"\n")), POL["license_blob"])

    def test_spdx_baseline_only_shrinks(self):
        lacking = set(publication.missing_headers(ROOT, publication.tracked(ROOT), POL))
        self.assertEqual(lacking - set(POL["spdx_baseline"]), set(), "a new source file needs the SPDX header; the baseline is not a place to park it")
        self.assertIn("foundation/publication.py", publication.tracked(ROOT))
        self.assertNotIn("foundation/publication.py", lacking)

    def test_private_data_patterns(self):
        hits = publication.private_hits("mail someone.real@gmail.com or see C:\\Users\\LENOVO\\x", POL)
        self.assertEqual(sorted({k for k, _ in hits}), ["local_path", "personal_email"])
        self.assertEqual(publication.private_hits("write to security@ultrastable.io or a@example.org", POL), [])

    def test_fleet_watches_every_public_repository(self):
        cfg = json.loads((ROOT / "doctrine/fleet.json").read_text(encoding="utf-8"))
        rules = {c["id"]: c for c in cfg["copies"]}
        self.assertEqual(sorted(rules["license-text"]["repos"]), ORG_REPOS)
        self.assertEqual(rules["license-text"]["files"], ["LICENSE", "COMMERCIAL-TERMS.md"])
        self.assertEqual(sorted(rules["publication-files"]["repos"]), ORG_REPOS)
        for r in ORG_REPOS:
            self.assertIn(f"ultrastable/{r}", cfg["public_read"])

    def test_fleet_reports_a_repository_that_lost_its_license(self):
        cfg = json.loads((ROOT / "doctrine/fleet.json").read_text(encoding="utf-8"))
        d = [x for x in fleet.drift(cfg, lambda r, p: None if (r, p) == ("spec", "LICENSE") else "LicenseRef-Ultrastable-USL-1.0 CLOSED-LOOP-AXIOM")
             if x["copy"] == "license-text"]
        self.assertEqual(d, [{"copy": "license-text", "repo": "spec", "file": "LICENSE", "problem": "missing"}])


if __name__ == "__main__":
    unittest.main()


class FixHeaders(unittest.TestCase):
    def test_fix_adds_the_header_the_check_asks_for(self):
        import shutil, subprocess
        from foundation import publication
        sys.path.insert(0, str(Path(__file__).resolve().parent)); import _repo  # noqa: E402
        d = _repo.scratch()
        subprocess.run(["git", "init", "-q", str(d)], check=True)
        for f in ("doctrine/publication.json", "LICENSE"):
            (d / f).parent.mkdir(parents=True, exist_ok=True); shutil.copy(Path(__file__).resolve().parents[2] / f, d / f)
        (d / "foundation").mkdir(); (d / "foundation/new.py").write_text("x = 1\n")
        subprocess.run(["git", "-C", str(d), "add", "-A"], check=True)
        self.assertEqual(publication.fix_headers(d), ["foundation/new.py"])
        self.assertTrue((d / "foundation/new.py").read_text().startswith("# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0"))


class FixWrongIdentifier(unittest.TestCase):
    def test_a_wrong_identifier_is_rewritten_not_stacked(self):
        import shutil, subprocess
        from foundation import publication
        sys.path.insert(0, str(Path(__file__).resolve().parent)); import _repo  # noqa: E402
        d = _repo.scratch()
        subprocess.run(["git", "init", "-q", str(d)], check=True)
        for f in ("doctrine/publication.json", "LICENSE"):
            (d / f).parent.mkdir(parents=True, exist_ok=True); shutil.copy(Path(__file__).resolve().parents[2] / f, d / f)
        (d / "foundation").mkdir(); (d / "foundation/old.py").write_text("# SPDX-License-Identifier: LicenseRef-Ultrastable\nx = 1\n")
        subprocess.run(["git", "-C", str(d), "add", "-A"], check=True)
        self.assertEqual(publication.fix_headers(d), ["foundation/old.py"])
        t = (d / "foundation/old.py").read_text()
        self.assertEqual(t.count("SPDX-License-Identifier"), 1)
        self.assertTrue(t.startswith("# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n# Copyright (c) Ultrastable\nx = 1"))
        self.assertEqual([m for m in publication.check(d) if "old.py" in m], [])
