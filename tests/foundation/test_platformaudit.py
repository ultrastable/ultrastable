"""PLATFORM-AUDIT-1: drift between declared and live platform settings is found, classified and fixed (fake gh, no network)."""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import platformaudit as P  # noqa: E402

D = {"settings": {"allow_auto_merge": True, "delete_branch_on_merge": True}, "security": {"vulnerability_alerts": True, "automated_security_fixes": False,
     "secret_scanning": "enabled", "secret_scanning_push_protection": "enabled"}, "branch_protection": {"branch": "main", "allow_force_pushes": False,
     "allow_deletions": False, "required_linear_history": True}}


def fake(live, calls=None):
    def f(path, method="GET", body=None):
        if calls is not None and method != "GET":
            calls.append((method, path, body))
        return live.get((method, path), (404, "x"))
    return f


class Audit(unittest.TestCase):
    def test_declaration_ok(self):
        self.assertEqual(P.check(), [])
        self.assertIn("ultrastable/.github", P.load()["repos"])

    def test_drift_gated_and_unmeasured_are_classified(self):
        live = {("GET", "repos/o/r"): (200, {"allow_auto_merge": False, "delete_branch_on_merge": True, "security_and_analysis": None}),
                ("GET", "repos/o/r/vulnerability-alerts"): (204, {}),
                ("GET", "repos/o/r/branches/main/protection"): (403, "Upgrade to GitHub Pro or make this repository public")}
        cls = {(c, s.split(" ", 1)[1] if " " in s else s) for c, s, _ in P.probe_repo("o/r", D, fake(live))}
        self.assertIn(("DRIFT", "allow_auto_merge"), cls)
        self.assertIn(("GATED", "secret_scanning"), cls)
        self.assertIn(("GATED", "protect main"), cls)
        self.assertEqual(P.probe_repo("o/r", D, fake({}))[0][0], "UNMEASURED")

    def test_apply_patches_only_drifted_keys(self):
        calls = []
        f = [("DRIFT", "o/r allow_auto_merge", ""), ("DRIFT", "o/r protect main", "")]
        P.apply(f, fake({("PATCH", "repos/o/r"): (200, {}), ("PUT", "repos/o/r/branches/main/protection"): (200, {})}, calls), {"repos": {"o/r": D}})
        self.assertEqual(calls[0][2], {"allow_auto_merge": True})
        self.assertFalse(calls[1][2]["allow_force_pushes"])

    def test_cloudflare_stale_move_record_is_drift(self):
        out = P.probe_cloudflare(P.REPO, lambda a: ["ultrastable-tick", "ultrastable-site"])
        self.assertTrue(any(c == "DRIFT" for c, _, _ in out))


if __name__ == "__main__":
    unittest.main()
