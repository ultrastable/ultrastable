import json
import shutil
import tempfile
import unittest
from pathlib import Path

from foundation import orgcyber


class OrgCyber(unittest.TestCase):
    def test_repo_passes(self):
        self.assertEqual(orgcyber.check(), [])

    def test_switched_off_regulator_fails(self):
        d = Path(tempfile.mkdtemp())
        try:
            for p in ["doctrine/org-cybernetics.json", "seed/autonomy/managers.json"]:
                (d / p).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(orgcyber.REPO / p, d / p)
            shutil.copytree(orgcyber.REPO / "agents/roles", d / "agents/roles")
            reg = json.loads((d / "seed/autonomy/managers.json").read_text())
            reg["switch"] = {"reviewer": {"state": "off", "reason": "test"}}
            (d / "seed/autonomy/managers.json").write_text(json.dumps(reg))
            errs = orgcyber.check(d)
            self.assertTrue(any(e.startswith("s3star-audit: no switched-on") for e in errs))
        finally:
            shutil.rmtree(d)


if __name__ == "__main__":
    unittest.main()
