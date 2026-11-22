# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""Every tenant app lives in its own repository (TENANT-REPO-1, Rowan 2026-11-22: "This is an app, a tenant, so it needs its own repo.").

Ultrastable is the foundation for any autonomous system. The core repository holds the platform; a tenant keeps only its manifest here
(IDEA.md, instance.json, lifecycle.json, runway.json, a README pointer) and its code in its own repository. doctrine/topology.json names the
tenant repository as the worker's `source`, and deploy-ultrastable builds and deploys it from there (seed/worker/src/handoff.js makeDeployer),
on a push here, on a dispatch, and daily when the tenant's main moved past the last deployed commit.

  python3 -m foundation tenantrepos --check                 the registry is complete: no tenant code left in the core outside a move in progress
  python3 -m foundation tenantrepos --prepare DIR --slug S  turn a split of the tenant folder into a standalone repository (vendored core files, imports)
  python3 -m foundation tenantrepos --missing               tenants whose repository is still to be created (read by tenant-repos.yml)
  python3 -m foundation tenantrepos --behind                workers whose tenant repository moved past the last deployed commit (daily redeploy)

Registry: doctrine/tenant-repos.json. States: own-repo (born separate), moving (code still in the core while its repository is created),
moved (code only in the tenant repository; the core's topology entry builds from it).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REG = "doctrine/tenant-repos.json"
STATES = {"own-repo", "moving", "moved"}
CODE_DIRS = ("worker", "src", "app")


def load(root: Path = ROOT) -> dict:
    return json.loads((root / REG).read_text())



def check(root: Path = ROOT) -> list[str]:
    reg, errs = load(root), []
    org = reg.get("org", "")
    tenants = reg.get("tenants", {})
    for slug, t in tenants.items():
        if t.get("state") not in STATES:
            errs.append(f"{slug}: state must be one of {sorted(STATES)}")
        if not str(t.get("repo", "")).startswith(org + "/"):
            errs.append(f"{slug}: repo must be in the {org} organization")
        if t.get("state") == "moved":
            src = root / t.get("source", f"instances/{slug}")
            left = [d for d in CODE_DIRS if (src / d).exists()]
            if left:
                errs.append(f"{slug}: moved to {t['repo']} but {src.relative_to(root)}/{left[0]} is still in the core")
    # tenant code in the core must be registered as moving: a new tenant gets its own repository
    moving = {t.get("source", f"instances/{s}") for s, t in tenants.items() if t.get("state") == "moving"}
    for inst in sorted((root / "instances").iterdir()) if (root / "instances").exists() else []:
        rel = inst.relative_to(root).as_posix()
        if inst.is_dir() and any((inst / d).is_dir() for d in CODE_DIRS) and rel not in moving:
            errs.append(f"{rel}: tenant code lives in the core; register it in {REG} and move it to its own repository (TENANT-REPO-1)")
    topo = json.loads((root / "doctrine/topology.json").read_text())
    by_worker = {t.get("worker"): (s, t) for s, t in tenants.items() if t.get("worker")}
    for w in topo.get("workers", []):
        main = str(w.get("main", ""))
        if main.startswith("instances/") and not any(main.startswith(m + "/") for m in moving):
            errs.append(f"topology {w['id']}: builds from {main} in the core; a tenant worker builds from its own repository (source.repo)")
        src = (w.get("source") or {}).get("repo")
        if src:
            st = by_worker.get(w["id"])
            if not st or st[1]["repo"] != src:
                errs.append(f"topology {w['id']}: source {src} is not the registered repository of a tenant")
    for slug, t in tenants.items():
        if t.get("state") == "moved" and t.get("worker"):
            w = next((x for x in topo.get("workers", []) if x["id"] == t["worker"]), None)
            if not w or (w.get("source") or {}).get("repo") != t["repo"]:
                errs.append(f"{slug}: moved, but topology {t['worker']} does not build from {t['repo']} (the core's second deploy route)")
    return errs


def _rel_import(file: Path, base: Path, target: str) -> str:
    rel = os.path.relpath(base / target, file.parent).replace(os.sep, "/")
    return rel if rel.startswith(".") else "./" + rel


def prepare(dirpath: Path, slug: str, root: Path = ROOT) -> list[str]:
    """A subtree split of the tenant folder becomes a standalone repository: core files it imports are vendored, imports are rewritten."""
    t = load(root)["tenants"][slug]
    done = []
    for src, dst in (t.get("vendor") or {}).items():
        (dirpath / dst).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / src, dirpath / dst)
        done.append(f"vendored {src} -> {dst}")
        pat = re.compile(r"""(["'])(?:\.\./)+""" + re.escape(src) + r"""\1""")
        for f in sorted(dirpath.rglob("*.js")) + sorted(dirpath.rglob("*.mjs")):
            if ".git" in f.parts or "node_modules" in f.parts:
                continue
            s = f.read_text()
            n = pat.sub(lambda m: m.group(1) + _rel_import(f, dirpath, dst) + m.group(1), s)
            if n != s:
                f.write_text(n)
                done.append(f"rewrote import in {f.relative_to(dirpath).as_posix()}")
    return done


def last_deployed(root: Path, worker: str) -> str:
    """The tenant commit the last live-verified deploy of this worker carried (ops/deploys.jsonl source_sha)."""
    p, last = root / "ops/deploys.jsonl", ""
    if p.exists():
        for line in p.read_text().splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get("worker") == worker and r.get("live_matches_commit") and r.get("source_sha"):
                last = r["source_sha"]
    return last


def behind(root: Path = ROOT, head=None) -> list[str]:
    """Workers of moved tenants whose repository's main is ahead of the last deployed commit. head(repo) returns main's sha."""
    out = []
    for slug, t in sorted(load(root).get("tenants", {}).items()):
        if t.get("state") != "moved" or not t.get("worker"):
            continue
        cur = head(t["repo"]) if head else ""
        if cur and cur != last_deployed(root, t["worker"]):
            out.append(t["worker"])
    return out


def _gh_head(repo: str) -> str:
    import subprocess
    r = subprocess.run(["gh", "api", f"repos/{repo}/commits/main", "--jq", ".sha"], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        print(f"tenantrepos: cannot read {repo} main: {r.stderr.strip()[:200]}", file=sys.stderr)
        return ""
    return r.stdout.strip()


def missing(reg: dict) -> list[dict]:
    return [{"slug": s, **t} for s, t in sorted(reg.get("tenants", {}).items()) if t.get("state") == "moving"]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="foundation tenantrepos")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--missing", action="store_true")
    ap.add_argument("--behind", action="store_true", help="print the comma-separated workers whose tenant main moved past the last deploy")
    ap.add_argument("--prepare")
    ap.add_argument("--slug")
    a = ap.parse_args(argv)
    if a.behind:
        print(",".join(behind(head=_gh_head)))
        return 0
    if a.missing:
        print(json.dumps(missing(load())))
        return 0
    if a.prepare:
        for line in prepare(Path(a.prepare), a.slug):
            print(line)
        return 0
    errs = check()
    for e in errs:
        print("tenantrepos:", e)
    print("tenantrepos ok" if not errs else f"tenantrepos: {len(errs)} problem(s)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
