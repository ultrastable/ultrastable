# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import unittest
from foundation import staticcontent as sc

RULES = {"max_unchanged_days": 14, "max_pages": 5, "exempt": [{"pattern": "/terms", "reason": "policy"}]}


class StaticContent(unittest.TestCase):
    def test_markup_and_scripts_are_not_a_change(self):
        a = "<html><script>n=1</script><p class=a>Hello  world</p></html>"
        b = "<html><script>n=2</script><p class=b>Hello world</p></html>"
        self.assertEqual(sc.digest(a), sc.digest(b))
        self.assertNotEqual(sc.digest(a), sc.digest("<p>Hello again</p>"))

    def test_row_moves_only_when_the_page_does(self):
        led = sc.observe({}, {"u": "<p>a</p>"}, "2026-11-01")
        same = sc.observe(led, {"u": "<p>a</p>"}, "2026-11-10")
        self.assertEqual(same, led)
        moved = sc.observe(led, {"u": "<p>b</p>"}, "2026-11-10")
        self.assertEqual((moved["u"]["first_seen"], moved["u"]["last_changed"]), ("2026-11-01", "2026-11-10"))
        self.assertEqual(sc.observe(led, {"u": None}, "2026-11-10"), led)  # unreadable is neither a change nor a pass

    def test_static_page_is_a_finding(self):
        led = {"https://x/a": {"hash": "h", "first_seen": "2026-10-01", "last_changed": "2026-10-01"},
               "https://x/terms": {"hash": "h", "first_seen": "2026-10-01", "last_changed": "2026-10-01"},
               "https://x/live": {"hash": "h", "first_seen": "2026-10-01", "last_changed": "2026-11-20"}}
        r = sc.judge(led, "2026-11-25", RULES)
        self.assertEqual([x["url"] for x in r["static"]], ["https://x/a"])
        self.assertEqual(r["watched"], 2)

    def test_young_ledger_is_unmeasured_not_a_pass(self):
        led = {"u": {"hash": "h", "first_seen": "2026-11-20", "last_changed": "2026-11-20"}}
        r = sc.judge(led, "2026-11-25", RULES)
        self.assertFalse(r["measured"])
        self.assertEqual(r["static"], [])


if __name__ == "__main__":
    unittest.main()
