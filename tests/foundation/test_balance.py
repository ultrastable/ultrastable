# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""FLOW-BALANCE-1: inflow against closures, SLA, honest consolidation and the filing throttle."""
import json, tempfile, unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path
from foundation import balance as B

NOW = datetime(2026, 11, 21, 12, tzinfo=timezone.utc)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")


def mk(root, i, status="open", title=None, labels=(), trigger="t", probe="cmd:true", disp=""):
    body = f"**Owner:** executor\n**Trigger:** {trigger}\n**Done check:** {probe}\n**Status:** {status}\n" + (f"\n**Disposition:** {disp} (x)\n" if disp else "") + "\n**Evidence:** e\n"
    (root / "docs/issues").mkdir(parents=True, exist_ok=True)
    (root / f"docs/issues/{i}.json").write_text(json.dumps({"id": i, "title": title or f"{i}: something {i}", "body": body, "labels": list(labels)}))


class Balance(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory(); self.root = Path(self.t.name); self.c = B.cfg()

    def tearDown(self):
        self.t.cleanup()

    def test_inflow_over_closures_tips(self):
        for n in range(4):
            mk(self.root, f"Q-A-{n}")
        mk(self.root, "Q-B-1", status="closed")
        b = {f"Q-A-{n}.json": iso(NOW - timedelta(hours=2)) for n in range(4)} | {"Q-B-1.json": iso(NOW - timedelta(days=3))}
        m = B.measure(B.items(self.root), b, {"Q-B-1.json": iso(NOW - timedelta(hours=1))}, NOW, self.c)
        self.assertEqual((m["windows"]["day"]["net_inflow"], m["windows"]["day"]["closed"]), (4, 1))
        self.assertTrue(m["tipped"]); self.assertTrue(m["throttle"]["on"]); self.assertGreater(m["closure_boost"], 1)

    def test_superseded_never_counts_as_closure(self):
        mk(self.root, "Q-A-1", status="closed", disp="superseded"); mk(self.root, "Q-A-2", status="closed")
        b = {"Q-A-1.json": iso(NOW - timedelta(hours=1)), "Q-A-2.json": iso(NOW - timedelta(days=9))}
        cl = {"Q-A-1.json": iso(NOW), "Q-A-2.json": iso(NOW)}
        d = B.measure(B.items(self.root), b, cl, NOW, self.c)["windows"]["day"]
        self.assertEqual((d["filed"], d["superseded"], d["net_inflow"], d["closed"]), (1, 1, 0, 1))
        self.assertFalse(B.measure(B.items(self.root), b, cl, NOW, self.c)["tipped"])

    def test_sla_by_priority(self):
        mk(self.root, "Q-A-1", labels=["p0"]); mk(self.root, "Q-A-2")
        b = {"Q-A-1.json": iso(NOW - timedelta(days=3)), "Q-A-2.json": iso(NOW - timedelta(days=3))}
        m = B.measure(B.items(self.root), b, {}, NOW, self.c)
        self.assertEqual([r["id"] for r in m["sla"]["worst"]], ["Q-A-1"]); self.assertTrue(m["tipped"])

    def test_duplicates_need_same_title_trigger_and_probe(self):
        mk(self.root, "OL-PR-1", title="OL-PR-1: land PR #1"); mk(self.root, "OL-PR-2", title="OL-PR-2: land PR #2")
        mk(self.root, "Q-X-1", title="Q-X-1: fix the widget renderer"); mk(self.root, "Q-X-2", title="Q-X-2: fix the widget renderer")
        mk(self.root, "Q-X-3", title="Q-X-3: fix the widget renderer", trigger="other")
        b = {f"{i}.json": iso(NOW - timedelta(days=k + 2)) for k, i in enumerate(["Q-X-1", "Q-X-2", "Q-X-3", "OL-PR-1", "OL-PR-2"])}
        acts = B.consolidate(B.items(self.root), b, NOW, self.c)
        self.assertEqual([(a["id"], a["by"]) for a in acts if a["act"] == "supersede"], [("Q-X-1", "Q-X-2")])

    def test_flood_is_batched_and_batch_probe_waits_for_members(self):
        for n in range(7):
            mk(self.root, f"Q-RES-{n}", title=f"Q-RES-{n}: finding {n}")
        b = {f"Q-RES-{n}.json": iso(NOW - timedelta(hours=3)) for n in range(7)}
        acts = B.consolidate(B.items(self.root), b, NOW, self.c)
        self.assertEqual([a["act"] for a in acts], ["batch"])
        B.apply_actions(self.root, B.items(self.root), acts, NOW)
        bid = acts[0]["id"]
        self.assertFalse(B.batch_probe(self.root, bid)[0])
        self.assertTrue(all(i["disposition"] == "superseded" for i in B.items(self.root) if i["id"].startswith("Q-RES-")))
        for n in range(7):
            mk(self.root, f"Q-RES-{n}", status="closed", disp="fixed")
        self.assertTrue(B.batch_probe(self.root, bid)[0])

    def test_admit_throttles_only_when_tipped_and_spent(self):
        self.assertTrue(B.admit(self.root))
        (self.root / "ops").mkdir()
        (self.root / B.STATE).write_text(json.dumps({"throttle": {"on": True, "quota_left": 0}}))
        self.assertFalse(B.admit(self.root))
        (self.root / B.STATE).write_text(json.dumps({"throttle": {"on": False}}))
        self.assertTrue(B.admit(self.root))

    def test_gate_holds_new_files_over_quota_and_releases_later(self):
        import subprocess
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        for n, lab in ((1, "p2"), (2, "p0"), (3, "p2")):
            mk(self.root, f"Q-N-{n}", labels=[lab])
        tipped = {"tipped": True, "throttle": {"quota_left": 1}}
        out = B.gate(self.root, apply=True, now=NOW, m=tipped)
        self.assertEqual((out["admitted"], sorted(out["held"])), (["Q-N-2"], ["Q-N-1", "Q-N-3"]))
        self.assertFalse((self.root / "docs/issues/Q-N-1.json").exists())
        out = B.gate(self.root, apply=True, now=NOW, m={"tipped": False})
        self.assertEqual(sorted(out["released"]), ["Q-N-1", "Q-N-3"])
        self.assertTrue((self.root / "docs/issues/Q-N-3.json").exists())
        self.assertEqual(B.gate(self.root, apply=True, now=NOW, m={"tipped": False})["released"], [])

    def test_rules(self):
        self.assertEqual(B.check(), [])


if __name__ == "__main__":
    unittest.main()
