# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""DEPLOY-DRIFT-1 (ZHC-R6, #2671): is every live Worker running what main holds?

  python3 -m foundation deploydrift [--json]   print each Worker's last recorded deploy and the commits to its code since; exit 1 on drift

The reading uses only the repository: the last row of ops/deploys.jsonl per Worker (the commit it was verified at) against the commits on main that touched
that Worker's code since. A Worker with no row is unmeasured and counts as drift, never as clean. A Worker whose source lives in its own repository
(topology `source`) is reported as external. Ultrastable is the foundation for any autonomous system.
"""
from __future__ import annotations
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _git(*a: str) -> str:
    return subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()


def last_deploys(path: str = "ops/deploys.jsonl") -> dict:
    out: dict = {}
    for line in open(os.path.join(ROOT, path), encoding="utf8"):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("worker") and d.get("sha") and d.get("live_matches_commit") is True and d.get("kind") != "seed":
            out[d["worker"]] = d["sha"]
    return out


def read(topo: dict, deploys: dict, behind=None) -> list:
    behind = behind or (lambda sha, paths: int(_git("rev-list", "--count", f"{sha}..HEAD", "--", *paths) or 0))
    rows = []
    for w in topo.get("workers", []):
        if w.get("state") != "live" or w.get("retire_candidate"):
            continue
        if w.get("source"):
            rows.append({"worker": w["id"], "status": "external", "behind": 0})
            continue
        main = w.get("main") or ""
        paths = [os.path.dirname(os.path.dirname(main)) or main, "doctrine/topology.json"]
        sha = deploys.get(w["id"])
        if not sha:
            rows.append({"worker": w["id"], "status": "unmeasured", "behind": None})
            continue
        try:
            n = behind(sha, paths)
        except Exception as e:  # a sha the clone does not hold is unmeasured, never clean
            rows.append({"worker": w["id"], "status": "unmeasured", "behind": None, "why": str(e)[:80]})
            continue
        rows.append({"worker": w["id"], "status": "drift" if n else "current", "behind": n, "deployed": sha[:7]})
    return rows


def main(argv: list) -> int:
    topo = json.load(open(os.path.join(ROOT, "doctrine/topology.json"), encoding="utf8"))
    rows = read(topo, last_deploys())
    if "--json" in argv:
        print(json.dumps(rows, indent=1))
    else:
        for r in rows:
            print(f"{r['status']:10} {r['worker']} behind={r['behind']}")
    return 1 if any(r["status"] in ("drift", "unmeasured") for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
