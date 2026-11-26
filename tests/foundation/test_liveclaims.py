# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import json, shutil, tempfile, unittest
from pathlib import Path
from foundation import liveclaims

REPO = Path(__file__).resolve().parents[2]


class LiveClaims(unittest.TestCase):
    def run_on(self, text):
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d)
        (d / "doctrine").mkdir(); (d / "site").mkdir()
        shutil.copy(REPO / liveclaims.PATH, d / liveclaims.PATH)
        (d / "site" / "page.js").write_text(text)
        return liveclaims.scan(d)

    def test_repo_is_clean(self):
        self.assertEqual(liveclaims.scan(REPO), [])

    def test_future_feature_is_blocked(self):
        self.assertTrue(any("not live" in e for e in self.run_on("Team dashboards are coming soon for every system.\n")))

    def test_unknown_host_is_blocked(self):
        self.assertTrue(any("no live probe" in e for e in self.run_on("See https://climate-atlas.ultrastable.org for the atlas.\n")))

    def test_probed_host_passes(self):
        self.assertEqual(self.run_on("See https://what-works.ultrastable.org for the atlas.\n"), [])

    def test_every_host_has_https_probe(self):
        hosts = json.loads((REPO / liveclaims.PATH).read_text())["hosts"]
        self.assertTrue(all(u.startswith("https://") for u in hosts.values()))


if __name__ == "__main__":
    unittest.main()
