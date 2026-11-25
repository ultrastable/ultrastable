"""VERIFY-1 (Rowan, 2026-11-21): "What can Ultrastable learn from verified proof systems and critical infrastructure code that must prove all
statements are true and will run as expected without errors?" Ultrastable is the foundation for any autonomous system.

What is borrowed, and from where (credits also in doctrine/verification.json):
  model checking     AWS's use of TLA+ (Newcombe et al., "How Amazon Web Services Uses Formal Methods", CACM 2015): small exhaustive models of
                     the protocols, checked for safety (nothing bad) and liveness (something good stays reachable). Here a breadth-first
                     explicit-state checker in plain Python, no install, runs in `checks`.
  conformance        seL4 / CompCert: a proof is about a model, so the model must be tied to the code. Each model reads its constants from the
                     real source (spend bands from seed/worker/src/spend.js, ladders from doctrine/ultrastability.json), and a property-based
                     sweep of the real function (scripts/verify_spend.mjs) checks the code against the same properties.
  bounded loops      NASA/JPL Power of Ten rule 2: every loop has a fixed upper bound. Models are finite, so the checker always terminates;
                     a state space over `max_states` is a failure, never a silent truncation.
  coverage           DO-178C traceability: every invariant in the register names its model, its code probe and its source; coverage is the
                     share with both, written to ops/verification.json.

Checked properties per model: invariants hold in every reachable state (safety), no reachable non-terminal state lacks a successor (no
deadlock), and from every reachable state a goal state is reachable (AG EF goal: no stall, the TLA+ "eventually always possible" form).

  python3 -m foundation verify --check     run every model and every conformance probe; non-zero exit on any counterexample
  python3 -m foundation verify --report    the same, and write ops/verification.json (coverage of verified invariants)
"""
from __future__ import annotations
import json, re, subprocess, sys
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
# The same file runs in ultrastable/ultrastable (foundation/verify.py) and in the seed (scripts/verify.py), so every new system inherits it.
# A model whose source is absent in a system is reported as not applicable, never as a pass.


def worker_src(root=REPO):
    for c in ("seed/worker/src", "worker/src"):
        if (root / c / "tick.js").exists():
            return root / c
    return None
REGISTER = "doctrine/verification.json"


def check(init, succ, invariants, goal, terminal=lambda s: False, max_states=200_000) -> dict:
    """Explicit-state model check. init: iterable of states; succ(s) -> iterable of (label, s'); invariants: {name: pred}.
    Returns {'ok', 'states', 'violations': [{kind, name, trace}]} with a shortest counterexample trace per violation."""
    parent, order, q = {}, [], deque()
    for s in init:
        if s not in parent:
            parent[s] = None; q.append(s)
    edges = {}
    viol = []
    while q:
        s = q.popleft(); order.append(s)
        if len(parent) > max_states:
            return {"ok": False, "states": len(parent), "violations": [{"kind": "bound", "name": "max_states", "trace": []}]}
        for name, p in invariants.items():
            if not p(s) and not any(v["name"] == name for v in viol):
                viol.append({"kind": "safety", "name": name, "trace": _trace(parent, s)})
        nxt = list(succ(s))
        edges[s] = [t for _, t in nxt]
        if not nxt and not terminal(s) and not any(v["kind"] == "deadlock" for v in viol):
            viol.append({"kind": "deadlock", "name": "no-deadlock", "trace": _trace(parent, s)})
        for lab, t in nxt:
            if t not in parent:
                parent[t] = (s, lab); q.append(t)
    # AG EF goal: backward reachability from goal states over the reverse graph
    rev = {s: [] for s in order}
    for s, ts in edges.items():
        for t in ts:
            rev.setdefault(t, []).append(s)
    can = {s for s in order if goal(s)}
    q = deque(can)
    while q:
        t = q.popleft()
        for s in rev.get(t, []):
            if s not in can:
                can.add(s); q.append(s)
    stuck = [s for s in order if s not in can]
    if stuck:
        viol.append({"kind": "liveness", "name": "goal-always-reachable", "trace": _trace(parent, stuck[0])})
    return {"ok": not viol, "states": len(order), "violations": viol}


