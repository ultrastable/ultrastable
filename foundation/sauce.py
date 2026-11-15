"""QNFO-PORT-1: the loops that make a fleet close its own work, as one pass on the foundation's clock, and the inventory that says which are ported.

  python3 -m foundation sauce --tick [--apply]     contracts -> meta-ticket fold -> throughput -> metric loop -> ignition gaps -> criticality tick
  python3 -m foundation sauce --check              doctrine/qnfo-port.json is complete: every mechanism marked ported has its module, test and wiring;
                                                   every instance declaring foundation loops (instances/*/foundation-loops.json) names only known ones
  python3 -m foundation sauce --parity SLUG DIR    the instance's own implementation files of each loop exist in its checkout DIR (a later sync runs this)

One pass, in order, so each loop sees the previous one's result: contracts close items whose probe passes and reopen relapses
(foundation/contracts.py); the fold closes tickets whose record resolved (foundation/metafold.py); throughput records the lifecycle and files a
doer item for a family that grows with nothing closing it (foundation/throughput.py); the metric loop reads every metric, files or replaces the
remedy and judges efficacy (foundation/metricloop.py). The links that still do not close on themselves are written to ops/ignition.json as
ignition gaps; foundation/criticality.py reads them next to k, and the system claims self-sustaining only when k is at its floor and the
gap count is 0. The criticality tick then runs in the same pass, so k is measured on the launch clock as well as on the cost-guard workflow.
"""
from __future__ import annotations
import json, os, shutil, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
INVENTORY = "doctrine/qnfo-port.json"
IGNITION = "ops/ignition.json"
STATUSES = ("ported", "partial", "missing")
LEDGERS = ["ops/contracts.jsonl", "ops/fold-ledger.jsonl", "ops/issue-lifecycle.jsonl", "ops/metric-loop.jsonl", IGNITION, "ops/criticality.jsonl"]


def inventory(root=REPO) -> dict:
    p = Path(root) / INVENTORY
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {"mechanisms": []}


def mechanism(root, mid: str) -> dict:
    return next((m for m in inventory(root)["mechanisms"] if m["id"] == mid), {})


def gaps(con: dict, fold: dict, thr: dict, met: dict) -> list[dict]:
    """Every link that does not close on itself after this pass, as a row: link, owner, closing probe, source."""
    g = [{"link": f"item {i} relapsed after it closed", "owner": "executor", "closing_probe": f"contracts: {i} passes over the hold", "source": "contracts"} for i in con.get("relapsed_open", [])]
    g += [{"link": f"item {i} has no machine-executable closing probe", "owner": "operations", "closing_probe": f"contracts: {i} probe verdict is pass or fail", "source": "contracts"} for i in con.get("unusable_open", [])]
    g += [{"link": f"family {f} grows and nothing closes it", "owner": "operations", "closing_probe": f"cmd:python3 -m foundation throughput --doer {f}", "source": "throughput"} for f in thr.get("without_doer", [])]
    if thr.get("silent_drops"):
        g.append({"link": f"{thr['silent_drops']} open item(s) vanished without a disposition", "owner": "operations", "closing_probe": "throughput: silent_drops 0 in the window", "source": "throughput"})
    g += [{"link": f"metric {m} has no untried lever", "owner": "operations", "closing_probe": f"cmd:python3 -m foundation metricloop --probe {m}", "source": "metricloop"} for m in met.get("exhausted", [])]
    g += [{"link": f"guard {r['guard']} worsened while {r['target']} improved", "owner": "operations", "closing_probe": "metricloop: no guard regression on the next pass", "source": "metricloop"} for r in met.get("regressions", [])]
    g += [{"link": f"meta-ticket reference is dangling: {d}", "owner": "operations", "closing_probe": "metafold: reference resolves", "source": "metafold"} for d in fold.get("dangling", [])]
    return g


def tick(root=REPO, apply=False, now=None, criticality_tick=True) -> dict:
    from . import contracts, metafold, throughput, metricloop, criticality
    root = Path(root)
    now = now or datetime.now(timezone.utc)
    res, errs = {}, []
    for name, fn in (("contracts", lambda: contracts.tick(root, apply=apply, now=now)), ("metafold", lambda: metafold.tick(root, apply=apply, now=now)),
                     ("throughput", lambda: throughput.tick(root, apply=apply, now=now)), ("metricloop", lambda: metricloop.tick(root, apply=apply, now=now))):
        try:
            res[name] = fn()
        except Exception as e:  # one broken loop is recorded and the others still run
            res[name] = {}
            errs.append(f"{name}: {type(e).__name__}: {e}"[:300])
    g = gaps(res["contracts"], res["metafold"], res["throughput"], res["metricloop"])
    g += [{"link": f"loop {e.split(':')[0]} crashed this pass", "owner": "operations", "closing_probe": "sauce: the loop runs without error", "source": "sauce"} for e in errs]
    ign = {"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "open_ignition_gaps": len(g), "gaps": g}
    if apply:
        p = root / IGNITION
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(ign, indent=1) + "\n", encoding="utf-8")
    crit = criticality.tick(root, apply=apply, now=now) if criticality_tick and (root / "doctrine/criticality.json").is_file() else None
    pushed = collect(root) if apply else {"sent": False, "why": "dry run"}
    con = res["contracts"]
    return {"at": ign["at"], "errors": errs, "open_ignition_gaps": len(g), "gaps": g,
            "contracts": {k: con.get(k) for k in ("closes", "reopens", "relapse_rate")} | {"changed": [f"{r['action']} {r['id']}" for r in con.get("rows", []) if r["action"] in ("close", "reopen")]},
            "folded": [f["id"] for f in res["metafold"].get("folded", [])], "families_without_doer": res["throughput"].get("without_doer", []),
            "metrics_breached": res["metricloop"].get("breached", []), "remedy_efficacy_30d": res["metricloop"].get("efficacy_30d"),
            "filed": res["throughput"].get("filed", []) + res["metricloop"].get("filed", []),
            "k": crit and crit["k"], "self_sustaining": crit and crit.get("self_sustaining"), "collector": pushed}


