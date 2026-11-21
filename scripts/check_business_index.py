# SPDX-License-Identifier: LicenseRef-Ultrastable
# Copyright (c) Ultrastable
"""BIZ-3 shim. The business index moved out of this template with the admin papers (TEMPLATE-CODE-ONLY-1); the check passes
while no business/ directory exists and fails if one comes back, so the workflow step that calls it stays honest."""
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent.parent
if (root / "business").exists():
    print("business/ is back in the template: admin papers live in ultrastable/ops (TEMPLATE-CODE-ONLY-1)")
    sys.exit(1)
print("business index: not in this template (moved to ultrastable/ops)")
