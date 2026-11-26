#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""Find the specifications' false BUILT labels: status lines that claim code which is not there.

A status line labelled BUILT must name, in backticks, at least one file or directory that exists in the code repository.
This is how Ultrastable finds its own untrue statements: each finding is a work item for the organization.

  python tools/spec_truth.py --spec-dir ../ultrastable-spec/specs --code-dir .            # report
  python tools/spec_truth.py --spec-dir ... --code-dir . --json                            # findings as JSON
  python tools/spec_truth.py --spec-dir ... --code-dir . --strict                          # exit 1 if any false BUILT
  python tools/spec_truth.py --spec-dir ... --code-dir . --tests                           # also: a BUILT line must name a test (US-20-R06)
  python tools/spec_truth.py --spec-dir ... --code-dir . --run                             # also: every named test must pass (implies --tests)

US-20-R06: "BUILT only if it names a file that exists and a test that passes". The default report checks the file half and is unchanged;
--tests checks that a test is named; --run executes each distinct named test file once (node --test for .test.js/.test.mjs, unittest for
Python) and reports a failing, missing or unrunnable test as a finding, never as a pass. Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HEADING = re.compile(r"^#{1,4}\s+(?:\d+\.\s+)?Reference implementation status", re.I)
ANY_HEADING = re.compile(r"^#{1,4}\s+")
TICKS = re.compile(r"`([^`\n]+)`")
PATHLIKE = re.compile(r"^[\w.\-/\\]+$")


def candidate_paths(text: str) -> list[str]:
    out = []
    for t in TICKS.findall(text):
        t = t.strip().rstrip("/")
        if "/" in t and PATHLIKE.match(t) and not t.startswith(("http", "/", "~")):
            out.append(t)
        elif re.match(r"^[\w\-]+\.(js|mjs|py|sql|json|jsonc|md|yml|toml|sh|html)$", t):
            out.append(t)
    return out


def exists(code_dir, rel: str) -> bool:
    if isinstance(code_dir, (list, tuple)):
        return any(exists(d, rel) for d in code_dir)
    rel = rel.replace("\\", "/")
    if (code_dir / rel).exists():
        return True
    # a bare filename counts if exactly findable somewhere in the tree (specs often name files without the directory)
    if "/" not in rel:
        return any(code_dir.rglob(rel))
    return False


TEST_BASENAME = re.compile(r"(\.test\.(m?js)|^test_[\w]+\.py)$")


def is_test_path(rel: str) -> bool:
    return bool(TEST_BASENAME.search(rel.split("/")[-1]))


def named_tests(line: str) -> list[str]:
    """The test files a status line names: *.test.js, *.test.mjs, test_*.py (a bare name is also accepted)."""
    out = []
    for t in TICKS.findall(line):
        t = t.strip()
        if is_test_path(t) and PATHLIKE.match(t):
            out.append(t)
    return out


def resolve(code_dir, rel: str):
    """The (directory, absolute path) where a named file lives, or None."""
    if isinstance(code_dir, (list, tuple)):
        for d in code_dir:
            r = resolve(d, rel)
            if r:
                return r
        return None
    rel = rel.replace("\\", "/")
    if (code_dir / rel).is_file():
        return code_dir, code_dir / rel
    if "/" not in rel:
        hit = next((p for p in code_dir.rglob(rel) if "node_modules" not in p.parts), None)
        if hit:
            return code_dir, hit
    return None


