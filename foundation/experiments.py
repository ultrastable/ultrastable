"""GROWTH-1 experiments: targets, knobs and experiments of the product manager, filed as growth queue items. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation experiments --cycle [--apply]   file each proposed experiment as docs/issues/Q-GROW-<id>.json (label growth)
  python3 -m foundation experiments --check             references and prediction form are valid; proposed experiments are all filed

The mix of growth versus fixes is measured by foundation/growth.py from the same doctrine/growth.json.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/growth.json"
PRED = re.compile(r"^[a-z0-9_]+ (>=|<=|==|>|<) [0-9.]+ within [0-9]+ h$")


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def have(root) -> set:
    return {p.stem for p in (Path(root) / "docs/issues").glob("*.json")}


def item(e: dict, t: dict, k: dict) -> dict:
    return {"id": "Q-GROW-" + e["id"], "title": f"Q-GROW-{e['id']}: {e['hypothesis']}",
            "body": f"**Owner:** product-manager\n**Trigger:** every product-manager cycle\n**Done check:** grep:doctrine/growth.json::\"id\": \"{e['id']}\"\n**Prediction:** {e['prediction']}\n**Status:** open\n\nGrowth experiment on target `{t['id']}` ({t['metric']} target {t['target']}), knob `{k['id']}` in `{k['where']}`: {k['what']}. {t['why']}. Ship the change, log the prediction, keep it if the metric moved and revert it if not.",
            "labels": ["role:product-manager", "growth"], "milestone": "Next", "workstream": "Growth"}


def cycle(root=REPO, apply=False) -> list[str]:
    d, filed = load(root), []; have_ids = have(root)
    T, K = {t["id"]: t for t in d["targets"]}, {k["id"]: k for k in d["knobs"]}
    for e in d["experiments"]:
        if e["target"] not in T or e["knob"] not in K:
            continue  # check() reports the bad reference
        it = item(e, T[e["target"]], K[e["knob"]])
        if e["status"] == "proposed" and it["id"] not in have_ids:
            filed.append(it["id"])
            if apply:
                (Path(root) / "docs/issues" / (it["id"] + ".json")).write_text(json.dumps(it, indent=2) + "\n", encoding="utf-8")
    return filed


def check(root=REPO) -> list[str]:
    d, bad = load(root), []
    T, K = {t["id"] for t in d["targets"]}, {k["id"] for k in d["knobs"]}
    for e in d["experiments"]:
        if e["target"] not in T: bad.append(f"{e['id']}: unknown target {e['target']}")
        if e["knob"] not in K: bad.append(f"{e['id']}: unknown knob {e['knob']}")
        if not PRED.match(e["prediction"]): bad.append(f"{e['id']}: prediction not in the form '<metric> <op> <number> within <N> h'")
    if cycle(root): bad.append("proposed experiments not yet filed: run experiments --cycle --apply")
    return bad


def main(argv: list[str]) -> int:
    if "--cycle" in argv:
        print(json.dumps(cycle(apply="--apply" in argv))); return 0
    bad = check(); print("\n".join(bad) or "experiments ok"); return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
