# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""GH-MIRROR-1: the docs/issues queue is mirrored one way onto GitHub Issues."""
import io, json, tempfile, unittest, urllib.error
from pathlib import Path

from foundation import ghmirror as m


def item(iid, status="open", ms="Now", labels=("p1", "role:staff")):
    return {"id": iid, "title": f"{iid}: do it", "body": f"**Owner:** staff\n**Done check:** file:x\n**Status:** {status}\n", "labels": list(labels), "milestone": ms}


class FakeGitHub:
    """Enough of the REST API for the mirror: repo, labels, milestones, issues (list, create, patch)."""
    def __init__(self, has_issues=True):
        self.has_issues, self.labels, self.ms, self.issues, self.log = has_issues, [], [], [], []

    def __call__(self, req, timeout=60):
        method, url = req.get_method(), req.full_url.replace(m.API, "")
        body = json.loads(req.data) if req.data else None
        self.log.append((method, url))
        path = url.split("?")[0]
        if path == "/repos/o/r" and method == "GET":
            return self.resp(200, {"has_issues": self.has_issues})
        if path.endswith("/labels"):
            if method == "GET":
                return self.resp(200, [{"name": n} for n in self.labels])
            self.labels.append(body["name"]); return self.resp(201, {})
        if path.endswith("/milestones"):
            if method == "GET":
                return self.resp(200, self.ms)
            self.ms.append({"title": body["title"], "number": len(self.ms) + 1}); return self.resp(201, self.ms[-1])
        if path.endswith("/issues") and method == "GET":
            return self.resp(200, [i for i in self.issues if "queue" in [l["name"] for l in i["labels"]]])
        if path.endswith("/issues") and method == "POST":
            n = len(self.issues) + 1
            ms = next((x for x in self.ms if x["number"] == body.get("milestone")), None)
            self.issues.append({"number": n, "title": body["title"], "body": body["body"], "labels": [{"name": l} for l in body["labels"]],
                                "milestone": ms, "state": "open"})
            return self.resp(201, {"number": n})
        if "/issues/" in path and method == "PATCH":
            i = self.issues[int(path.rsplit("/", 1)[1]) - 1]
            for k in ("title", "body", "state"):
                if k in body:
                    i[k] = body[k]
            if "labels" in body:
                i["labels"] = [{"name": l} for l in body["labels"]]
            if "milestone" in body:
                i["milestone"] = next((x for x in self.ms if x["number"] == body["milestone"]), None)
            return self.resp(200, {})
        raise AssertionError(f"unexpected {method} {url}")

    @staticmethod
    def resp(status, js):
        if status >= 400:
            raise urllib.error.HTTPError("u", status, "x", {}, io.BytesIO(b""))
        r = io.BytesIO(json.dumps(js).encode()); r.status = status; r.headers = {"Link": ""}
        r.__enter__ = lambda *a: r; r.__exit__ = lambda *a: False
        return r


class Ctx:
    def __init__(self, r): self.r = r
    def __enter__(self): return self.r
    def __exit__(self, *a): return False


def opener(fake):
    return lambda req, timeout=60: Ctx(fake(req, timeout))


class GhMirrorTest(unittest.TestCase):
    def repo(self, items):
        t = tempfile.TemporaryDirectory(); self.addCleanup(t.cleanup)
        d = Path(t.name); (d / "docs/issues").mkdir(parents=True)
        for i in items:
            (d / f"docs/issues/{i['id']}.json").write_text(json.dumps(i))
        return d

    def test_desired_shape(self):
        w = m.desired(item("Q-1", status="closed", ms=None))
        self.assertEqual(w["state"], "closed")
        self.assertEqual(w["milestone"], "Done")
        self.assertIn("queue", w["labels"])
        self.assertIn("<!-- us-item:Q-1 -->", w["body"])
        self.assertEqual(m.desired(item("Q-2", status="open:"))["state"], "open")

    def test_mirror_creates_then_is_idempotent_and_follows_the_file(self):
        root = self.repo([item("Q-1"), item("Q-2", status="closed")])
        fake = FakeGitHub()
        first = m.run(root, token="t", repo="o/r", do_apply=True, opener=opener(fake))
        self.assertEqual(first["applied"]["created"], 2)
        self.assertEqual({i["state"] for i in fake.issues}, {"open", "closed"})
        self.assertIn("Now", [x["title"] for x in fake.ms])
        again = m.run(root, token="t", repo="o/r", do_apply=False, opener=opener(fake))
        self.assertEqual(again["pending"], {"label": 0, "milestone": 0, "create": 0, "update": 0, "orphan": 0})
        # a hand edit on GitHub is put back; a closed file closes the issue
        fake.issues[0]["title"] = "edited by hand"
        (root / "docs/issues/Q-1.json").write_text(json.dumps(item("Q-1", status="closed")))
        third = m.run(root, token="t", repo="o/r", do_apply=True, opener=opener(fake))
        self.assertEqual(third["applied"]["updated"], 1)
        self.assertEqual(fake.issues[0]["state"], "closed")
        self.assertEqual(fake.issues[0]["title"], "Q-1: do it")

    def test_write_cap_defers_the_rest(self):
        root = self.repo([item(f"Q-{n}") for n in range(5)])
        fake = FakeGitHub()
        from unittest import mock
        with mock.patch.object(m.time, "sleep", lambda s: None):
            res = m.run(root, token="t", repo="o/r", do_apply=True, max_writes=4, opener=opener(fake))
        self.assertEqual(res["status"], "partial")
        self.assertGreater(res["applied"]["deferred"], 0)

    def test_issues_off_and_no_token_are_states_not_crashes(self):
        root = self.repo([item("Q-1")])
        self.assertEqual(m.run(root, token="t", repo="o/r", opener=opener(FakeGitHub(has_issues=False)))["status"], "issues-off")
        from unittest import mock
        with mock.patch.dict(m.os.environ, {"GH_TOKEN": "", "GITHUB_TOKEN": ""}):
            self.assertEqual(m.run(root, token="", repo="o/r")["status"], "no-token")

    def test_removed_item_closes_its_issue(self):
        root = self.repo([item("Q-1"), item("Q-2")])
        fake = FakeGitHub()
        m.run(root, token="t", repo="o/r", do_apply=True, opener=opener(fake))
        (root / "docs/issues/Q-2.json").unlink()
        res = m.run(root, token="t", repo="o/r", do_apply=True, opener=opener(fake))
        self.assertEqual(res["applied"]["closed_orphans"], 1)

    def test_repository_queue_maps(self):
        self.assertEqual(m.check(), [])


if __name__ == "__main__":
    unittest.main()
