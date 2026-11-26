# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""LIVE-CLAIMS-1 / NO-PITCH-1 (Rowan, 2026-11-26): public copy describes only what is live.

  python3 -m foundation liveclaims --check   fails on a line that promises a feature not yet live, or names a system host with no probe
  python3 -m foundation liveclaims --live    also fetches every host probe and fails one that does not answer

Rules and hosts: doctrine/live-claims.json. Numbers and cadences stay with claimcode (WORDS-MATCH-CODE-1); this covers the rest.
"""
from __future__ import annotations
import json, re, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/live-claims.json"


def _pol(root): return json.loads((Path(root) / PATH).read_text("utf-8"))


def scan(root=REPO) -> list[str]:
    root = Path(root); pol = _pol(root); errs = []
    fut = [re.compile(p, re.I) for p in pol["future_patterns"]]
    host = re.compile(pol["host_pattern"], re.I)
    for g in pol["scan_globs"]:
        for f in sorted(root.glob(g)):
            rel = f.relative_to(root).as_posix()
            if not f.is_file() or any(re.search(x, rel) for x in pol["skip"]):
                continue
            for n, line in enumerate(f.read_text("utf-8", errors="replace").splitlines(), 1):
                for p in fut:
                    m = p.search(line)
                    if m:
                        errs.append(f"{rel}:{n}: promises a feature not live yet ({m.group(0)!r}); describe what runs today")
                for m in host.finditer(line):
                    h = m.group(0).split("//", 1)[1].lower()
                    if h not in pol["hosts"]:
                        errs.append(f"{rel}:{n}: names {h} with no live probe in {PATH}")
    return errs


def probe(url, timeout=15) -> bool:
    req = urllib.request.Request(url, headers={"User-Agent": "ultrastable-liveclaims/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return 200 <= r.status < 400
    except Exception as e:  # reported as a failed probe by the caller
        print(f"probe failed {url}: {type(e).__name__}: {e}")
        return False


def live(root=REPO) -> list[str]:
    return [f"{h}: probe {u} did not answer" for h, u in _pol(root)["hosts"].items() if not probe(u)]


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    errs = scan() + (live() if "--live" in argv else [])
    if errs:
        print("liveclaims: " + str(len(errs)) + " problem(s)\n  " + "\n  ".join(errs)); return 1
    print("liveclaims: ok"); return 0


if __name__ == "__main__":
    sys.exit(main())