def _trace(parent, s):
    out = []
    while s is not None:
        p = parent[s]
        out.append({"state": repr(s), "via": p[1] if p else "init"})
        s = p[0] if p else None
    return list(reversed(out))


# ---- model 1: spend governor (SPEND-SOFT-1). State: (share bucket in tenths 0..20, essential steps ran). Spend moves up or down one bucket per
# tick (the environment is adversarial); the governor maps the share to a band from the real BANDS. Soft cap = no band stops essential work.
def governor_model(bands):
    def band(b):
        sh = b / 10
        return next((x for x in bands if x["below"] is None or sh < x["below"]), bands[-1])
    def succ(s):
        b, _ = s
        for nb in {max(0, b - 1), min(20, b + 1)}:
            bd = band(nb)
            yield (f"spend->{nb/10:.1f}:{bd['level']}", (nb, bd["pace"] is not None and bd["pace"] >= 1))
    inv = {"essential-loops-run-in-every-band": lambda s: s[1],
           "pace-finite": lambda s: all(x["pace"] is not None and x["pace"] < 1e6 for x in bands)}
    return check([(b, True) for b in range(21)], succ, inv, goal=lambda s: band(s[0])["level"] == bands[0]["level"])


# ---- model 2: merge lane (DRAIN-ALL-1, AUTO-SHIP-CLEAN-1). PR phase and retry counter (bounded: Power of Ten rule 2).
def merge_lane_model(MAX_RETRY=3):
    T = {"merged", "superseded"}
    def succ(s):
        ph, n = s
        if ph in T:
            return
        if ph == "draft": yield ("mark-ready", ("open", n))
        elif ph == "open": yield ("run-checks", ("checking", n))
        elif ph == "checking":
            yield ("green", ("green", n)); yield ("red", ("red", n)); yield ("conflict", ("conflict", n))
        elif ph == "green":
            yield ("merge", ("merged", n)); yield ("main-moved", ("conflict", n))
        elif ph in ("red", "conflict"):
            if n < MAX_RETRY: yield ("repair-or-merge-main", ("checking", n + 1))
            yield ("replace-from-main", ("superseded", n))
    inv = {"merge-only-from-green": lambda s: True,  # enforced structurally: the only edge into merged is from green; asserted below
           "retry-bounded": lambda s: s[1] <= MAX_RETRY}
    r = check([("draft", 0), ("open", 0)], succ, inv, goal=lambda s: s[0] in T, terminal=lambda s: s[0] in T)
    # structural safety: no edge into merged except from green
    bad = [(a, l) for a in [(p, k) for p in ("draft", "open", "checking", "green", "red", "conflict") for k in range(MAX_RETRY + 1)]
           for l, t in succ(a) if t[0] == "merged" and a[0] != "green"]
    if bad:
        r["ok"] = False; r["violations"].append({"kind": "safety", "name": "merge-only-from-green", "trace": [{"state": repr(bad[0]), "via": "edge"}]})
    return r


# ---- model 3: Ashby's second loop (ULTRASTABILITY-1, ASHBY-SEARCH-1), with the real ladder length per variable. State: (in bounds, ladder idx,
# search draws mod K, bounds unchanged). While out of bounds the loop always has a step to take; bounds are never edited to clear a breach.
def second_loop_model(ladder_len, k=4):
    def succ(s):
        inb, idx, draw, bounds_ok = s
        yield ("disturb", (False, idx, draw, bounds_ok)) if inb else None
        if not inb:
            if idx < ladder_len:
                yield ("ladder-step-holds", (True, 0, 0, bounds_ok)); yield ("ladder-step-reverted", (False, idx + 1, draw, bounds_ok))
            else:
                yield ("search-draw-holds", (True, 0, 0, bounds_ok)); yield ("search-draw-fails", (False, idx, (draw + 1) % k, bounds_ok))
    clean = lambda s: (x for x in succ(s) if x)
    return check([(True, 0, 0, True), (False, 0, 0, True)], clean, {"bounds-never-edited": lambda s: s[3]}, goal=lambda s: s[0])


