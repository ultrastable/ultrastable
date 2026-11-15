"""PUBLICATION-1: every repo public under USL-1.0, published by a procedure the code runs. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation publication --check          policy well formed; lessons' probes hold; this repo has the required files and no secret in its tree
  python3 -m foundation publication --audit          tree and full-history secret scan, tripwire paths; a shallow history is `unmeasured`, never clean
  python3 -m foundation publication --plan           print the flip commands in order (no change)
  python3 -m foundation publication --flip [--apply] refused unless the audit is clean; --apply needs GH_TOKEN (ORG_ADMIN_TOKEN) and records each result in the ledger
"""
from __future__ import annotations
import argparse, datetime as dt, json, os, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/publication.json"
LEDGER = "ops/publication/ledger.jsonl"
REVIEWED = "ops/publication/reviewed.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def _probe(root, spec):
    kind, _, arg = spec.partition(":")
    path, _, rx = arg.partition("::")
    p = Path(root) / path
    hit = p.is_file() and re.search(rx, p.read_text(encoding="utf-8", errors="replace")) is not None
    return hit if kind == "grep" else (not hit if kind == "nogrep" else (Path(root) / arg).exists())


def _git(root, *a):
    return subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True)


def tree_hits(root, d) -> list[str]:
    rx = re.compile("|".join(d["secret_patterns"]))
    out = _git(root, "ls-files")
    hits = []
    for rel in out.stdout.split("\n") if out.returncode == 0 else []:
        if not rel or rel in d["secret_allow_paths"]:
            continue
        p = Path(root) / rel
        try:
            if p.is_file() and p.stat().st_size < 2_000_000 and rx.search(p.read_text(encoding="utf-8", errors="ignore")):
                hits.append(rel)
        except OSError as e:
            hits.append(f"{rel}: unreadable ({e})")
    return hits


def history(root, d) -> dict:
    """Secret scan over every commit on every ref. A shallow or unreadable history is `unmeasured`."""
    if _git(root, "rev-parse", "--git-dir").returncode != 0:
        return {"state": "unmeasured", "why": "not a git checkout"}
    if _git(root, "rev-parse", "--is-shallow-repository").stdout.strip() == "true":
        return {"state": "unmeasured", "why": "shallow clone: history is incomplete"}
    p = _git(root, "log", "--all", "-p", "--no-color")
    if p.returncode != 0:
        return {"state": "unmeasured", "why": "git log failed"}
    rx = re.compile("|".join(d["secret_patterns"]))
    n = sum(1 for l in p.stdout.split("\n") if l.startswith("+") and rx.search(l))
    return {"state": "dirty" if n else "clean", "hits": n}


def tripwires(root, d) -> list[str]:
    rev = Path(root) / REVIEWED
    done = set(json.loads(rev.read_text(encoding="utf-8")).get("reviewed", {})) if rev.is_file() else set()
    out = _git(root, "ls-files")
    paths = [x for x in out.stdout.split("\n") if x]
    return sorted({t for t in d["private_data_tripwires"] if t not in done and any(x == t or x.startswith(t) for x in paths)})


def check(root=REPO) -> list[str]:
    root, errs = Path(root), []
    d = load(root)
    for k in ("org", "visibility", "license_id", "repos", "flip_order", "required_files", "secret_patterns", "procedure", "credential", "lessons"):
        if k not in d:
            errs.append(f"missing {k}")
    if errs:
        return errs
    if d["visibility"] != "public":
        errs.append("visibility must be public")
    if sorted(d["repos"]) != sorted(d["flip_order"]):
        errs.append("flip_order must list every repo once")
    if not d["credential"].get("default_in_effect") or not d["credential"].get("routes"):
        errs.append("credential needs routes and a default in effect")
    for l in d["lessons"]:
        if not _probe(root, l["probe"]):
            errs.append(f"lesson {l['id']}: probe fails {l['probe']}")
    for f in d["required_files"]:
        if not (root / f).is_file():
            errs.append(f"required file missing: {f}")
    lic = root / "LICENSE"
    if lic.is_file() and d["license_id"] not in lic.read_text(encoding="utf-8", errors="replace"):
        errs.append(f"LICENSE lacks {d['license_id']}")
    errs += [f"secret pattern in {h}" for h in tree_hits(root, d)]
    return errs


def audit(root=REPO) -> dict:
    d = load(root)
    return {"tree": tree_hits(root, d), "history": history(root, d), "tripwires": tripwires(root, d)}


def clean(a) -> bool:
    return not a["tree"] and a["history"]["state"] == "clean" and not a["tripwires"]


def _log(root, rec):
    p = Path(root) / LEDGER
    p.parent.mkdir(parents=True, exist_ok=True)
    rec["at"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")


def flip(root=REPO, apply=False, run=subprocess.run) -> int:
    d, root = load(root), Path(root)
    a = audit(root)
    if not clean(a):
        _log(root, {"step": "flip", "result": "refused: audit", "audit": a})
        print("flip refused: audit not clean", json.dumps(a), file=sys.stderr)
        return 2
    tok = os.environ.get("GH_TOKEN") or os.environ.get("ORG_ADMIN_TOKEN")
    for r in d["flip_order"]:
        cmd = ["gh", "repo", "edit", f"{d['org']}/{r}", "--visibility", "public", "--accept-visibility-change-consequences"]
        if not apply:
            print(" ".join(cmd)); continue
        if not tok:
            _log(root, {"step": "flip", "repo": r, "result": "no credential: default in effect"})
            print("flip: no ORG_ADMIN_TOKEN; default in effect, nothing changed", file=sys.stderr)
            return 3
        p = run(cmd, capture_output=True, text=True, env={**os.environ, "GH_TOKEN": tok})
        _log(root, {"step": "flip", "repo": r, "result": "ok" if p.returncode == 0 else "failed", "rc": p.returncode})
        if p.returncode != 0:
            print(f"flip {r} failed rc={p.returncode}", file=sys.stderr)
            return 1
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="publication")
    for f in ("--check", "--audit", "--plan", "--flip", "--apply"):
        ap.add_argument(f, action="store_true")
    ap.add_argument("--root", default=str(REPO))
    a = ap.parse_args(argv)
    if a.audit:
        r = audit(a.root); print(json.dumps(r, indent=1)); return 0 if clean(r) else 1
    if a.plan:
        a.flip = True
    if a.flip:
        return flip(a.root, a.apply)
    errs = check(a.root)
    for e in errs:
        print("publication:", e, file=sys.stderr)
    if not errs:
        print("publication ok")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
