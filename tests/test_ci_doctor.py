# SPDX-License-Identifier: Apache-2.0
import importlib.util, pathlib, unittest
spec = importlib.util.spec_from_file_location("ci_doctor", pathlib.Path(__file__).parent.parent / "scripts" / "ci_doctor.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

def run(name, concl, at, event="push"):
    return {"name": name, "conclusion": concl, "created_at": at, "event": event, "id": 1}

class T(unittest.TestCase):
    def test_latest_wins_and_pr_ignored(self):
        bad, names = m.failing_workflows([run("a", "failure", "1"), run("a", "success", "2"), run("b", "failure", "1"),
                                          run("c", "failure", "1", "pull_request"), run("d", "cancelled", "1")])
        self.assertEqual(set(bad), {"b"}); self.assertEqual(names, {"a", "b"})

if __name__ == "__main__":
    unittest.main()
