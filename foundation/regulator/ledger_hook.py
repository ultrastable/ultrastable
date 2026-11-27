# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""Experiment 1 feed: a Claude Code PostToolUse hook payload (JSON on stdin) becomes a token_log row.

settings: {"hooks": {"PostToolUse": [{"hooks": [{"type": "command", "command": "python3 -m foundation regulator hook --db .regulator.sqlite"}]}]}}
Token counts are estimated as len(text)//4 because the hook payload carries tool input and output, not provider usage.
"""
import json

KIND = {"Read": "read", "Grep": "read", "Glob": "read", "Bash": "execute", "Edit": "edit", "Write": "edit", "MultiEdit": "edit"}


def record(store, payload, task_id="session"):
    tool = payload.get("tool_name", "")
    inp = json.dumps(payload.get("tool_input", ""))
    out = json.dumps(payload.get("tool_response", ""))
    store.log_tokens(payload.get("session_id", task_id), "-", KIND.get(tool, "other"), len(out) // 4, len(inp) // 4)
