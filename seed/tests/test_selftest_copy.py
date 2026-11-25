# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""OUTCOME-PROBE-1: seed/scripts/selftest.py is the platform's foundation/selftest.py, so one fix reaches every system; its config loads."""
import json, subprocess, sys
from pathlib import Path

SEED = Path(__file__).resolve().parent.parent


def test_seed_selftest_matches_platform():
    plat = SEED.parent / "foundation" / "selftest.py"
    if plat.is_file():  # inside the platform repo; a seeded system has only its copy
        assert (SEED / "scripts/selftest.py").read_text() == plat.read_text()


def test_seed_selftest_config_runs():
    json.loads((SEED / "autonomy/selftest.json").read_text())
    r = subprocess.run([sys.executable, str(SEED / "scripts/selftest.py"), "--check"], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