# ---- model 4: halt and tick (HALT-1). One halt stops every step; without it the essential steps run every tick.
def halt_model(STEPS=("migrate", "reconcile", "measure", "criticality")):
    STEPS = tuple(STEPS)
    def succ(s):
        halted, ran = s
        yield ("tick", (halted, frozenset() if halted else frozenset(STEPS)))
        yield ("toggle-halt", (not halted, frozenset()))
    inv = {"halt-stops-everything": lambda s: not (s[0] and s[1]),
           "no-halt-runs-every-essential-step": lambda s: s[0] or s[1] in (frozenset(), frozenset(STEPS))}
    return check([(False, frozenset()), (True, frozenset())], succ, inv, goal=lambda s: s[1] == frozenset(STEPS))


def spend_conformance(root=REPO) -> dict:
    return _node(root, "scripts/verify_spend.mjs", "spend.js")


NA = {"ok": True, "na": True, "states": 0, "violations": []}


def _node(root, script, needs) -> dict:
    w = worker_src(root)
    if w is None or not (w / needs).exists():
        return dict(NA, fail={})
    p = subprocess.run(["node", str(root / script), (w / needs).as_uri()], capture_output=True, text=True, timeout=120)
    if p.returncode != 0:
        return {"ok": False, "error": (p.stderr or p.stdout)[-800:]}
    d = json.loads(p.stdout.strip().splitlines()[-1]); d["ok"] = not any(d["fail"].values())
    return d


def lane_conformance(root=REPO) -> dict:
    """Runtime-path monitor for lane-retries-bounded: the handoff closer's retry constants are finite and exhausting them blocks the item
    (seed/worker/src/handoff.js), so the model's bound is the deployed bound."""
    w = worker_src(root)
    if w is None or not (w / "handoff.js").exists():
        return dict(NA, fail={})
    src = (w / "handoff.js").read_text(encoding="utf-8")
    m = re.search(r"const MAX_ATTEMPTS = (\d+);", src); v = re.search(r"const VERIFY_TRIES = (\d+);", src)
    fail = {"max_attempts_missing": [] if m else ["MAX_ATTEMPTS"], "verify_tries_missing": [] if v else ["VERIFY_TRIES"],
            "exhaustion_does_not_block": [] if re.search(r"n >= MAX_ATTEMPTS\)\s*\{[^}]*'blocked'", src) else ["blocked branch"]}
    return {"ok": not any(fail.values()), "max_attempts": int(m.group(1)) if m else None, "fail": fail}


def tick_conformance(root=REPO) -> dict:
    """Read the step lists from seed/worker/src/tick.js as source (the module imports shared core paths a seed checkout may not have, so it is
    parsed, not imported): every essential step is in the step order and is kept at every spend level."""
    w = worker_src(root)
    if w is None:
        return dict(NA, fail={})
    src = "\n".join((w / f).read_text(encoding="utf-8") for f in ("tick.js", "stepplan.js") if (w / f).exists())
    def arr(name):
        m = re.search(r"export const " + name + r" = \[([^\]]*)\]", src)
        if not m:
            return None
        out = []
        for part in m.group(1).split(","):
            part = part.strip()
            if part.startswith("..."):
                out += arr(part[3:]) or []
            elif part:
                out.append(part.strip("'\""))
        return out
    order, ess, keep = arr("STEP_ORDER"), arr("COST_ESSENTIAL_STEPS"), arr("SPEND_KEEP_STEPS")
    if not (order and ess):
        return {"ok": False, "error": "STEP_ORDER or COST_ESSENTIAL_STEPS not found in tick.js", "fail": {"parse": ["tick.js"]}}
    keep = order if keep is None else keep  # a tick with no spend governor (older seed copies) throttles nothing
    fail = {"missing_in_order": [x for x in ess if x not in order], "dropped_when_throttled": [x for x in ess if x not in keep]}
    return {"ok": not any(fail.values()), "essential": ess, "fail": fail}


