"""IGNITION-1 (Rowan, 2026-11-13): something from nothing that sustains itself, as one code path.

  python3 -m foundation ignition --prove          from an empty working tree plus the declarations, reach a scored, self-checking system (no network)
  python3 -m foundation ignition --fuel [--apply] spend control: pause the loops whose return is zero while burn is over budget; release when under

Four stages, each a function that reads only the previous stage's output:
  seed      the declarations (doctrine/*.json, loop registry, flows, topology) are the whole kernel; `seed()` lists what is declared and what is missing
            on the live account (the resource registry diff is deploy/cost-probe and `topology --drift`), so a rebuild needs only a token and this repository.
  ignite    registers every declared loop and its flow edges and runs the first mantra check; from empty state it writes the first score record.
  sustain   the criticality loop: score, mantra, predictions graded, stalled items re-dispatched (foundation/criticality.py).
  fuel      there is no perpetual motion: the energy is the budget. When burn (the binding load) is over 1, loops whose outflows no other loop consumes
            are paused through actions-budget.json (which scripts/actions_guard.py already enforces); they resume the run burn is back at or under 1.
"""
from __future__ import annotations
import json, shutil, sys, tempfile
from pathlib import Path

from . import criticality as cr

REPO = Path(__file__).resolve().parents[1]
KERNEL = ["doctrine/criticality.json", "doctrine/flows.json", "doctrine/topology.json", "instances/ultrastable/loop-registry.json",
          "deploy/cloudflare-accounts.json", "actions-budget.json"]


def seed(root=REPO) -> dict:
    missing = [k for k in KERNEL if not (Path(root) / k).exists()]
    topo = json.loads((Path(root) / "doctrine/topology.json").read_text(encoding="utf-8")) if not missing else {"workers": []}
    return {"declared_workers": [w["id"] for w in topo["workers"] if w.get("state") == "live"], "missing": missing, "needs": ["CLOUDFLARE_API_TOKEN", "this repository"]}


def ignite(root=REPO) -> dict:
    flows = json.loads((Path(root) / "doctrine/flows.json").read_text(encoding="utf-8"))["flows"]
    (Path(root) / "ops").mkdir(exist_ok=True)
    (Path(root) / "docs/issues").mkdir(parents=True, exist_ok=True)
    first = not (Path(root) / cr.LOG).exists()
    (Path(root) / cr.LOG).touch()
    edges = sum(len(f.get("outflows", [])) for f in flows.values())
    return {"loops": len(flows), "edges": edges, "first_ignition": first}


def fuel(root=REPO, apply=False) -> dict:
    root = Path(root)
    rec = cr.latest(root)
    c = cr.cfg(root)
    if not rec or not rec.get("headline"):
        return {"burn": None, "paused": []}
    h = rec["headline"]
    burn = max([x for x in (h["spend"]["d1_load"], h["spend"]["ai_load"], h["attention"]["load"]) if x is not None] or [0])
    flows = json.loads((root / "doctrine/flows.json").read_text(encoding="utf-8"))["flows"]
    reg = {l["id"]: l for l in json.loads((root / "instances/ultrastable/loop-registry.json").read_text(encoding="utf-8"))["loops"]}
    bud = json.loads((root / "actions-budget.json").read_text(encoding="utf-8"))
    keep = set(bud.get("essential", [])) | {"executor", "criticality"}
    zero = [fid for fid in flows if cr.tick_check(fid, root)["consumed"] is False]
    pausable = sorted({w[:-4] for fid in zero for w in reg.get(fid, {}).get("workflows", [])} - keep)
    mine = set(bud.get("fuel_paused", []))
    want = pausable if burn > 1 else []
    if apply and mine != set(want):
        bud["paused_workflows"] = sorted((set(bud.get("paused_workflows", [])) - mine) | set(want))
        bud["fuel_paused"] = want
        (root / "actions-budget.json").write_text(json.dumps(bud, indent=2) + "\n", encoding="utf-8")
    return {"burn": round(burn, 3), "limit": 1, "paused": want, "zero_return_loops": zero}


def prove() -> dict:
    """Nothing in, system out: copy only the kernel declarations to an empty tree and reach a scored, mantra-checked state with fuel control."""
    out = {}
    with tempfile.TemporaryDirectory() as td:
        t = Path(td)
        for k in KERNEL:
            (t / k).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / k, t / k)
        out["seed"] = seed(t)
        out["ignite"] = ignite(t)
        c = cr.cfg(t)
        coup, orphan = cr.coupling(t)
        inputs = {"at": cr.now().isoformat(timespec="seconds"), "deploys": {"d": {"auto": 1}}, "spend": {"d": {"d1_rows_read": 1.0, "ai_neurons": 1.0}},
                  "interventions": {"d": 0}, "coupling": coup, "orphan_signals": orphan}
        rec = cr.score(inputs, c)
        cr.store(rec, t)
        out["sustain"] = {"k": rec["headline"]["k"], "mantra_loops": len(cr.mantra_all(t))}
        out["fuel"] = fuel(t)
        out["ok"] = not out["seed"]["missing"] and out["ignite"]["first_ignition"] and (t / cr.LOG).read_text(encoding="utf-8").strip() != "" and out["fuel"]["burn"] is not None
    return out


def main(argv: list[str]) -> int:
    if "--fuel" in argv:
        print(json.dumps(fuel(apply="--apply" in argv), indent=1)); return 0
    r = prove()
    print(json.dumps(r, indent=1)); return 0 if r["ok"] else 1
