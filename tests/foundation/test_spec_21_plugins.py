# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""US-SPEC-21 second implementation (the plugin tier, seed/plugins): the requirements the specification records as BUILT there.

US-21-R19 dry-run is the default and delivers nothing; US-21-R28 a request may reach only the hosts the plugin's adapter allows; US-21-R22 the
minimum rung differs per action class; US-21-R24 cloud writes carry the managed label and nothing is ever deleted; US-21-R10 a transport that
fails is recorded without the secret. Fast cases against Runtime with a fake transport; the full plugin suite is seed/plugins/tests.
US-21-R18 (the platform's own actions keep the same boundary outside the pack host) is read from foundation/boundary.py and doctrine/boundary.json.
"""
import json
import shutil
import sys
import unittest
from pathlib import Path

SEED = Path(__file__).resolve().parents[2] / "seed"
sys.path.insert(0, str(SEED))
from plugins.api import Runtime, Action, SCOPE  # noqa: E402
from _repo import scratch  # noqa: E402
from plugins.email import plugin as email  # noqa: E402
from plugins.gcp import plugin as gcp  # noqa: E402
from foundation import boundary  # noqa: E402

REPO = SEED.parent

ENV = {"MAIL_SEND_URL": "https://mail.example.workers.dev/send", "MAIL_SEND_TOKEN": "t0k-secret-value", "GCP_ACCESS_TOKEN": "g-secret-value"}


def cfg(mode="dry-run", rung="observed"):
    c = json.loads((SEED / "plugins/plugins.config.template.json").read_text())
    c["rung"] = rung
    for _n, p in c["plugins"].items():
        p["enabled"] = True
        p["mode"] = mode
    return c


class Plugins(unittest.TestCase):
    def rt(self, mode="dry-run", rung="observed", env=ENV, transport=None):
        self.calls = []

        def default(req):
            self.calls.append(req)
            return 200, {"ok": True}, {}
        d = str(scratch())
        return Runtime(cfg(mode, rung), state_dir=d, env=env, transport=transport or default, now=lambda: 1_700_000_000)

    def test_us_21_r19_dry_run_is_the_default_and_sends_nothing(self):
        self.assertEqual(SCOPE["plugin_tier"]["default_mode"], "dry-run")
        rt = self.rt()
        rt.grant_consent("a@x.org")
        r = email.send(rt, "a@x.org", "hi", "hello", from_addr="me@x.org")
        self.assertEqual(r.status, "dry-run")
        self.assertEqual(self.calls, [])
        self.assertNotIn("t0k-secret-value", json.dumps(r.detail), "a dry run shows the request with the secret still a placeholder")

    def test_us_21_r19_a_dry_run_records_the_same_ledger_row_a_live_run_would(self):
        rt = self.rt()
        rt.grant_consent("a@x.org")
        email.send(rt, "a@x.org", "hi", "hello", from_addr="me@x.org")
        ledger = list(rt.dir.glob("*.jsonl"))
        self.assertTrue(ledger, "the run left a record")
        self.assertIn("dry-run", "".join(p.read_text() for p in ledger))

    def test_us_21_r28_an_unlisted_egress_host_is_refused(self):
        rt = self.rt("live", "delegated")
        rt.grant_consent("a@x.org")
        a = email.build_send(rt, "a@x.org", "s", "b")
        a.request["url"] = "https://other.example/x"
        r = rt.perform(a)
        self.assertEqual(r.status, "refused")
        self.assertIn("egress", r.reason)
        self.assertEqual(self.calls, [], "nothing left the organization")

    def test_us_21_r22_the_minimum_rung_differs_per_action_class(self):
        classes = SCOPE["action_classes"]
        order = SCOPE["rungs"]
        self.assertLess(order.index(classes["draft"]["min_rung"]), order.index(classes["send_to_person"]["min_rung"]))
        self.assertLess(order.index(classes["send_to_person"]["min_rung"]), order.index(classes["cloud_write"]["min_rung"]))
        # delegated may send to a person, but may not write to a cloud account
        rt = self.rt("live", "delegated")
        rt.grant_consent("a@x.org")
        self.assertEqual(email.send(rt, "a@x.org", "s", "b", from_addr="m@x.org").status, "sent")
        w = gcp.write(rt, "POST", "https://storage.googleapis.com/b", {"labels": {"managed-by": "ultrastable"}})
        self.assertEqual(w.status, "refused")
        self.assertIn("rung", w.reason)

    def test_us_21_r24_cloud_writes_need_the_managed_label_and_delete_is_refused(self):
        rt = self.rt("live", "autonomous")
        self.assertIn("managed-by", gcp.write(rt, "POST", "https://storage.googleapis.com/b", {"name": "x"}).reason)
        self.assertEqual(gcp.write(rt, "POST", "https://storage.googleapis.com/b", {"labels": {"managed-by": "ultrastable"}}).status, "sent")
        self.assertIn("out of bounds", gcp.write(rt, "DELETE", "https://storage.googleapis.com/b", {}).reason)
        self.assertEqual(len(self.calls), 1, "only the labelled write left")

    def test_us_21_r24_the_scope_lists_the_out_of_bounds_items_the_manifest_check_enforces(self):
        text = json.dumps(SCOPE["out_of_bounds"]).lower() if "out_of_bounds" in SCOPE else json.dumps(SCOPE).lower()
        for needle in ("delet", "personal", "claims"):
            self.assertIn(needle, text, f"SCOPE.json names {needle}")

    def test_us_21_r10_a_failing_transport_is_recorded_without_the_secret(self):
        def broken(_req):
            raise OSError("connection reset by peer")
        rt = self.rt("live", "delegated", transport=broken)
        rt.grant_consent("a@x.org")
        r = email.send(rt, "a@x.org", "s", "b", from_addr="m@x.org")
        self.assertIn(r.status, ("error", "refused"))
        self.assertNotIn("t0k-secret-value", json.dumps(r.detail) + r.reason)
        for p in rt.dir.glob("*.jsonl"):
            self.assertNotIn("t0k-secret-value", p.read_text())



class PlatformBoundary(unittest.TestCase):
    TOP = {"rows": {"s|x": {"rung": "self-extending", "score": 1}}}
    LOW = {"rows": {"s|x": {"rung": "observed", "score": 0}}}

    def test_us_21_r18_egress_and_reserved_classes_are_denied_to_an_inside_decision_at_any_rung(self):
        d = boundary.load(REPO)
        gated = [e["id"] for e in d["egress"]] + list(d["permissions"]["reserved"])
        for need in ("credentials", "money", "owner-accounts", "public-publishing", "third-party-systems"):
            self.assertIn(need, gated, "every egress class of US-21-R18 is declared")
        for led in (self.LOW, self.TOP):
            for a in gated:
                self.assertFalse(boundary.decide("s", a, REPO, led)["allow"], a)

    def test_us_21_r18_trust_widens_only_actions_inside_the_boundary(self):
        mid = {"rows": {"s|x": {"rung": "assisted", "score": 0.6}}}
        self.assertFalse(boundary.decide("s", "destroy-instance", REPO, mid)["allow"])
        self.assertTrue(boundary.decide("s", "destroy-instance", REPO, self.TOP)["allow"])
        self.assertFalse(boundary.decide("s", "not-an-inside-action", REPO, self.TOP)["allow"], "an action outside the declared inside set is never widened")


if __name__ == "__main__":
    unittest.main()
