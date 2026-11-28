# SPDX-License-Identifier: LicenseRef-Ultrastable
# STATE-SINK-1 (ZHC-R1): the staged move of machine state out of git, as data plus two readings.
#   python3 -m foundation statesink --inventory   per state area: files, and the workflows and modules that name it (the writers and readers a move must handle)
#   python3 -m foundation statesink --probe       exit 1 while the state share is above budget; says which stage each area is in and which area moves next (canary first)
#   python3 -m foundation statesink --check       the stage file covers every state area and names one canary
#   python3 -m foundation statesink --archive [--apply]   STATE-ARCHIVE-1: closed queue items leave docs/issues for one append-only file,
#       docs/issues/archive/issues.jsonl (git history keeps every byte). An id that comes back after archiving is a writer that dedupes by file:
#       it goes on the keep list in that file's sidecar and is never archived again, so the step cannot cause a refile loop.
#       An item whose id any other tracked file names (a site pin, a test, doctrine; ledgers under ops/ only log ids) stays, so no reader loses its file.
import json, re, subprocess, sys
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


ARCHIVE_DIR, ISSUES = "docs/issues/archive", "docs/issues"
_STATUS = re.compile(r"\*\*Status:\*\*\s*(\w+)")


def _closed(item):
    if not isinstance(item, dict): return False
    body = item.get("body") or ""
    if "**Disposition:** shelved" in body or "**Disposition:** gate" in body: return False  # DISPOSE-1: its closing probe still runs
    if "**Residual:**" in body: return False  # queue --check matches thread residuals to these items by key
    m = _STATUS.search(body)
    return (m.group(1) if m else str(item.get("state", ""))).lower() in ("closed", "done")


def referenced_ids(root=ROOT):
    """Every id-shaped token in tracked files outside the queue: an item a page, pin, test or doctrine names stays in docs/issues."""
    r = subprocess.run(["git", "grep", "-I", "-h", "-o", "-E", r"[A-Z][A-Za-z0-9]*(-[A-Za-z0-9_]+)+", "--", ".", ":!docs/issues", ":!ops", ":!outreach/packets"],
                       cwd=root, capture_output=True, text=True)
    return set(r.stdout.split())


def archive(root=ROOT, apply=False, refs=None):
    """Move closed docs/issues items into docs/issues/archive/issues.jsonl. Returns {archived, kept, reentered}."""
    root = Path(root); d = root / ARCHIVE_DIR; log, keepf = d / "issues.jsonl", d / "keep.json"
    seen = set()
    if log.exists():
        for ln in log.read_text().splitlines():
            if ln.strip(): seen.add(json.loads(ln)["id"])
    keep = set(json.loads(keepf.read_text())["keep"]) if keepf.exists() else set()
    refs = referenced_ids(root) if refs is None else refs
    out, rows = {"archived": [], "kept": [], "reentered": [], "referenced": []}, []
    for p in sorted((root / ISSUES).glob("*.json")):
        iid = p.stem
        if iid in seen and iid not in keep: out["reentered"].append(iid); keep.add(iid)
        if iid in keep: out["kept"].append(iid); continue
        if iid in refs: out["referenced"].append(iid); continue
        try: item = json.loads(p.read_text())
        except ValueError: continue
        if not _closed(item): continue
        out["archived"].append(iid); rows.append(json.dumps({"id": iid, "item": item}, sort_keys=True))
        if apply: p.unlink()
    if apply and (rows or out["reentered"]):
        d.mkdir(parents=True, exist_ok=True)
        with log.open("a") as f:
            for r in rows: f.write(r + "\n")
        keepf.write_text(json.dumps({"_doc": "ids that came back after archiving; statesink --archive leaves them in docs/issues", "keep": sorted(keep)}, indent=1) + "\n")
    return out


def main(argv=None):
    a = list(argv or [])
    if "--inventory" in a:
        for area, v in inventory().items(): print(f"{area}: {len(v['workflows'])} workflow(s), {len(v['modules'])} module(s) name it")
        return 0
    if "--archive" in a:
        r = archive(apply="--apply" in a)
        print(json.dumps({k: len(v) for k, v in r.items()} | {"reentered_ids": r["reentered"]})); return 0
    if "--check" in a:
        bad = check(); print("\n".join(bad) if bad else "statesink ok"); return 1 if bad else 0
    r, sink = reposhape.report(), load()
    area, stage = next_move(sink)
    print(json.dumps({"state_share": r["state_share"], "budget": r["state_budget"], "next": {"area": area, "to": stage}, "stages": {k: v["stage"] for k, v in sink["areas"].items()}}))
    return 1 if r["state_share"] > r["state_budget"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
