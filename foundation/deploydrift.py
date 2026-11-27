# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""DEPLOY-DRIFT-1 (ZHC-R6, #2671): is every live Worker running what main holds?

  python3 -m foundation deploydrift [--json]   print each Worker's last recorded deploy and the commits to its code since; exit 1 on drift
  python3 -m foundation deploydrift --versions [--since ISO]   ZHC-R6 closing probe: every deploy row that uploaded (no error) carries the new version id
      and a live read that matched the commit; exit 1 naming the rows that do not. A failed upload has no version to probe and is not counted.

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


def redeploy(rows: list, run=subprocess.run) -> int:
    """Dispatch deploy-ultrastable for the Workers that drifted. A dispatch that fails is returned as exit 1 and printed, never ignored."""
    ids = [r["worker"] for r in rows if r["status"] == "drift"]
    if not ids:
        return 0
    p = run(["gh", "workflow", "run", "deploy-ultrastable.yml", "-f", "workers=" + ",".join(ids)], cwd=ROOT, capture_output=True, text=True)
    print(("dispatched deploy-ultrastable for " + ",".join(ids)) if p.returncode == 0 else "dispatch failed: " + (p.stderr or "")[:200])
    return 0 if p.returncode == 0 else 1


def unprobed(lines, since: str = "") -> list:
    """Deploy rows since `since` that uploaded but lack a version id or a live read matching the commit."""
    bad = []
    for line in lines:
        try: d = json.loads(line)
        except ValueError: continue
        if not isinstance(d, dict) or d.get("at", "") < since or d.get("error") or d.get("uploaded") is False: continue
        if not d.get("version") or d.get("live_matches_commit") is not True: bad.append(f"{d.get('at')} {d.get('worker')}")
    return bad


def main(argv: list) -> int:
    if "--versions" in argv:
        since = argv[argv.index("--since") + 1] if "--since" in argv else ""
        bad = unprobed(open(os.path.join(ROOT, "ops/deploys.jsonl"), encoding="utf8"), since)
        print("\n".join(bad) if bad else "every uploaded deploy row has a probed version id")
        return 1 if bad else 0
    topo = json.load(open(os.path.join(ROOT, "doctrine/topology.json"), encoding="utf8"))
    rows = read(topo, last_deploys())
    if "--redeploy" in argv:
        bad = redeploy(rows)
    if "--json" in argv:
        print(json.dumps(rows, indent=1))
    else:
        for r in rows:
            print(f"{r['status']:10} {r['worker']} behind={r['behind']}")
    if "--redeploy" in argv:
        return bad
    return 1 if any(r["status"] in ("drift", "unmeasured") for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
