#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""Check that a pull request follows the self-hosting contract (agents/CONTRACT.md), whatever tool made it.

  python tools/selfhost_check.py --body-file pr.md --author someone --files "a.py,b.md" [--labels "x,y"]

Exit 0 when the pull request carries the record the contract asks for, 1 with the list of problems otherwise.
Exempt authors are data (EXEMPT_AUTHORS: the dependency bot and the workflow-generated change login). Stdlib only.

Automated protected-path gate (US-20-R07, US-20-R08, CLOSED-LOOP-AXIOM; parity with the platform's scripts/protected_paths.py):
  --name-status FILE      `git diff --name-status` output: deleting a guard file fails
  --codeowners-diff FILE  diff of .github/CODEOWNERS: with --closed-loop, adding a human approver line fails
  --other-prs FILE        JSON [{"number": n, "files": [...]}] of the other open pull requests (US-20-R08): a second open
                          pull request on the same protected group is reported; --number N names this pull request
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# One list of protected paths (US-20-R07). A trailing slash is a directory. Every path in .github/CODEOWNERS is covered by it.
PROTECTED = (
    "AGENTS.md", "CLAUDE.md", "GEMINI.md", ".github/", ".cursor/", "autonomy/", "self/", "SCOPE.md", "LICENSE",
    "COMMERCIAL-TERMS.md", "core/test/no-qnfo.test.js", "agents/CONTRACT.md", "tools/selfhost_check.py", "tools/spec_truth.py",
    "tools/sync_agent_files.py", "tools/sync_agent_bootstrap.py", "tools/self_closed_lint.py",
)
# Guard files: deleting one is never a protected change that passes (US-20-R07).
GUARDS = ("tools/selfhost_check.py", "tools/spec_truth.py", "core/test/no-qnfo.test.js")
# Protected groups: one open change per group at a time so its effect is attributable (US-20-R08).
GROUPS = {
    "agent-instructions": ("AGENTS.md", "CLAUDE.md", "GEMINI.md", ".cursor/", "agents/CONTRACT.md", ".github/copilot-instructions.md",
                           "tools/sync_agent_files.py", "tools/sync_agent_bootstrap.py", "tools/self_closed_lint.py"),
    "ci-workflows": (".github/workflows/", ".github/CODEOWNERS", ".github/pull_request_template.md", ".github/ISSUE_TEMPLATE/"),
    "policy-and-autonomy": ("autonomy/", "self/"),
    "guards": ("core/test/no-qnfo.test.js", "tools/selfhost_check.py", "tools/spec_truth.py"),
    "scope-and-license": ("SCOPE.md", "LICENSE", "COMMERCIAL-TERMS.md"),
}
# Exempt authors (US-20-R03, US-20-R15): the dependency bot, and the login the workflow-generated agent-file refresh runs as.
EXEMPT_AUTHORS = ("dependabot[bot]", "github-actions[bot]")
PREDICTION = re.compile(r"^[A-Za-z_][\w.]*\s*(>=|<=|>|<|=)\s*-?\d+(\.\d+)?\s+within\s+\d+\s*h\b", re.I)


def field(body: str, name: str) -> str | None:
    m = re.search(rf"^\s*[-*]?\s*\**{re.escape(name)}\**:[ \t]*(.+?)[ \t]*$", body, re.I | re.M)
    return m.group(1).strip() if m else None


def is_placeholder(v: str | None) -> bool:
    return v is None or not v.strip() or bool(re.fullmatch(r"[<\[].*[>\]]|todo|tbd|\.\.\.|-", v.strip(), re.I))


def _under(f: str, p: str) -> bool:
    return f == p or (p.endswith("/") and f.startswith(p))


def protected(files: list[str]) -> list[str]:
    return [f for f in files if any(_under(f, p) for p in PROTECTED)]


def party(s: str | None) -> str:
    """Normalise an Author or Reviewer for comparison: case, punctuation and spacing do not make a different party."""
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def codeowners_paths(text: str) -> list[str]:
    """The paths a CODEOWNERS file assigns, without the leading slash (a directory keeps its trailing slash)."""
    out = []
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.append(line.split()[0].lstrip("/"))
    return out


def deleted_guards(name_status: str) -> list[str]:
    """Guard files deleted (or renamed away) in `git diff --name-status` output."""
    bad = []
    for line in name_status.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and parts[0][:1] in ("D", "R") and parts[1] in GUARDS:
            bad.append(parts[1])
    return bad


def added_human_approver(codeowners_diff: str) -> list[str]:
    """Lines a diff of .github/CODEOWNERS adds that name a human (@user) as an approver."""
    return [l[1:].strip() for l in codeowners_diff.splitlines() if re.match(r"^\+[^+#\s]+\s+@\w", l)]


def groups_of(files: list[str]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for f in files:
        for g, paths in GROUPS.items():
            if any(_under(f, p) for p in paths):
                out.setdefault(g, []).append(f)
    return out


def overlapping(files: list[str], other_prs: list[dict], me: int | None = None) -> list[str]:
    """US-20-R08: report another open pull request that touches a protected group this one touches."""
    mine = groups_of(files)
    problems = []
    for pr in other_prs:
        if me is not None and pr.get("number") == me:
            continue
        for g in sorted(set(mine) & set(groups_of(list(pr.get("files", []))))):
            problems.append(f"One change per protected component at a time: pull request #{pr.get('number')} also touches {g} (" + ", ".join(sorted(set(mine[g]))[:3]) + "). Merge or close one first.")
    return problems


def check(body: str, author: str, files: list[str], labels: list[str]) -> list[str]:
    if author.lower() in EXEMPT_AUTHORS:
        return []
    problems: list[str] = []
    item = field(body, "Item")
    if is_placeholder(item) or not re.search(r"(#\d+|github\.com/[^\s]+/issues/\d+)", item or ""):
        problems.append("Item: must link the issue this work belongs to (#123 or an issue URL). No issue, no work.")
    spec = field(body, "Spec")
    if is_placeholder(spec) or not re.search(r"US-\d{2}-R\d+|US-SPEC-\d+|n/a", spec or "", re.I):
        problems.append("Spec: must name requirement ids (for example US-08-R03 or US-SPEC-08) or say n/a with a reason.")
    pred = field(body, "Prediction")
    if is_placeholder(pred) or not (PREDICTION.match(pred or "") or re.match(r"n/a\b.{3,}", pred or "", re.I)):
        problems.append("Prediction: must be '<metric> <op> <number> within <N> h' (for example core_tests_passing >= 160 within 1 h) or 'n/a' with a reason.")
    ev = field(body, "Evidence")
    if is_placeholder(ev) or len(ev or "") < 12 or not re.search(r"\d", ev or ""):
        problems.append("Evidence: must quote real output (a test summary with numbers), not a description.")
    a, r = field(body, "Author"), field(body, "Reviewer")
    if is_placeholder(a):
        problems.append("Author: must name who or what wrote this (a tool and model, or a person).")
    if is_placeholder(r):
        problems.append("Reviewer: must name a different agent, model or person who reviews it.")
    elif not is_placeholder(a) and party(a) == party(r):
        problems.append("Reviewer: must differ from Author. Never review your own work.")
    hits = protected(files)
    if hits:
        why = field(body, "Protected-change")
        if is_placeholder(why) or len(why or "") < 12:
            problems.append("Protected-change: required because this touches protected paths (" + ", ".join(hits[:5]) + "); give the reason, and a human reviewer must approve.")
        if "human-reviewed" not in [l.lower() for l in labels] and "protected-change" not in [l.lower() for l in labels]:
            problems.append("Add the label 'protected-change': protected paths need a human reviewer (CODEOWNERS enforces it).")
    return problems


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--body-file", type=Path, required=True)
    ap.add_argument("--author", required=True)
    ap.add_argument("--files", default="", help="comma-separated changed paths")
    ap.add_argument("--labels", default="", help="comma-separated labels")
    ap.add_argument("--name-status", type=Path, help="git diff --name-status output (guard deletion check)")
    ap.add_argument("--codeowners-diff", type=Path, help="diff of .github/CODEOWNERS")
    ap.add_argument("--closed-loop", action="store_true", help="refuse a human approver added to CODEOWNERS (the automated gate replaces human approval)")
    ap.add_argument("--other-prs", type=Path, help="JSON list of the other open pull requests: [{number, files}]")
    ap.add_argument("--number", type=int, default=None, help="this pull request's number (excluded from --other-prs)")
    a = ap.parse_args(argv)
    body = a.body_file.read_text(encoding="utf-8") if a.body_file.exists() else ""
    files = [f.strip() for f in a.files.split(",") if f.strip()]
    labels = [l.strip() for l in a.labels.split(",") if l.strip()]
    problems = check(body, a.author, files, labels)
    exempt = a.author.lower() in EXEMPT_AUTHORS
    if not exempt:
        if a.name_status and a.name_status.exists():
            problems += [f"{g}: a guard file is deleted; guards are never weakened to make a change pass (revert first)." for g in deleted_guards(a.name_status.read_text(encoding="utf-8"))]
        if a.closed_loop and a.codeowners_diff and a.codeowners_diff.exists():
            problems += [f"CODEOWNERS: a human approver was added ({l}); the automated gate replaces human approval (CLOSED-LOOP-AXIOM)." for l in added_human_approver(a.codeowners_diff.read_text(encoding="utf-8"))]
        if a.other_prs and a.other_prs.exists():
            problems += overlapping(files, json.loads(a.other_prs.read_text(encoding="utf-8")), a.number)
    if problems:
        print("This pull request does not yet follow the self-hosting contract (agents/CONTRACT.md):", file=sys.stderr)
        for p in problems:
            print(" - " + p, file=sys.stderr)
        return 1
    print("self-hosting contract: ok" + (" (protected paths touched: human review required)" if protected(files) else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
