"""GROWTH-1: the product manager's growth loop. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation growth --check            declaration valid, and the filed work is not fixes only (share floor)
  python3 -m foundation growth --cycle [--apply]  file each proposed experiment and each open market gap as growth items; --apply writes them
  python3 -m foundation growth --share            growth versus repair counts and share, as JSON

Growth work (experiments against targets, closing competitor gaps) is what a product manager exists for; repair work (failing checks, missed clock ticks)
keeps the system true. Both are filed through the same queue. The share of growth in filed work has a floor, and a period with repairs and no growth fails.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/growth.json"
PRED = re.compile(r"^[a-z0-9_]+ (>=|<=|==|>|<) [0-9.]+ within [0-9]+ h$")


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def issues(root=REPO) -> list[dict]:
    out = []
    for p in sorted((Path(root) / "docs/issues").glob("*.json")):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if isinstance(d, dict):
            out.append(d)
    return out


def share(root=REPO) -> dict:
    f = load(root)["floor"]; g = r = 0
    for it in issues(root):
        ls = set(it.get("labels", []))
        if ls & set(f["growth_labels"]): g += 1
        elif ls & set(f["repair_labels"]): r += 1
    return {"growth": g, "repair": r, "share": round(g / (g + r), 3) if g + r else None, "floor": f["growth_share_min"]}


def item(e: dict, t: dict, k: dict) -> dict:
    return {"id": "Q-GROW-" + e["id"], "title": f"Q-GROW-{e['id']}: {e['hypothesis']}",
            "body": f"**Owner:** product-manager\n**Trigger:** every product-manager cycle\n**Done check:** grep:doctrine/growth.json::\"id\": \"{e['id']}\"\n**Prediction:** {e['prediction']}\n**Status:** open\n\nGrowth experiment on target `{t['id']}` ({t['metric']} target {t['target']}), knob `{k['id']}` in `{k['where']}`: {k['what']}. {t['why']}. Ship the change, log the prediction, keep it if the metric moved and revert it if not.",
            "labels": ["role:product-manager", "growth"], "milestone": "Next", "workstream": "Growth"}


def cycle(root=REPO, apply=False) -> list[str]:
    d, have, filed = load(root), {i.get("id") for i in issues(root)}, []
    T, K = {t["id"]: t for t in d["targets"]}, {k["id"]: k for k in d["knobs"]}
    for e in d["experiments"]:
        it = item(e, T[e["target"]], K[e["knob"]])
        if e["status"] == "proposed" and it["id"] not in have:
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
    s = share(root)
    if s["repair"] and not s["growth"]: bad.append("fixes only: repair work filed and no growth work")
    if s["share"] is not None and s["share"] < s["floor"]: bad.append(f"growth share {s['share']} is under the floor {s['floor']}")
    if cycle(root): bad.append("proposed experiments not yet filed: run growth --cycle --apply")
    return bad


def main(argv: list[str]) -> int:
    if "--share" in argv:
        print(json.dumps(share())); return 0
    if "--cycle" in argv:
        print(json.dumps(cycle(apply="--apply" in argv))); return 0
    bad = check(); print("\n".join(bad) or "growth ok"); return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
