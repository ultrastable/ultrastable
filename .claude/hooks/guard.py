#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""GUARD-HOOK-1 (kernel 9.0.0 R4, F3): Claude Code PreToolUse hook. Exit 2 blocks the tool call and shows the reason; exit 0 allows it.

A tripwire, not a security boundary: the boundary is branch protection, the lane's merge identity and token scope. It blocks only what is never
right for an agent: editing the owner's kill switches or the pinned kernel text, skipping hooks, force-pushing, and pushing to main. Protected
paths such as .github/ stay editable with a Protected-change line (AGENTS.md); this hook does not replace that rule.
"""
import json, os, re, subprocess, sys

NEVER_EDIT = re.compile(r"(^|/)(actions-budget\.json|ops/halt\.json|kernel/kernel\.lock|doctrine/kernel-9\.0\.0\.md|doctrine/kernel-8\.2\.1\.md)$")
NEVER_RUN = re.compile(r"--no-verify|\bgit\s+push\b[^\n;&|]*(\s-f\b|--force(?!-with-lease)|\s\+\S)|\bgit\s+push\b[^\n;&|]*\s(origin\s+)?(main|master)(\s|$)|"
                       r"\b(rm|mv|truncate)\b[^\n;&|]*(actions-budget\.json|ops/halt\.json|kernel/kernel\.lock)")


def verdict(event: dict) -> str | None:
    tool, inp = event.get("tool_name", ""), event.get("tool_input") or {}
    path = str(inp.get("file_path") or inp.get("notebook_path") or "")
    if tool in ("Edit", "Write", "MultiEdit", "NotebookEdit") and NEVER_EDIT.search(path.replace("\\", "/")):
        return f"BLOCKED (kernel 9.0.0 R4): {path} is the owner's kill switch or the pinned kernel text. Record the change you need as a flagged item instead."
    if tool == "Bash" and NEVER_RUN.search(str(inp.get("command", ""))):
        return "BLOCKED (kernel 9.0.0 R4/F3): skipping hooks, force-pushing, pushing to main or removing a kill switch. Push a branch and open a pull request; the lane merges."
    if tool == "Bash":
        hit = clobbers(str(inp.get("command", "")), event.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or ".")
        if hit:
            return (f"BLOCKED (NO-CLOBBER-1): `>` would overwrite {hit}, a file git already tracks. Read it and change it with Edit, or pick a new name; "
                    "a shell redirect skips the read-before-write check (2026-11-27: a new test file replaced an existing one this way).")
    return None


REDIRECT = re.compile(r"(?<![>&\d])>(?!>|&)\s*([^\s;&|<>]+)")


def clobbers(cmd: str, cwd: str) -> str | None:
    """The first `> FILE` target in the command that git tracks under cwd (appends `>>`, fd redirects and /dev/null are fine)."""
    for t in REDIRECT.findall(cmd):
        t = t.strip("'\"")
        if not t or t.startswith(("/dev/", "/tmp/", "$")):
            continue
        r = subprocess.run(["git", "-C", cwd, "ls-files", "--error-unmatch", "--", t], capture_output=True, text=True)
        if r.returncode == 0:
            return t
    return None


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except ValueError:
        return 0  # no event to judge: never block on the hook's own input error
    v = verdict(event)
    if v:
        print(v, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
