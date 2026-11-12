"""Loop closure as code: the registry verifier fails when a loop is open."""
import unittest
from _repo import ROOT, copy_repo, edit
from foundation import loops

REG = "instances/ultrastable/loop-registry.json"


def one(r, fn, lid="plussing"):
    edit(r / REG, lambda d: fn(next(l for l in d["loops"] if l["id"] == lid)))


class Registry(unittest.TestCase):
    def test_repo_loops_verify_clean(self):
        self.assertEqual(loops.verify(ROOT), [])

    def test_loop_without_closing_probe_fails(self):
        r = copy_repo(); one(r, lambda l: l.pop("closing_probe"))
        self.assertTrue(any("plussing: lacks closing_probe" in p for p in loops.verify(r)))

    def test_failing_closing_probe_fails(self):
        r = copy_repo(); one(r, lambda l: l.update(closing_probe="file:nope/missing.md"))
        self.assertTrue(any("closing probe fails" in p for p in loops.verify(r)))

    def test_loop_without_writeback_fails(self):
        r = copy_repo(); one(r, lambda l: l.update(writeback=[]))
        self.assertTrue(any("lacks writeback" in p for p in loops.verify(r)))
        r = copy_repo(); one(r, lambda l: l.update(writeback=["https://example.com/notes"]))
        self.assertTrue(any("outside the repository" in p for p in loops.verify(r)))
        r = copy_repo(); one(r, lambda l: l.update(writeback=["/mnt/project-files/x.md"]))
        self.assertTrue(any("outside the repository" in p for p in loops.verify(r)))

    def test_writeback_outside_repo_fails(self):
        r = copy_repo(); one(r, lambda l: l.update(writeback=["docs/not-there.md"]))
        self.assertTrue(any("does not exist" in p for p in loops.verify(r)))

    def test_workflow_not_claimed_by_a_loop_fails(self):
        r = copy_repo(); (r / ".github/workflows/extra.yml").write_text("name: extra\n")
        self.assertTrue(any("extra.yml belongs to no loop" in p for p in loops.verify(r)))

    def test_launch_loop_not_in_registry_fails(self):
        r = copy_repo(); edit(r / "instances/ultrastable/loops.json", lambda d: d["loops"].append({"id": "extra", "what": "x", "mode": "live", "probe": "file:foundation/launch.py"}))
        self.assertTrue(any("launch loop extra" in p for p in loops.verify(r)))

    def test_every_role_has_a_loop(self):
        r = copy_repo(); edit(r / REG, lambda d: d.update(loops=[l for l in d["loops"] if l["owner"] != "reviewer"]))
        self.assertTrue(any("role reviewer has no" in p for p in loops.verify(r)))
        r = copy_repo(); edit(r / REG, lambda d: d.update(loops=[l for l in d["loops"] if l.get("area") != "memory"]))
        self.assertTrue(any("process area 'memory' has no loop" in p for p in loops.verify(r)))

    def test_every_loop_closes_by_the_system_or_a_gate_card(self):
        r = copy_repo(); one(r, lambda l: l.update(closes_by="owner"))
        self.assertTrue(any("closes_by must be" in p for p in loops.verify(r)))
        r = copy_repo(); one(r, lambda l: l.update(closes_by="gate:docs/no-card.md"))
        self.assertTrue(any("closes_by must be" in p for p in loops.verify(r)))
        r = copy_repo(); one(r, lambda l: l.update(owner="nobody"))
        self.assertTrue(any("is not a role" in p for p in loops.verify(r)))

    def test_loop_needs_sla_done_and_two_paths(self):
        r = copy_repo(); one(r, lambda l: l.update(sla="soon"))
        self.assertTrue(any("not a time bound" in p for p in loops.verify(r)))
        r = copy_repo(); one(r, lambda l: l.pop("done"))
        self.assertTrue(any("lacks done" in p for p in loops.verify(r)))
        r = copy_repo(); one(r, lambda l: l.update(paths=l["paths"][:1]))
        self.assertTrue(any("two independent paths" in p for p in loops.verify(r)))
        r = copy_repo(); one(r, lambda l: l["paths"][1].update(id=l["paths"][0]["id"]))
        self.assertTrue(any("two independent paths" in p for p in loops.verify(r)))

    def test_paid_path_needs_free_fallback(self):
        r = copy_repo(); one(r, lambda l: l.update(paths=[{"id": "a", "how": "x", "class": "paid"}, {"id": "b", "how": "y", "class": "external"}]))
        self.assertTrue(any("free, session or degraded" in p for p in loops.verify(r)))

    def test_credential_has_one_source(self):
        r = copy_repo(); edit(r / REG, lambda d: d["credentials"].append(dict(d["credentials"][0], source="docs/ops/ORG-TOKEN.md")))
        self.assertTrue(any("more than one source" in p for p in loops.verify(r)))
        r = copy_repo(); one(r, lambda l: l.update(credentials=["UNREGISTERED"]))
        self.assertTrue(any("no registered one source" in p for p in loops.verify(r)))
        r = copy_repo(); edit(r / REG, lambda d: d["credentials"][0].pop("probe"))
        self.assertTrue(any("one source and a live probe" in p for p in loops.verify(r)))

    def test_program_loop_needs_orient_originate_predict(self):
        r = copy_repo(); one(r, lambda l: l["program"].pop("originate_to"), "role-portfolio-manager")
        self.assertTrue(any("lacks originate_to" in p for p in loops.verify(r)))
        r = copy_repo(); one(r, lambda l: l["program"].update(predict_log="docs/none"), "role-portfolio-manager")
        self.assertTrue(any("program path docs/none" in p for p in loops.verify(r)))


if __name__ == "__main__":
    unittest.main()
