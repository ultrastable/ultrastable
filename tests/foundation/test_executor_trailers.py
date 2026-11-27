# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""ZHC-R7: executor commits carry provenance trailers set by code."""
import os
import unittest
from unittest import mock

from foundation import executor


class Trailers(unittest.TestCase):
    def test_trailers_name_agent_model_item_and_run(self):
        with mock.patch.dict(os.environ, {"GITHUB_RUN_ID": "42"}):
            t = executor.trailers("Q-1", {"models": ["@cf/a", "@cf/meta/llama"]})
        for line in ("Agent: ultrastable-agent/executor", "Model: @cf/meta/llama", "Work-Item: Q-1", "Run-Id: 42", "Assisted-by: executor:@cf/meta/llama"):
            self.assertIn(line, t.splitlines())

    def test_a_run_with_no_model_says_so(self):
        self.assertIn("Model: none", executor.trailers("Q-2", {}))


if __name__ == "__main__":
    unittest.main()
