# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""TRAJECTORY-1 on the platform: how the system evolves over time, read from its own history. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation trajectory --run [--apply]   measure per-day attention and change per area, loop and issue stream; write ops/trajectory.json,
                                                     append ops/trajectory.jsonl, regenerate site/trajectory-data.js, file Q-TRAJ-* for what the shape shows
  python3 -m foundation trajectory --probe KIND:ID   closing probe of a Q-TRAJ item: that hotspot, neglect or drift is no longer in the series (exit 0)
  python3 -m foundation trajectory --check           the module, its data file and the simulator link are well formed

The measuring is the shared core in seed/scripts/trajectory.py (every system carries it). Here: the findings become queue items with a closing probe,
items whose finding has cleared are closed with that reading, the observed event series feed foundation/yearsim.py (a fault's `rate_from`), and the series
are published at /year. Tests: tests/foundation/test_trajectory.py."""
from __future__ import annotations
import datetime as dt, importlib.util as _ilu, json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DATA, PREFIX, MAX_FILED = "site/trajectory-data.js", "Q-TRAJ", 3
_spec = _ilu.spec_from_file_location("trajectory_core", REPO / "seed/scripts/trajectory.py")
core = _ilu.module_from_spec(_spec)
sys.modules["trajectory_core"] = core
_spec.loader.exec_module(core)


def _id(f) -> str:
    return f"{PREFIX}-{f['kind']}-" + re.sub(r"[^A-Za-z0-9_-]+", "-", f["id"]).strip("-")[:60]


def _item(root, f):
    iid, p = _id(f), Path(root) / "docs/issues" / (_id(f) + ".json")
    if p.exists():
        return None
    fix = {"hotspot": "Find why this keeps changing; make the part that churns computed, split it, or add the test that pins it, so it stops being rewritten.",
           "neglected": "Find why it went quiet while the system moved: a loop that no longer fires, an area nothing consumes. Fix the loop or retire the area with a recorded disposition.",
           "drift": "Find what moved attention (or the backlog) and whether that was intended; if not, restore the balance in code."}[f["kind"]]
    body = (f"**Owner:** executor\n**Trigger:** trajectory pass (TRAJECTORY-1) on the watchdog run\n**Done check:** cmd:python3 -m foundation trajectory --probe {f['kind']}:{f['id']}\n**Status:** open\n\n"
            f"{f['why']}. Evidence: {f['evidence']}.\n\n{fix}\n\nsize: S\n\n**Closing probe:** `python3 -m foundation trajectory --probe {f['kind']}:{f['id']}` exits 0.\n")
    p.write_text(json.dumps({"id": iid, "title": f"{iid}: {f['why'][:100]}", "body": body, "labels": ["p2", "agent-ready", "trajectory"], "milestone": "Now", "workstream": "Ultrastability"}, indent=2) + "\n", encoding="utf-8")
    return iid


def _close_cleared(root, now_ids, at):
    closed = []
    for p in sorted((Path(root) / "docs/issues").glob(PREFIX + "-*.json")):
        j = json.loads(p.read_text(encoding="utf-8"))
        if "**Status:** open" in j.get("body", "") and j["id"] not in now_ids:
            j["body"] = j["body"].replace("**Status:** open", "**Status:** closed", 1) + f"\n**Evidence:** trajectory at {at}: the shape no longer shows it.\n"
            p.write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")
            closed.append(j["id"])
    return closed


def run(root=REPO, apply=False, today=None):
    root = Path(root)
    rec = core.run(root, apply=apply, today=today)
    if apply:
        ids = {_id(f) for f in rec["findings"]}
        rec["filed"] = [i for i in (_item(root, f) for f in rec["findings"][:MAX_FILED * 3] if f["kind"] != "drift" or f["id"] == "issues") if i][:MAX_FILED]
        rec["closed"] = _close_cleared(root, ids, rec["at"])
        (root / DATA).write_text(render(root), encoding="utf-8")
    return rec


def probe(root, ref) -> int:
    kind, _, fid = ref.partition(":")
    rec = core.run(root)
    hit = [f for f in rec["findings"] if f["kind"] == kind and f["id"] == fid]
    print(json.dumps(hit[0]) if hit else f"{ref}: not in the series")
    return 1 if hit else 0


def page_data(root=REPO) -> dict:
    p = Path(root) / core.LATEST
    if not p.is_file():
        return {"measured": False}
    j = json.loads(p.read_text(encoding="utf-8"))
    return {"measured": True, "at": j["at"], "days": j["days"], "history_days": j.get("history_days"),
            "areas": [{k: a[k] for k in ("area", "total", "recent7", "share_recent", "share_trend", "quiet_days", "series")} for a in j["areas"][:8]],
            "loops": sorted([{k: x[k] for k in ("loop", "rows", "quiet_days", "series")} for x in j["loops"]], key=lambda x: -x["rows"])[:8],
            "issues": j["issues"], "findings": j["findings"][:12],
            "observed": {k: {x: v.get(x) for x in ("rate_year", "recent_year", "trend", "events", "days")} for k, v in j["observed"].items()}}


def render(root=REPO) -> str:
    return ("// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n// GENERATED by python3 -m foundation trajectory --run --apply from ops/trajectory.json. Do not edit; --check fails when stale.\n"
            "export default " + json.dumps(page_data(root), indent=1, sort_keys=True) + ";\n")


def check(root=REPO) -> list[str]:
    root, errs = Path(root), []
    if (root / DATA).is_file() and (root / DATA).read_text(encoding="utf-8") != render(root):
        errs.append(f"{DATA} is stale: run trajectory --run --apply")
    y = json.loads((root / "doctrine/yearsim.json").read_text(encoding="utf-8"))
    known = {"reverts", "conflict_merges", "ci_unavailable", "deploy_not_live"}
    for f in y["faults"]:
        if f.get("rate_from") and f["rate_from"] not in known:
            errs.append(f"{f['id']}: rate_from {f['rate_from']} is not an observed series")
    if "trajectory" not in (root / ".github/workflows/watchdog.yml").read_text(encoding="utf-8"):
        errs.append("the watchdog does not run trajectory")
    return errs


def main(argv=None) -> int:
    a = sys.argv[1:] if argv is None else argv
    if "--check" in a:
        e = check()
        print("trajectory ok" if not e else "\n".join(e))
        return 1 if e else 0
    if "--probe" in a:
        return probe(REPO, a[a.index("--probe") + 1])
    r = run(REPO, apply="--apply" in a)
    print(json.dumps({"findings": [f"{x['kind']}:{x['id']}" for x in r["findings"]], "filed": r.get("filed"), "closed": r.get("closed")}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