def collect(root) -> dict:
    """Q-CRIT-COLLECTORS: hand this pass's deploys, cost and ignition gaps to the tick Worker (deploy/criticality-collect.mjs) when its URL and
    token are present on this host; otherwise say why nothing was sent. Never raises: the Worker being unreachable is a finding, not a crash."""
    script = Path(root) / "deploy/criticality-collect.mjs"
    if not (os.environ.get("CRITICALITY_URL") and os.environ.get("CRITICALITY_TOKEN")):
        return {"sent": False, "why": "CRITICALITY_URL or CRITICALITY_TOKEN not set on this host"}
    if not (script.is_file() and shutil.which("node")):
        return {"sent": False, "why": "node or deploy/criticality-collect.mjs missing"}
    try:
        r = subprocess.run(["node", str(script)], cwd=root, capture_output=True, text=True, timeout=90, encoding="utf-8", errors="replace")
        return json.loads(r.stdout.strip().splitlines()[-1]) if r.stdout.strip() else {"sent": False, "why": r.stderr[-200:]}
    except (OSError, subprocess.SubprocessError, ValueError) as e:
        return {"sent": False, "why": f"{type(e).__name__}: {e}"[:200]}


def loop(root=REPO, apply=True) -> dict:
    """The launch-pass entry (foundation/launch.py): ok unless a ported loop crashed. Breaches and gaps are findings with items, not failures of the loop."""
    try:
        r = tick(root, apply=apply)
    except Exception as e:  # recorded as a failed loop, never swallowed
        return {"loop": "qnfo-sauce", "ok": False, "detail": f"{type(e).__name__}: {e}"[:300]}
    return {"loop": "qnfo-sauce", "ok": not r["errors"], **r, "paths": [p for p in LEDGERS if (Path(root) / p).is_file()]}


def _wired(root: Path, spec: str) -> bool:
    path, _, needle = spec.partition("::")
    p = root / path
    return p.is_file() and (not needle or needle in p.read_text(encoding="utf-8", errors="replace"))


def check(root=REPO) -> list[str]:
    root, errs = Path(root), []
    inv = inventory(root)
    ids = set()
    for m in inv.get("mechanisms", []):
        i = m.get("id", "?")
        if i in ids:
            errs.append(f"{i}: duplicate mechanism")
        ids.add(i)
        for k in ("id", "qnfo_rule", "qnfo_source", "status", "status_before", "priority"):
            if k not in m:
                errs.append(f"{i}: lacks {k}")
        if m.get("status") not in STATUSES or m.get("status_before") not in STATUSES:
            errs.append(f"{i}: status must be one of {STATUSES}")
        if m.get("status") in ("ported", "partial"):
            for f in m.get("ultrastable_module", []) or [None]:
                if not f or not (root / f).is_file():
                    errs.append(f"{i}: marked {m.get('status')} but module {f} does not exist")
        if m.get("status") == "ported":
            for t in m.get("test", []) or [None]:
                if not t or not (root / t).is_file():
                    errs.append(f"{i}: marked ported but test {t} does not exist")
            if not m.get("wired_into"):
                errs.append(f"{i}: marked ported but wired into nothing (a module no tick runs is not a running loop)")
            for w in m.get("wired_into", []):
                if not _wired(root, w):
                    errs.append(f"{i}: wiring {w} not found")
    for p in sorted((root / "instances").glob("*/foundation-loops.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        for l in d.get("loops", []):
            if l.get("foundation_loop") not in ids:
                errs.append(f"{p.parent.name}: declares unknown foundation loop {l.get('foundation_loop')}")
            if not l.get("impl"):
                errs.append(f"{p.parent.name}: loop {l.get('foundation_loop')} names no implementation")
    return errs


def parity(slug: str, checkout: str, root=REPO) -> list[str]:
    """Each declared loop's implementation files exist in the instance checkout, and every ported mechanism is declared by the instance."""
    root, d = Path(root), json.loads((Path(root) / "instances" / slug / "foundation-loops.json").read_text(encoding="utf-8"))
    errs, declared = [], set()
    for l in d["loops"]:
        declared.add(l["foundation_loop"])
        for f in l["impl"]:
            if not (Path(checkout) / f).exists():
                errs.append(f"{l['foundation_loop']}: {f} not in {checkout}")
    for m in inventory(root)["mechanisms"]:
        if m["status"] == "ported" and m["id"] not in declared:
            errs.append(f"{m['id']}: ported in the foundation but {slug} does not declare which of its loops satisfies it")
    return errs


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--check" in a:
        e = check(); print("\n".join(e) or f"sauce ok: {sum(m['status'] == 'ported' for m in inventory()['mechanisms'])} mechanisms ported"); return 1 if e else 0
    if "--parity" in a:
        i = a.index("--parity"); e = parity(a[i + 1], a[i + 2]); print("\n".join(e) or "parity ok"); return 1 if e else 0
    if "--tick" in a:
        print(json.dumps(tick(apply="--apply" in a), indent=1)); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())
