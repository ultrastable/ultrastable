# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""STRAYS-1: no code file sits where nothing runs it. NATIVE-STUB-1 refuses such a write in the tick Worker's own executor, but two other routes
carried the same files to main: the branch sweep merged model branches (#698 brought scoreboard.py and src/connector/probe.js), and the Actions
executor answered "fix checks.yml" with github/workflows/checks.yml, a workflow GitHub never runs (#732). This check is the one rule every route
shares: it runs in `checks` and in the branch sweep's gate, so a branch that adds a stray is undone and filed as a PORT-BRANCH item, never merged.

  python3 -m foundation strays --check          fail on a stray code file, a decoy workflow, or a baseline entry that no longer exists
  python3 -m foundation strays --list [--json]  every finding

A stray is a tracked code file (policy `extensions`) at the repository root or under a top-level directory that is not in `code_roots`.
A decoy workflow is a YAML file in a `workflows/` directory that is neither `.github/workflows/` nor a `workflow_template_dirs` entry
(templates an adapter installs elsewhere). Policy: doctrine/strays.json; `baseline` is shrink-only.
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
POLICY = "doctrine/strays.json"
WORKFLOW_RE = re.compile(r"(?:^|/)workflows/[^/]+\.ya?ml$")
LIVE_WORKFLOW_RE = re.compile(r"(?:^|/)\.github/workflows/[^/]+\.ya?ml$")


def policy(root=REPO) -> dict:
    return json.loads((Path(root) / POLICY).read_text(encoding="utf-8"))


def tracked(root=REPO) -> list[str]:
    p = subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, timeout=60)
    if p.returncode != 0:
        raise RuntimeError("git ls-files: " + p.stderr.decode("utf-8", "replace").strip()[:200])
    return [x for x in p.stdout.decode("utf-8", "replace").split("\0") if x]


def classify(paths, pol: dict) -> list[dict]:
    """Pure: the findings for a list of repository-relative paths."""
    roots, ext, base = set(pol["code_roots"]), tuple(pol["extensions"]), set(pol.get("baseline") or [])
    templates = set(pol.get("workflow_template_dirs") or [])  # workflows an adapter installs into another repository's .github/workflows/
    out = []
    for p in sorted(paths):
        if p in base:
            continue
        if WORKFLOW_RE.search(p) and not LIVE_WORKFLOW_RE.search(p) and p.rsplit("/", 1)[0] not in templates:
            out.append({"path": p, "kind": "decoy-workflow", "why": "a workflow outside .github/workflows/ is never run"})
        elif p.endswith(ext):
            top = p.split("/", 1)[0] if "/" in p else ""
            if not top and p in (pol.get("root_data_files") or {}):
                continue  # a standard descriptor that tools look for at the root (data, not code); each has a reason in the policy
            if not top:
                out.append({"path": p, "kind": "stray-root", "why": "a code file at the repository root that no code root holds"})
            elif top not in roots:
                out.append({"path": p, "kind": "stray-dir", "why": f"top-level directory {top}/ is not a code root in {POLICY}"})
    return out


def check(root=REPO) -> list[str]:
    pol, paths = policy(root), tracked(root)
    fails = [f"{f['kind']}: {f['path']} ({f['why']})" for f in classify(paths, pol)]
    have = set(paths)
    fails += [f"baseline entry no longer exists (shrink the baseline): {b}" for b in pol.get("baseline") or [] if b not in have]
    fails += [f"code root has no tracked file (remove it): {r}/" for r in pol["code_roots"] if not any(p.startswith(r + "/") for p in paths)]
    return fails


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--list" in argv:
        found = classify(tracked(REPO), policy(REPO))
        print(json.dumps(found, indent=1) if "--json" in argv else "\n".join(f"{f['kind']}\t{f['path']}" for f in found) or "strays: none")
        return 0
    fails = check(REPO)
    for f in fails:
        print("strays: " + f, file=sys.stderr)
    print(f"strays: {len(fails)} failure(s)" if fails else "strays ok")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
