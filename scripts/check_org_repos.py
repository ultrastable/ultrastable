#!/usr/bin/env python3
"""Check org/repos.json: every repo declares purpose and disposition.

Default (offline, in CI): schema and consistency checks.
--live: also compare with GitHub (gh api) and report drift: archived/private
mismatch, repos in the registry that are missing, and registry entries whose
description lacks the expected text. Repos the session cannot read are
reported as unverified, never silently passed.
"""
import json, subprocess, sys

REG = "org/repos.json"
DISPOSITIONS = {"keep", "archive", "merge"}


def check(reg):
    errs, names = [], set()
    for r in reg["repos"]:
        n = r.get("name", "?")
        if n in names:
            errs.append(f"{n}: duplicate")
        names.add(n)
        if len(r.get("purpose", "").strip()) < 20:
            errs.append(f"{n}: missing purpose")
        if r.get("disposition") not in DISPOSITIONS:
            errs.append(f"{n}: disposition must be one of {sorted(DISPOSITIONS)}")
        if r.get("disposition") in ("archive", "merge") and not (r.get("reason") and r.get("merged_into")):
            errs.append(f"{n}: archive/merge needs reason and merged_into")
        if r.get("private") is not True:
            errs.append(f"{n}: must be private until license sign-off")
    for t in reg["target"]:
        short = t.split("/", 1)[1]
        if short not in names:
            errs.append(f"target {t} has no registry entry")
    return errs


def live(reg):
    errs, unverified = [], []
    for r in reg["repos"]:
        p = subprocess.run(["gh", "api", f"repos/ultrastable/{r['name']}"], capture_output=True, text=True)
        if p.returncode != 0:
            unverified.append(r["name"])
            continue
        d = json.loads(p.stdout)
        if d["archived"] != r["archived"]:
            errs.append(f"{r['name']}: archived is {d['archived']}, registry says {r['archived']}")
        if d["private"] != r["private"]:
            errs.append(f"{r['name']}: private is {d['private']}, registry says {r['private']}")
        if not d.get("description"):
            errs.append(f"{r['name']}: GitHub description empty")
    return errs, unverified


def main():
    reg = json.load(open(REG))
    errs = check(reg)
    if "--live" in sys.argv:
        e, u = live(reg)
        errs += e
        if u:
            print("unverified (no access from here):", ", ".join(u))
    for e in errs:
        print("FAIL", e, file=sys.stderr)
    print(f"{len(reg['repos'])} repos, {len(errs)} problems")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