def run_test(base: Path, path: Path, timeout: int = 300) -> tuple[bool, str]:
    """Run one named test file where it lives. (ok, detail). A missing interpreter or a timeout is a failure, never a pass."""
    rel = path.relative_to(base).as_posix()
    if rel.endswith((".test.js", ".test.mjs")):
        cmd = ["node", "--test", "--no-warnings", rel]
    else:
        cmd = [sys.executable, "-m", "unittest", "discover", "-s", str(Path(rel).parent) or ".", "-p", path.name]
    try:
        r = subprocess.run(cmd, cwd=base, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as e:
        return False, f"cannot run: {e}"
    except subprocess.TimeoutExpired:
        return False, f"timed out after {timeout}s"
    tail = (r.stdout + r.stderr).strip().splitlines()[-3:]
    return r.returncode == 0, " | ".join(tail)


def findings(spec_dir: Path, code_dir, check_tests: bool = False, run: bool = False, runner=run_test) -> list[dict]:
    out = []
    ran: dict[str, tuple[bool, str]] = {}
    for spec in sorted(spec_dir.glob("US-SPEC-*.md")):
        inside = False
        for n, line in enumerate(spec.read_text(encoding="utf-8").splitlines(), 1):
            if HEADING.match(line):
                inside = True
                continue
            if inside and ANY_HEADING.match(line):
                break
            if not inside:
                continue
            labels = [(m.start(), m.group(1)) for m in re.finditer(r"\b(BUILT|RUNNING|PLANNED)\b", line)]
            if not labels or min(labels)[1] != "BUILT":  # the first label in the line is its status
                continue
            paths = candidate_paths(line)
            missing = [p for p in paths if not exists(code_dir, p)]
            if not paths:
                out.append({"spec": spec.name, "line": n, "problem": "labelled BUILT but names no file", "text": line.strip()[:200]})
            elif len(missing) == len(paths):
                out.append({"spec": spec.name, "line": n, "problem": "labelled BUILT but none of the named paths exist", "missing": missing, "text": line.strip()[:200]})
            elif missing:
                out.append({"spec": spec.name, "line": n, "problem": "some named paths do not exist", "missing": missing, "text": line.strip()[:200]})
            if (check_tests or run) and len(missing) < len(paths):
                tests = named_tests(line)
                if not tests:
                    out.append({"spec": spec.name, "line": n, "problem": "labelled BUILT but names no test", "text": line.strip()[:200]})
                elif run:
                    for t in dict.fromkeys(tests):
                        found = resolve(code_dir, t)
                        if not found:
                            continue  # a missing test file is already reported above as a missing path
                        key = str(found[1])
                        if key not in ran:
                            ran[key] = runner(found[0], found[1])
                        ok, detail = ran[key]
                        if not ok:
                            out.append({"spec": spec.name, "line": n, "problem": "named test does not pass", "test": t, "detail": detail, "text": line.strip()[:200]})
    return out


def counts(items: list[dict]) -> dict:
    """The numbers a ratchet can only lower: false lines, lines with code but no test, failing named tests."""
    return {
        "false_built": sum(1 for x in items if x["problem"] != "labelled BUILT but names no test" and x["problem"] != "named test does not pass"),
        "no_test_named": sum(1 for x in items if x["problem"] == "labelled BUILT but names no test"),
        "failing_tests": sum(1 for x in items if x["problem"] == "named test does not pass"),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--spec-dir", type=Path, default=os.environ.get("ULTRASTABLE_SPEC_DIR") or None, help="the specification directory; defaults to ULTRASTABLE_SPEC_DIR (the specification is private, DISCLOSE-1)")
    ap.add_argument("--code-dir", type=Path, action="append", required=True, help="code repository (repeatable: also the specs repository for documents it names)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--tests", action="store_true", help="a BUILT line must also name a test (US-20-R06)")
    ap.add_argument("--run", action="store_true", help="run every named test file once; a test that does not pass is a finding (implies --tests)")
    a = ap.parse_args(argv)
    if not a.spec_dir or not any(Path(a.spec_dir).glob("US-SPEC-*.md")):
        print(f"spec_truth: unmeasured, no specification text in {a.spec_dir} (DISCLOSE-1: set ULTRASTABLE_SPEC_DIR to the private specification)")
        return 2 if a.strict else 0
    f = findings(a.spec_dir, a.code_dir, check_tests=a.tests or a.run, run=a.run)
    if a.json:
        print(json.dumps(f, indent=2))
    else:
        c = counts(f)
        print(f"{len(f)} BUILT status line(s) do not match the code")
        if a.tests or a.run:
            print(f"  false BUILT {c['false_built']}, names code but no test {c['no_test_named']}, named test failing {c['failing_tests']}")
        for x in f:
            extra = f" {x['missing']}" if x.get("missing") else (f" {x['test']}: {x['detail']}" if x.get("test") else "")
            print(f"  {x['spec']}:{x['line']}: {x['problem']}{extra}")
    return 1 if (a.strict and f) else 0


if __name__ == "__main__":
    raise SystemExit(main())
