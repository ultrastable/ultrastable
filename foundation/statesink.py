# SPDX-License-Identifier: LicenseRef-Ultrastable
# STATE-SINK-1 (ZHC-R1): the staged move of machine state out of git, as data plus two readings.
#   python3 -m foundation statesink --inventory   per state area: files, and the workflows and modules that name it (the writers and readers a move must handle)
#   python3 -m foundation statesink --probe       exit 1 while the state share is above budget; says which stage each area is in and which area moves next (canary first)
#   python3 -m foundation statesink --check       the stage file covers every state area and names one canary
import json, subprocess, sys
from pathlib import Path
from . import reposhape

ROOT = Path(__file__).resolve().parent.parent
STAGES = ("git", "dual", "moved")


def load(root=ROOT):
    return json.loads((root / "doctrine" / "state-sink.json").read_text())


def state_areas(root=ROOT):
    return [a["path"] for a in reposhape.policy(root)["areas"] if a["class"] == "state"]


def check(root=ROOT):
    sink, bad = load(root), []
    for a in state_areas(root):
        if a not in sink["areas"]: bad.append(f"state area {a} has no stage in doctrine/state-sink.json")
    for a, v in sink["areas"].items():
        if v.get("stage") not in STAGES: bad.append(f"{a}: stage {v.get('stage')!r} is not one of {STAGES}")
    if sum(1 for v in sink["areas"].values() if v.get("canary")) != 1: bad.append("exactly one area must be the canary")
    return bad


def next_move(sink):
    """The area to advance next: the canary until it is moved, then the others in file order."""
    order = sorted(sink["areas"].items(), key=lambda kv: (not kv[1].get("canary"), kv[0]))
    for a, v in order:
        if v["stage"] != "moved": return a, STAGES[STAGES.index(v["stage"]) + 1]
    return None, None


def inventory(root=ROOT):
    out = {}
    for a in state_areas(root):
        r = subprocess.run(["git", "grep", "-l", "-F", a, "--", ".github/workflows", "foundation", "seed/worker/src", "scripts", "deploy"], cwd=root, capture_output=True, text=True)
        files = sorted(set(r.stdout.split()))
        out[a] = {"workflows": [f for f in files if f.startswith(".github/")], "modules": [f for f in files if not f.startswith(".github/")]}
    return out


def main(argv=None):
    a = list(argv or [])
    if "--inventory" in a:
        for area, v in inventory().items(): print(f"{area}: {len(v['workflows'])} workflow(s), {len(v['modules'])} module(s) name it")
        return 0
    if "--check" in a:
        bad = check(); print("\n".join(bad) if bad else "statesink ok"); return 1 if bad else 0
    r, sink = reposhape.report(), load()
    area, stage = next_move(sink)
    print(json.dumps({"state_share": r["state_share"], "budget": r["state_budget"], "next": {"area": area, "to": stage}, "stages": {k: v["stage"] for k, v in sink["areas"].items()}}))
    return 1 if r["state_share"] > r["state_budget"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
