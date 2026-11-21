# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SELF-MODEL-1: what the system is, in code. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation selfmodel [--check | --apply | --print]

One canonical machine-readable self-model, built from doctrine/ultrastability.json (identity, essential variables, ladders, inheritance) and the live
declarations of the running parts: the loop registry (the regulators of the fast loop), the topology (workers), the workflows, the clocks and their
escalation (watchdogs), and the boundary (what only the owner can do). `--apply` writes site/self-data.js, which the site worker serves at /self and
/.well-known/ultrastable with the latest readings. `--check` (in checks.yml) fails when a first-order regulator named by a variable resolves to nothing,
when the model names a file that does not exist, when a workflow belongs to no loop and is not in the shrink-only baseline doctrine/self-baseline.json,
or when site/self-data.js is stale (a running part was added or removed and the model was not regenerated).
The ultrastability tick consults this model before it changes anything (foundation/ultrastability.py): a variable whose regulators the model cannot
resolve is not stepped; an item is filed instead. Tests: tests/foundation/test_selfmodel.py.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DATA = "site/self-data.js"
BASELINE = "doctrine/self-baseline.json"


def _j(root, rel):
    return json.loads((Path(root) / rel).read_text(encoding="utf-8"))


def workflows(root=REPO) -> list[str]:
    return sorted(p.stem for p in (Path(root) / ".github/workflows").glob("*.yml"))


def build(root=REPO, readings=True) -> dict:
    root = Path(root)
    u = _j(root, "doctrine/ultrastability.json")
    reg = _j(root, "instances/ultrastable/loop-registry.json")["loops"]
    topo = _j(root, "doctrine/topology.json")
    clocks = _j(root, "doctrine/clocks.json")
    bound = _j(root, "doctrine/boundary.json")
    owned = {}
    for l in reg:
        for w in l.get("workflows") or []:
            owned.setdefault(Path(w).stem, []).append(l["id"])
    wf = [{"id": w, "loops": owned.get(w, [])} for w in workflows(root)]
    loops = [{k: l.get(k) for k in ("id", "kind", "summary", "trigger", "owner", "sla", "closing_probe", "server_owner")} | {"workflows": [Path(w).stem for w in l.get("workflows") or []]} for l in reg]
    ids = {l["id"] for l in reg} | {c["id"] for c in clocks["clocks"]} | {w["id"] for w in topo["workers"]}
    scopes = {}
    for name, s in u["scopes"].items():
        scopes[name] = {"status": s["status"], "what": s["what"], "variables": [
            {"id": v["id"], "name": v["name"], "reading": v["reading"], "min": v["min"], "max": v["max"], "unit": v["unit"], "why": v["why"],
             "regulators": v["first_order"], "steps": v["ladder"]} for v in s["variables"]]}
    m = {"self": u["self"], "credit": u["credit"],
         "essential_variables": scopes,
         "fast_loop": {"what": "the regulators: loops that correct disturbance without changing the system", "regulators": sorted({x for s in u["scopes"].values() for v in s["variables"] for x in v["first_order"]})},
         "slow_loop": {"what": "step-function changes to parameters or structure when a variable stays out of bounds, kept only if the variable returns", "patience_ticks": u["patience_ticks"],
                       "settle_ticks": u["settle_ticks"], "ledger": u["ledger"], "code": "foundation/ultrastability.py",
                       "parameters": sorted({f"{st['file']}:{st['path']}" for s in u["scopes"].values() for v in s["variables"] for st in v["ladder"] if st["kind"] == "param"})},
         "parts": {"workers": [{"id": w["id"], "state": w["state"]} for w in topo["workers"]], "workflows": wf, "loops": loops},
         "clocks": {"clocks": [{k: c.get(k) for k in ("id", "what", "expected_interval_s", "source")} for c in clocks["clocks"]], "watchdog_escalation": clocks["escalation"]},
         "boundary": {"inside": [{"id": i["id"], "what": i["what"], "rebuild": i["rebuild"]} for i in bound["inside"]], "egress": [{k: e.get(k) for k in ("id", "class", "gate", "default")} for e in bound["egress"]]},
         "inheritance": u["self"]["inheritance"], "index": sorted(ids)}
    if readings:
        m["readings"] = latest_readings(root)
    return m


