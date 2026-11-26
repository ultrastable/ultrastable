import datetime as dt, json, unittest
from foundation import worklog as w


class Fake:
    def __init__(self, issues): self.issues, self.calls = issues, []
    def __call__(self, *a, inp=None):
        self.calls.append((a, inp))
        if a[0] == "api" and "--paginate" in a:
            return 0, "\n".join(json.dumps(i) for i in self.issues)
        return 0, json.dumps({"html_url": "https://github.com/x/y/issues/9"})


class WorkRecord(unittest.TestCase):
    def test_roundtrip(self):
        r = w.new_record("g", "s1", "d", "n")
        self.assertEqual(w.parse(w.render(r)), r)

    def test_reap_redispatches_silent(self):
        old = w.new_record("g", "s1", "d", "n", now=dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc))
        fresh = w.new_record("h", "s2", "d")
        gh = Fake([{"number": 1, "title": "g", "url": "u", "body": w.render(old), "labels": []},
                   {"number": 2, "title": "h", "url": "u", "body": w.render(fresh), "labels": []}])
        self.assertEqual(w.reap(apply=True, hours=6, gh=gh), [1])
        bodies = [json.loads(c[1]) for c in gh.calls if c[1]]
        self.assertEqual(w.parse(bodies[0]["body"])["owner"], "server-lane")
        self.assertEqual(bodies[1]["labels"], ["resume", "queue"])

    def test_check_passes(self):
        self.assertEqual(w.check(), [])


if __name__ == "__main__":
    unittest.main()
