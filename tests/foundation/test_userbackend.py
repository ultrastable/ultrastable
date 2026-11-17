# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import json, shutil, tempfile, unittest
from pathlib import Path
from foundation import userbackend as U

REPO = Path(__file__).resolve().parents[2]


class T(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, self.d, True)
        (self.d / "doctrine").mkdir(); shutil.copy(REPO / "doctrine/user-backend.json", self.d / "doctrine/user-backend.json")
        (self.d / "seed/worker/src").mkdir(parents=True); (self.d / "site").mkdir()
        (self.d / "seed/worker/src/errors.js").write_text("export const userError = () => 0;\n")

    def cfg(self, **kw):
        d = U.load(self.d); d.update(kw); return d

    def test_repo_is_clean(self):
        self.assertEqual(U.check(REPO), [])

    def test_raw_error_in_response_fails(self):
        (self.d / "site/a.js").write_text('catch (e) { return json({ error: String(e && e.message || e) }, 500); }\n')
        self.assertTrue(any("response-carries-raw-error" in x for x in U.leaks(self.d, self.cfg())))

    def test_raw_error_on_page_fails(self):
        (self.d / "site/a.js").write_text("catch(e){el.textContent='Failed: '+e.message}\n")
        self.assertTrue(any("page-shows-raw-error" in x for x in U.leaks(self.d, self.cfg())))

    def test_console_logging_and_marker_are_allowed(self):
        (self.d / "site/a.js").write_text('console.error("x", json({ error: String(e) }));\nreturn json({ error: String(e) }); // USER-BACKEND-OK: owner-only panel\n')
        self.assertEqual(U.leaks(self.d, self.cfg()), [])

    def test_plain_response_passes(self):
        (self.d / "site/a.js").write_text('catch (e) { const r = userError(e, "x"); return json({ error: r.error }, r.status); }\n')
        self.assertEqual(U.leaks(self.d, self.cfg()), [])

    def test_worker_must_reach_shared_module_and_forks_fail(self):
        (self.d / "site/worker.js").write_text("export default {};\n")
        d = self.cfg(shared_consumers=[{"id": "errors", "module": "seed/worker/src/errors.js", "must_reach_from": ["site/worker.js"], "fork_patterns": [r"\bfunction\s+userError\b"]}])
        self.assertTrue(any("does not consume" in x for x in U.shared_failures(self.d, d)))
        (self.d / "site/helper.js").write_text('import { userError } from "../seed/worker/src/errors.js";\n')
        (self.d / "site/worker.js").write_text('import "./helper.js";\n')
        self.assertEqual(U.shared_failures(self.d, d), [])  # reached transitively
        (self.d / "site/fork.js").write_text("function userError(e) { return String(e); }\n")
        self.assertTrue(any("forks the shared errors" in x for x in U.shared_failures(self.d, d)))


if __name__ == "__main__":
    unittest.main()
