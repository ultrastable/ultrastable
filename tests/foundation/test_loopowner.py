import json, shutil, tempfile, unittest
from pathlib import Path
from foundation import loopowner

REPO = Path(__file__).resolve().parents[2]


class LoopOwner(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(loopowner.check(REPO), [])

    def test_client_only_loop_and_missing_owner_fail(self):
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d, True)
        (d / "doctrine").mkdir(); (d / "instances/ultrastable").mkdir(parents=True)
        shutil.copy(REPO / "doctrine/loop-ownership.json", d / "doctrine")
        loop = {"id": "x", "paths": [{"id": "a", "class": "session"}], "done": "ok", "closing_probe": "p", "trigger": "t"}
        (d / "instances/ultrastable/loop-registry.json").write_text(json.dumps({"loops": [loop]}))
        errs = loopowner.check(d)
        self.assertTrue(any("server_owner" in e for e in errs) and any("no server-side path" in e for e in errs))
        loop.update(server_owner="ultrastable-tick", paths=[{"id": "a", "class": "free"}], done="owner will merge it")
        (d / "instances/ultrastable/loop-registry.json").write_text(json.dumps({"loops": [loop]}))
        self.assertEqual(len(loopowner.check(d)), 1)
