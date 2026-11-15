"""POINT-AND-CLICK-1: no product surface tells a person to create, paste or save a token, secret or setting, or to run a command.

  python3 -m foundation pointclick --check      fails on any offending line not in the shrink-only baseline (doctrine/point-and-click.json)
  python3 -m foundation pointclick --baseline   rewrites the baseline to the current offenders (it may only shrink in review of the diff)
Credentials come from the consent screen (/connect/github): seed/worker/src/auth/.
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/point-and-click.json"


def scan(root=REPO) -> list[str]:
    root = Path(root)
    pol = json.loads((root / PATH).read_text("utf-8"))
    pats = [re.compile(p, re.I) for p in pol["patterns"]]
    hits = []
    # Gitignored files are build or test outputs (e.g. seed/worker/src/config.js written by a worker test), not product surfaces.
    ign = subprocess.run(["git", "-C", str(root), "ls-files", "-oi", "--exclude-standard"], capture_output=True, text=True)
    ignored = set(ign.stdout.split("\n")) if ign.returncode == 0 else set()
    for g in pol["scan_globs"]:
        for f in sorted(root.glob(g)):
            if not f.is_file() or str(f.relative_to(root)) in ignored:
                continue
            for n, line in enumerate(f.read_text("utf-8", errors="replace").splitlines(), 1):
                if any(p.search(line) for p in pats):
                    hits.append(f"{f.relative_to(root)}:{n}")
    return hits


def check(root=REPO) -> list[str]:
    pol = json.loads((Path(root) / PATH).read_text("utf-8"))
    base = set(pol["baseline"])
    return [f"{h}: tells a person to handle a token, secret or setting (POINT-AND-CLICK-1)" for h in scan(root) if h not in base]


def main(argv):
    if argv[:1] == ["--baseline"]:
        p = REPO / PATH; pol = json.loads(p.read_text("utf-8")); pol["baseline"] = scan(REPO)
        p.write_text(json.dumps(pol, indent=2) + "\n", "utf-8"); print(f"pointclick: baseline {len(pol['baseline'])}"); return 0
    errs = check()
    for e in errs:
        print("FAIL", e)
    print("pointclick ok" if not errs else f"pointclick: {len(errs)} problems")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
