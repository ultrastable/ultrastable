# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""STANDARDS-FIRST-1: the CloudEvents 1.0 envelope (foundation/cloudevents.py) and its use on the provenance path."""
import json, sys, unittest
from pathlib import Path
from foundation import cloudevents as CE, ledger, provenance as PV
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
VEC = json.loads((REPO / "seed/standards/cloudevents-vectors.json").read_text(encoding="utf-8"))


class Envelope(unittest.TestCase):
    def test_shared_vectors_valid_events_conform(self):
        for e in VEC["valid"]:
            self.assertEqual(CE.conforms(e), [], e)

    def test_shared_vectors_invalid_events_are_refused(self):
        for v in VEC["invalid"]:
            self.assertTrue(CE.conforms(v["event"]), v["why"])

    def test_event_has_the_required_attributes_and_a_reverse_dns_type(self):
        e = CE.event("handoff", "merged", "/tenants/ultrastable/loops/handoff", {"state": "merged"}, subject="ultrastable/ultrastable#12")
        self.assertEqual(CE.conforms(e), [])
        self.assertEqual((e["specversion"], e["type"], e["datacontenttype"]), ("1.0", "io.ultrastable.handoff.merged", "application/json"))
        self.assertRegex(e["time"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertTrue(e["id"])

    def test_an_object_as_extension_attribute_is_refused(self):
        with self.assertRaises(ValueError):
            CE.event("a", "b", "/s", {}, extensions={"origin": {"class": "loop"}})

    def test_unwrap_returns_the_payload_and_leaves_older_rows_alone(self):
        old = {"id": "pv-1", "at": "2026-11-01T00:00:00Z", "kind": "change"}
        self.assertIs(CE.unwrap(old), old)
        self.assertEqual(CE.unwrap(CE.event("provenance", "change", "/s", old)), old)
        foreign = {"specversion": "1.0", "id": "1", "source": "/x", "type": "com.example.thing", "data": {"a": 1}}
        self.assertIs(CE.unwrap(foreign), foreign)


class ProvenancePath(unittest.TestCase):
    def setUp(self):
        self.root = Path(scratch())
        (self.root / "doctrine").mkdir()
        (self.root / "doctrine/provenance.json").write_text((REPO / "doctrine/provenance.json").read_text(encoding="utf-8"), encoding="utf-8")
        self.cfg = PV.load(self.root)

    def _origin(self):
        return {"class": self.cfg["origin_classes"][0] if isinstance(self.cfg["origin_classes"], list) else sorted(self.cfg["origin_classes"])[0], "actor": "test loop", "channel": self.cfg["channels"][0]}

    def test_a_new_provenance_row_is_written_as_a_cloudevent(self):
        row = PV.record(self.root, PV.make(self._origin(), self.cfg["kinds"][0], "one fact", ref="docs/issues/Q-1.json", cfg=self.cfg))
        line = json.loads((self.root / self.cfg["ledger"]).read_text(encoding="utf-8").splitlines()[-1])
        self.assertEqual(CE.conforms(line), [])
        self.assertEqual(line["type"], "io.ultrastable.provenance." + self.cfg["kinds"][0])
        self.assertEqual((line["id"], line["subject"], line["time"], line["data"]), (row["id"], "docs/issues/Q-1.json", row["at"], row))
        self.assertNotRegex(line["source"], r"\s")

    def test_old_rows_and_new_envelopes_read_as_one_ledger(self):
        led = self.root / self.cfg["ledger"]; led.parent.mkdir(parents=True, exist_ok=True)
        old = PV.make(self._origin(), self.cfg["kinds"][0], "written before the envelope", at="2026-11-01T00:00:00Z", cfg=self.cfg)
        led.write_text(json.dumps(old, sort_keys=True) + "\n", encoding="utf-8")
        new = PV.record(self.root, PV.make(self._origin(), self.cfg["kinds"][0], "written after", at="2026-11-02T00:00:00Z", cfg=self.cfg))
        self.assertEqual([r["id"] for r in ledger.rows(self.root, self.cfg["ledger"], branch=False)], [old["id"], new["id"]])
        self.assertEqual([r["summary"] for r in PV.entries(self.root)], ["written before the envelope", "written after"])

    def test_recording_the_same_fact_twice_writes_one_line(self):
        row = PV.make(self._origin(), self.cfg["kinds"][0], "once", at="2026-11-02T00:00:00Z", cfg=self.cfg)
        PV.record(self.root, row); PV.record(self.root, row)
        self.assertEqual(len((self.root / self.cfg["ledger"]).read_text(encoding="utf-8").splitlines()), 1)


if __name__ == "__main__":
    unittest.main()
