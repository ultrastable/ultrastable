import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import outreach


DIRECTORIES = {
    "endpoint": {
        "server_card_url": "https://ultrastable.dev/mcp/card.json",
        "skills_index_url": "https://ultrastable.dev/mcp/skills.json",
        "description": "Ultrastable autonomous software organization.",
    },
    "directories": [
        {
            "id": "mcp-registry",
            "submission_route": "POST /submit",
            "requires": ["server_card_url", "description"],
            "status": "pending-dry-run",
        }
    ],
}


class TestOutreach(unittest.TestCase):
    def test_every_directory_has_complete_packet(self):
        subs = outreach.build_submissions(DIRECTORIES)
        self.assertEqual(len(subs), 1)
        self.assertEqual(
            subs[0]["packet"],
            {
                "server_card_url": "https://ultrastable.dev/mcp/card.json",
                "description": "Ultrastable autonomous software organization.",
            },
        )

    def test_incomplete_packet_rejected(self):
        bad = {"directories": [{"id": "x", "submission_route": "r", "requires": ["server_card_url"], "status": "s"}],
               "endpoint": {"server_card_url": ""}}
        with self.assertRaises(ValueError):
            outreach.build_submissions(bad)

    def test_nothing_sent_while_gate_is_dry_run(self):
        called = []
        result = outreach.publish(DIRECTORIES, fetch=lambda route, packet: called.append(route))
        self.assertEqual(result["gate"], "dry-run")
        self.assertFalse(result["attempts"][0]["sent"])
        self.assertTrue(result["attempts"][0]["staged"])
        self.assertEqual(called, [])

    def test_live_gate_sends_via_injected_fetch(self):
        seen = {}
        def fetch(route, packet):
            seen[route] = packet
            return "accepted"
        result = outreach.publish(DIRECTORIES, fetch=fetch, gate_value="live")
        self.assertEqual(result["gate"], "live")
        self.assertTrue(result["attempts"][0]["sent"])
        self.assertIn("POST /submit", seen)

    def test_repository_listing_loads_and_validates(self):
        path = os.path.join(os.path.dirname(__file__), "..", "outreach", "agent-directories.json")
        data = outreach.load_directories(path)
        subs = outreach.build_submissions(data)
        self.assertTrue(len(subs) >= 5)
        result = outreach.publish(data)
        self.assertEqual(result["gate"], "dry-run")
        self.assertTrue(all(not a["sent"] for a in result["attempts"]))


if __name__ == "__main__":
    unittest.main()