def run(root=REPO) -> dict:
    reg = json.loads((root / REGISTER).read_text(encoding="utf-8"))
    conf = spend_conformance(root)
    results = {"spend-conformance": conf}
    if conf.get("bands"):
        results["governor"] = governor_model(conf["bands"])
    elif conf.get("na"):
        results["governor"] = dict(NA)
    else:
        results["governor"] = {"ok": False, "violations": [{"kind": "input", "name": "bands-unreadable", "trace": []}]}
    lane = lane_conformance(root); results["lane-conformance"] = lane
    results["merge-lane"] = merge_lane_model(lane.get("max_attempts") or 3)
    up = root / "doctrine/ultrastability.json"
    ultra = json.loads(up.read_text(encoding="utf-8")) if up.exists() else {"scopes": {}}
    lens = sorted({len(v.get("ladder", [])) for sc in ultra["scopes"].values() for v in sc.get("variables", [])})
    results["second-loop"] = {"ok": True, "ladders": lens, "states": 0, "violations": []} if lens else dict(NA)
    for n in lens:
        r = second_loop_model(n)
        results["second-loop"]["states"] += r["states"]
        if not r["ok"]:
            results["second-loop"]["ok"] = False; results["second-loop"]["violations"] += r["violations"]
    tick = tick_conformance(root); results["tick-conformance"] = tick
    results["halt"] = halt_model(tick["essential"]) if tick.get("essential") else dict(NA)
    inv = []
    for i in reg["invariants"]:
        m = results.get(i["model"], {}); c = results.get(i.get("conformance") or "", {})
        if m.get("na"):
            continue
        mc = bool(m.get("ok")) and not any(v["name"] == i["property"] for v in m.get("violations", []))
        inv.append({"id": i["id"], "model_checked": mc, "code_conformance": bool(i.get("conformance")) and bool(c.get("ok")),
                    "runtime_monitor": i.get("monitor"), "source": i["source"]})
    full = sum(1 for x in inv if x["model_checked"] and (x["code_conformance"] or x["runtime_monitor"]))
    return {"marker": "VERIFY-1", "ok": all(r.get("ok") for r in results.values()), "results": results, "invariants": inv,
            "coverage": {"invariants": len(inv), "model_checked": sum(x["model_checked"] for x in inv), "tied_to_code": full,
                         "share": round(full / len(inv), 3) if inv else 0.0}}


DATA = "site/verification-data.js"


def data_text(out) -> str:
    """Front-end module (no timestamp, so it changes only when a result changes: SUBSTANCE-1)."""
    reg = json.loads((REPO / REGISTER).read_text(encoding="utf-8"))
    d = {"marker": "VERIFY-1", "ok": out["ok"], "coverage": out["coverage"], "sources": reg["sources"],
         "models": {k: {"ok": bool(v.get("ok")), "states": v.get("states", v.get("samples"))} for k, v in out["results"].items()},
         "invariants": out["invariants"]}
    return ("// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n// GENERATED by python3 -m foundation verify --data --apply from "
            "doctrine/verification.json and the model checks. Do not edit; verify --check fails when stale.\nexport default "
            + json.dumps(d, indent=1, sort_keys=True) + ";\n")


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    out = run()
    for k, r in out["results"].items():
        print(f"{'n/a ' if r.get('na') else 'ok  ' if r.get('ok') else 'FAIL'} {k}: states={r.get('states', r.get('samples', '-'))}")
        for v in r.get("violations", []) or []:
            print(f"     {v['kind']} {v['name']}: " + " -> ".join(f"{t['via']}:{t['state']}" for t in v["trace"][-6:]))
        if r.get("error"): print("     " + r["error"])
    c = out["coverage"]
    print(f"VERIFY-1 coverage: {c['tied_to_code']}/{c['invariants']} invariants model-checked and tied to code ({c['share']:.0%})")
    if ("--data" in argv or "--check" in argv) and (REPO / "site").is_dir():
        want = data_text(out); p = REPO / DATA
        if "--apply" in argv:
            p.write_text(want, encoding="utf-8")
        elif not p.exists() or p.read_text(encoding="utf-8") != want:
            print(f"FAIL {DATA} is stale: run python3 -m foundation verify --data --apply"); return 1
    if "--report" in argv:
        rep = {**out, "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
        rep["results"] = {k: {kk: vv for kk, vv in v.items() if kk != "fail"} for k, v in out["results"].items()}
        (REPO / "ops/verification.json").write_text(json.dumps(rep, indent=1) + "\n", encoding="utf-8")
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