def latest_readings(root=REPO) -> dict:
    p = Path(root) / _j(root, "doctrine/ultrastability.json")["ledger"]
    out = {}
    if p.is_file():
        for ln in p.read_text(encoding="utf-8").splitlines():
            if ln.strip():
                r = json.loads(ln)
                if r.get("ev") == "reading":
                    out[r["var"]] = {"value": r["value"], "in_bounds": r["ok"], "at": r["at"], "unmeasured": bool(r.get("unmeasured"))}
    return out


def render(root=REPO) -> str:
    return ("// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n// GENERATED by python3 -m foundation selfmodel --apply from doctrine/ultrastability.json and the live declarations. Do not edit; --check fails when the parts differ.\n"
            "export default " + json.dumps(build(root), indent=1, sort_keys=True) + ";\n")


def _static(text: str) -> str:
    return re.sub(r'"readings": \{.*?\n \}(,?)\n', '"readings": {}\\1\n', text, flags=re.S) if '"readings"' in text else text


def check(root=REPO) -> list[str]:
    root, errs = Path(root), []
    m = build(root)
    idx = set(m["index"])
    for name, s in m["essential_variables"].items():
        for v in s["variables"]:
            for r in v["regulators"]:
                if r not in idx:
                    errs.append(f"{name}.{v['id']} names regulator {r!r}, which is no loop, clock or worker")
    for f in m["inheritance"]["carriers"]:
        if not (root / f).is_file():
            errs.append(f"inheritance carrier {f} does not exist")
    for p in m["slow_loop"]["parameters"]:
        if not (root / p.split(":")[0]).is_file():
            errs.append(f"slow-loop parameter file {p} does not exist")
    for c in m["clocks"]["clocks"]:
        if c["source"] == "workflow" and c["id"] not in {w["id"] for w in m["parts"]["workflows"]} and not (root / ".github/workflows").glob(f"{c['id']}*"):
            errs.append(f"clock {c['id']} names a workflow that does not exist")
    base = set(_j(root, BASELINE)["workflows_without_loop"]) if (root / BASELINE).is_file() else set()
    loose = {w["id"] for w in m["parts"]["workflows"] if not w["loops"]}
    for w in sorted(loose - base):
        errs.append(f"workflow {w} belongs to no loop: declare it in a loop's workflows in instances/ultrastable/loop-registry.json (the baseline is shrink-only)")
    for w in sorted(base - loose):
        errs.append(f"{BASELINE} lists {w}, which now has a loop or no longer exists: remove it")
    p = root / DATA
    if p.is_file():
        have = json.loads(p.read_text(encoding="utf-8").split("export default ", 1)[1].rstrip().rstrip(";"))
        have.pop("readings", None)
        want = dict(m); want.pop("readings", None)
        if have != want:
            errs.append(f"{DATA} is stale: a running part was added or removed; run selfmodel --apply")
    else:
        errs.append(f"{DATA} missing: run selfmodel --apply")
    return errs


def main(argv=None) -> int:
    a = argv if argv is not None else sys.argv[1:]
    if "--check" in a:
        e = check(); print("\n".join(e) or "selfmodel ok: every regulator resolves, every part is registered, the served model matches the code"); return 1 if e else 0
    if "--apply" in a:
        new, cur = render(), REPO / DATA
        stamp = re.compile(r'^\s*"at": "[^"]*",?$', re.M)  # SUBSTANCE-1: a reading whose value and bounds did not change is not rewritten for its timestamp alone
        if cur.is_file() and stamp.sub("", cur.read_text(encoding="utf-8")) == stamp.sub("", new):
            print(DATA, "unchanged apart from reading timestamps; not rewritten"); return 0
        cur.write_text(new, encoding="utf-8"); print("wrote", DATA); return 0
    if "--print" in a:
        print(json.dumps(build(), indent=1)); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())
