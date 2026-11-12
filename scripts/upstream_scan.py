#!/usr/bin/env python3
"""Core side of the pull route: for each instance that names a repo, clone it, run `upstream drift`, open one issue per drifted instance.
Instances without a reachable repo are recorded (never skipped silently) and the dispatch route (instance-drift) still works."""
import glob, json, os, subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from foundation import upstream

def main() -> int:
    core, rows = upstream.REPO, []
    for f in sorted(glob.glob("instances/*/instance.json")):
        m = json.loads(open(f).read())
        repo = (m.get("repos") or {}).get("canonical", "")
        if not repo or m["slug"] == "ultrastable":
            continue
        d = tempfile.mkdtemp()
        tok = os.environ.get("INSTANCE_READ_TOKEN") or os.environ.get("GH_TOKEN", "")
        r = subprocess.run(["git", "clone", "--depth", "1", f"https://x-access-token:{tok}@github.com/{repo}.git", d], capture_output=True, text=True)
        if r.returncode:
            rows.append({"instance": m["slug"], "repo": repo, "status": "unreachable", "detail": "clone failed; bind INSTANCE_READ_TOKEN or rely on the instance-drift dispatch route"})
            continue
        dr = upstream.drift(core, Path(d)); dr.update(instance=m["slug"], repo=repo); rows.append(dr)
        if dr["status"] != "in-sync":
            subprocess.run(["gh", "issue", "create", "--title", f"Instance {m['slug']} diverged from core {dr.get('core')}", "--body", json.dumps(dr, indent=1)], check=False)
    print(json.dumps(rows, indent=1))
    return 0

if __name__ == "__main__":
    sys.exit(main())
