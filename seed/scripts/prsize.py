#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SMALL-CHANGE-1: refuse a change too large to verify or revert on its own.

Usage: python3 scripts/prsize.py --range BASE...HEAD [--config autonomy/prsize.json]
Counts changed files and added+deleted lines from `git diff --numstat`, skipping
the ignore globs, and fails on any path under a banned glob (session scratch).
"""
import argparse, fnmatch, json, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent


def match(path, globs):
    return any(fnmatch.fnmatch(path, g) or fnmatch.fnmatch(path, g.replace("**/", "")) for g in globs)


def measure(numstat, cfg):
    files, lines, banned = 0, 0, []
    for row in numstat.splitlines():
        parts = row.split("\t")
        if len(parts) < 3:
            continue
        add, dele, path = parts[0], parts[1], parts[2]
        if match(path, cfg.get("banned", [])):
            banned.append(path)
        if match(path, cfg.get("ignore", [])):
            continue
        files += 1
        lines += (int(add) if add.isdigit() else 0) + (int(dele) if dele.isdigit() else 0)
    errors = []
    if banned:
        errors.append(f"{len(banned)} scratch path(s) in the change, first: {banned[0]}")
    if files > cfg["max_files"]:
        errors.append(f"{files} files changed, limit {cfg['max_files']}")
    if lines > cfg["max_lines"]:
        errors.append(f"{lines} lines changed, limit {cfg['max_lines']}")
    return {"files": files, "lines": lines, "banned": len(banned), "errors": errors}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--range", required=True)
    ap.add_argument("--config", default=str(HERE / "autonomy" / "prsize.json"))
    a = ap.parse_args(argv)
    cfg = json.loads(Path(a.config).read_text())
    out = subprocess.run(["git", "diff", "--numstat", a.range], capture_output=True, text=True)
    if out.returncode != 0:
        print(f"prsize: git diff failed: {out.stderr.strip()}", file=sys.stderr)
        return 2
    r = measure(out.stdout, cfg)
    print(json.dumps({k: r[k] for k in ("files", "lines", "banned")}))
    for e in r["errors"]:
        print(f"SMALL-CHANGE-1: {e}. {cfg.get('split_hint', '')}", file=sys.stderr)
    return 1 if r["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
