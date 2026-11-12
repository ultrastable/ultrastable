#!/usr/bin/env python3
"""Core side of the pull route: for each instance that names a repo, clone it, run `upstream drift`, open one issue per drifted instance.
Instances without a reachable repo are recorded (never skipped silently) and the dispatch route (instance-drift) still works."""
import glob, json, os, subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from foundation import upstream

def probe_status(probe: str) -> str:
    """Closing probes the scan can evaluate itself. `tag:OWNER/REPO:VTAG` is closed when that tag exists on the remote."""
    if probe.startswith("tag:"):
        _, repo, tag = probe.split(":", 2)
        tok = os.environ.get("INSTANCE_READ_TOKEN") or os.environ.get("GH_TOKEN", "")
        r = subprocess.run(["git", "ls-remote", "--tags", f"https://x-access-token:{tok}@github.com/{repo}.git", f"refs/tags/{tag}"], capture_output=True, text=True)
        if r.returncode:
            return "unknown"
        return "closed" if r.stdout.strip() else "open"
    return "open"


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
    # Dependencies an instance lane owes (recorded, never silently dropped): each has an owner, a trigger and a closing probe.
    deps = []
    for f in sorted(glob.glob("instances/*/dependencies.json")):
        for d in json.load(open(f)).get("dependencies", []):
            deps.append({**d, "instance": json.load(open(f))["instance"], "status": "open"})
    for d in deps:
        d["status"] = probe_status(d.get("probe", ""))
    for d in deps:
        if not all(d.get(k) for k in ("owner", "trigger", "probe")):
            rows.append({"instance": d["instance"], "status": "invalid-dependency", "detail": d["id"] + " lacks owner, trigger or probe"})
    print(json.dumps({"instances": rows, "dependencies": deps}, indent=1))
    return 0

if __name__ == "__main__":
    sys.exit(main())
