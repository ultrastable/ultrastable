# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""PHASED-WORK-1: every large change moves through the same phases. Ultrastable is the foundation for any autonomous system.

  python3 scripts/phasework.py new --goal G --slices A,B,C [--gaps g1,g2] [--out run.json]   plan a run: one agent row per phase and slice
  python3 scripts/phasework.py next run.json [--limit N]                                     the agents that can start now (parallel, in phase order)
  python3 scripts/phasework.py done run.json AGENT --by WHO [--ok | --finding "slice: text"] [--tokens N]   record an agent's result
  python3 scripts/phasework.py status run.json                                               phase progress, like 10/11
  python3 scripts/phasework.py --check                                                       autonomy/phases.json, the Worker and the rule agree
  (platform: python3 -m foundation phasework ...; every seeded system carries this file)

The phases are data in autonomy/phases.json: audit (one reader per subsystem), coverage (what no spec covers), implement (one author per slice),
new_specs (a spec per gap, beside implement), verify (two readers per slice, an evidence one and an adversarial one, neither of whom wrote it), fix
(only slices with findings, at most max_fix_rounds), integrate (one change) and final_gate (the full check on the integrated change). Large work is
broken into slices that can be worked together and proven one by one, then joined; a session, a loop or the tick Worker (worker/src/orchestrate.js)
all follow this one shape, so a complex change is implemented in code, not described.

The engine is pure: a run is one JSON document, every function takes it and returns it, and nothing here calls a model. Whoever runs the agents
(a cloud session, a workflow, the Worker) asks `next`, starts those agents, and reports each with `done`. Independence is enforced here: a verifier
is never the author of the slice it verifies, and the two verifiers of a slice are never the same agent."""
from __future__ import annotations
import argparse, copy, datetime as dt, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONF = "autonomy/phases.json"
LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def cfg(root=ROOT) -> dict:
    return json.loads((Path(root) / CONF).read_text(encoding="utf-8"))


def _now(now=None) -> str:
    return (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _agent(phase, aid, slice_=None, **kw) -> dict:
    return {"id": aid, "phase": phase, "slice": slice_, "status": "pending", "by": None, "tokens": 0, "round": 1, "findings": [], **kw}


def new_run(goal: str, slices, gaps=(), root=ROOT, now=None) -> dict:
    """One agent row per phase and slice. Slices are lettered A, B, C in the order given; gaps are named subsystems no spec covers."""
    c = cfg(root)
    slices = [s.strip() for s in slices if s and s.strip()]
    if not goal.strip():
        raise ValueError("a run needs a goal")
    if not 1 <= len(slices) <= c["limits"]["max_slices"]:
        raise ValueError(f"a run needs 1..{c['limits']['max_slices']} slices, got {len(slices)}")
    names = {LETTERS[i]: s for i, s in enumerate(slices)}
    ag = [_agent("audit", f"audit:{k}", k, what=v) for k, v in names.items()]
    ag.append(_agent("coverage", "coverage"))
    ag += [_agent("implement", f"impl:{k}", k, what=v) for k, v in names.items()]
    ag += [_agent("new_specs", f"author:{g}", None, what=g) for g in gaps]
    for k in names:
        ag += [_agent("verify", f"verify-evidence:{k}", k, reviewer="evidence"), _agent("verify", f"verify-adversarial:{k}", k, reviewer="adversarial")]
    for g in gaps:
        ag += [_agent("verify", f"verify-evidence:{g}", g, reviewer="evidence"), _agent("verify", f"verify-adversarial:{g}", g, reviewer="adversarial")]
    ag += [_agent("integrate", "integrate"), _agent("final_gate", "final_gate")]
    run = {"v": 1, "goal": goal.strip(), "slices": names, "gaps": list(gaps), "agents": ag, "round": 0, "state": "running", "reason": "",
           "started": _now(now), "updated": _now(now)}
    problems = validate(run, root)
    if problems:
        raise ValueError("; ".join(problems))
    return run


def _by_id(run) -> dict:
    return {a["id"]: a for a in run["agents"]}


def phase_done(run, phase) -> bool:
    ag = [a for a in run["agents"] if a["phase"] == phase]
    return all(a["status"] == "done" for a in ag)  # a phase with no agents is done (new_specs with no gaps)


def _deps(run, a, c) -> list[str]:
    """Phases an agent waits for. Slice-level agents wait for their own slice, not the whole phase, so a finished audit starts its author at once."""
    p = {x["id"]: x for x in c["phases"]}[a["phase"]]
    return [n for n in p["needs"]]


def ready(run, root=ROOT, limit=None) -> list[dict]:
    """Agents that can start now: pending, every phase they need finished, in phase order, at most `parallel` running together."""
    if run["state"] != "running":
        return []
    c = cfg(root)
    cap = limit or c["limits"]["parallel"]
    running = [a for a in run["agents"] if a["status"] == "running"]
    order = {p["id"]: i for i, p in enumerate(c["phases"])}
    out = []
    for a in sorted((a for a in run["agents"] if a["status"] == "pending"), key=lambda a: order[a["phase"]]):
        if len(running) + len(out) >= cap:
            break
        waiting = [n for n in _deps(run, a, c) if not phase_done(run, n)]
        if waiting and a["phase"] == "verify" and a["slice"] is not None:
            # a slice's verifiers wait for that slice's author only, so a finished slice is proven while the others are still being built
            own = f"impl:{a['slice']}" if a["slice"] in run["slices"] else f"author:{a['slice']}"
            waiting = [n for n in waiting if n not in ("implement", "new_specs")] + ([] if _by_id(run).get(own, {}).get("status") == "done" else [own])
        if not waiting:
            out.append(a)
    return out


def start(run, aid, now=None) -> dict:
    a = _by_id(run)[aid]
    if a["status"] != "pending":
        raise ValueError(f"{aid} is {a['status']}, not pending")
    a["status"] = "running"
    run["updated"] = _now(now)
    return run


def done(run, aid, by, ok=True, findings=(), tokens=0, root=ROOT, now=None) -> dict:
    """Record an agent's result. A verifier that raises findings sends only that slice back to fix; the verifiers re-run after the fix."""
    c = cfg(root)
    lim = c["limits"]
    a = _by_id(run).get(aid)
    if a is None:
        raise ValueError(f"unknown agent {aid}")
    if a["status"] == "done":
        raise ValueError(f"{aid} is already done")
    if not by:
        raise ValueError("record who did the work (--by): independence cannot be checked without it")
    a["by"], a["tokens"] = by, a["tokens"] + int(tokens)
    run["updated"] = _now(now)
    if a["phase"] == "verify":
        mine = _author_of(run, a["slice"])
        if mine and mine == by:
            raise ValueError(f"{aid}: {by} wrote this slice and cannot verify it")
        pair = _by_id(run).get(aid.replace("evidence", "adversarial") if a["reviewer"] == "evidence" else aid.replace("adversarial", "evidence"))
        if pair and pair["status"] == "done" and pair["by"] == by:
            raise ValueError(f"{aid}: {by} already did the other verification of this slice")
        if not ok and not findings:
            raise ValueError(f"{aid}: a failed verification must say what is wrong")
        if not ok:
            if run["round"] >= lim["max_fix_rounds"]:
                a["status"] = "failed"
                run.update(state="failed", reason=f"findings survived {lim['max_fix_rounds']} fix rounds: {'; '.join(findings)[:300]}")
                return run
            a["status"] = "done"
            a["findings"] = list(findings)
            _send_back(run, a["slice"], findings)
            return run
    a["status"] = "done" if ok else "failed"
    if not ok:
        n = a["attempts"] = a.get("attempts", 0) + 1
        if n < lim["max_attempts"]:
            a["status"] = "pending"
        else:
            run.update(state="failed", reason=f"{aid} failed {n} times")
    if a["phase"] == "final_gate" and not ok:
        a["status"] = "done"
        a["findings"] = list(findings) or ["the full gate failed"]
        if run["round"] >= lim["max_fix_rounds"]:
            run.update(state="failed", reason="the final gate stayed red after the fix rounds")
        else:
            _send_back(run, None, a["findings"])
            for x in run["agents"]:
                if x["phase"] in ("integrate", "final_gate"):
                    x["status"], x["round"] = "pending", x["round"] + 1
    if run["state"] == "running" and all(x["status"] == "done" for x in run["agents"] if x["phase"] == "final_gate") and phase_done(run, "final_gate") \
            and not any(x["status"] in ("pending", "running") for x in run["agents"]):
        run["state"] = "done"
    return run


def _author_of(run, slice_) -> str | None:
    a = _by_id(run).get(f"impl:{slice_}") or _by_id(run).get(f"author:{slice_}")
    return a["by"] if a else None


def _send_back(run, slice_, findings) -> None:
    """Fix round: the slice's author works again with the findings, then both verifiers re-run it. Other slices keep their results."""
    run["round"] += 1
    aid = f"impl:{slice_}" if slice_ in run["slices"] else f"author:{slice_}"
    ids = _by_id(run)
    tgt = [ids[aid]] if aid in ids else [x for x in run["agents"] if x["phase"] == "implement"]
    rnd = run["round"] + 1
    for t in tgt:
        fx = _agent("fix", f"fix:{t['slice'] or t['what']} r{rnd - 1}", t["slice"], round=rnd - 1, findings=list(findings), what=t.get("what"))
        run["agents"].append(fx)
        for v in run["agents"]:
            if v["phase"] == "verify" and v["slice"] == t["slice"]:
                v["status"], v["findings"] = "pending", []
        for v in run["agents"]:
            if v["phase"] in ("integrate", "final_gate"):
                v["status"] = "pending"


def validate(run, root=ROOT) -> list[str]:
    """Independence and shape: every slice is audited, built and verified twice by different agents; fix rounds stay bounded."""
    c, lim, bad = cfg(root), cfg(root)["limits"], []
    ids = _by_id(run)
    if len(ids) != len(run["agents"]):
        bad.append("duplicate agent ids")
    for k in run["slices"]:
        for need in (f"audit:{k}", f"impl:{k}", f"verify-evidence:{k}", f"verify-adversarial:{k}"):
            if need not in ids:
                bad.append(f"slice {k} has no {need}")
        ev, ad = ids.get(f"verify-evidence:{k}"), ids.get(f"verify-adversarial:{k}")
        if ev and ad and ev["by"] and ev["by"] == ad["by"]:
            bad.append(f"slice {k}: both verifiers are {ev['by']}")
        au = ids.get(f"impl:{k}", {}).get("by")
        for v in (ev, ad):
            if v and v["by"] and au and v["by"] == au:
                bad.append(f"slice {k}: {au} verified its own work")
    for g in run["gaps"]:
        for need in (f"author:{g}", f"verify-evidence:{g}", f"verify-adversarial:{g}"):
            if need not in ids:
                bad.append(f"gap {g} has no {need}")
    for need in ("coverage", "integrate", "final_gate"):
        if need not in ids:
            bad.append(f"no {need} agent")
    if run.get("round", 0) > lim["max_fix_rounds"]:
        bad.append(f"{run['round']} fix rounds, limit {lim['max_fix_rounds']}")
    known = {p["id"] for p in c["phases"]}
    bad += [f"{a['id']}: unknown phase {a['phase']}" for a in run["agents"] if a["phase"] not in known]
    return bad


def progress(run, root=ROOT) -> list[tuple[str, int, int]]:
    out = []
    for p in cfg(root)["phases"]:
        ag = [a for a in run["agents"] if a["phase"] == p["id"]]
        out.append((p["id"], sum(a["status"] == "done" for a in ag), len(ag)))
    return out


def status(run, root=ROOT) -> str:
    lines = [f"{run['goal']}  [{run['state']}{': ' + run['reason'] if run['reason'] else ''}]  fix rounds {run['round']}"]
    lines += [f"  {p:<10} {d}/{n}" for p, d, n in progress(run, root)]
    return "\n".join(lines)


def check(root=ROOT) -> list[str]:
    """The contract is well formed, the Worker implements the phases it claims, and the rule is in the instruction files."""
    root, bad = Path(root), []
    try:
        c = cfg(root)
    except (OSError, ValueError) as e:
        return [f"{CONF}: {e}"]
    ids = [p["id"] for p in c["phases"]]
    if len(set(ids)) != len(ids):
        bad.append("duplicate phase ids")
    for i, p in enumerate(c["phases"]):
        for n in p["needs"]:
            if n not in ids[:i] and not (p["id"] == "new_specs" or n in ids):
                bad.append(f"{p['id']} needs {n}, which does not come before it")
            if n == p["id"] or (n in ids and ids.index(n) > i and p["id"] != "new_specs"):
                bad.append(f"{p['id']} needs {n}, which does not come before it")
        if p.get("independent") and sorted(p.get("reviewers", [])) != ["adversarial", "evidence"]:
            bad.append(f"{p['id']}: an independent phase has an evidence and an adversarial reviewer")
    for must in ("audit", "implement", "verify", "fix", "integrate", "final_gate"):
        if must not in ids:
            bad.append(f"phase {must} is missing")
    sp = c.get("server_phases", {})
    covered = {x for v in sp.values() for x in v}
    bad += [f"server phase maps to unknown {x}" for x in covered if x not in ids]
    bad += [f"{x} is not run by the Worker's orchestrator or marked client-side" for x in ids if x not in covered and x not in ("new_specs", "fix")]
    orch = root / "worker/src/orchestrate.js"
    try:
        src = orch.read_text(encoding="utf-8")
        bad += [f"worker/src/orchestrate.js does not name its phase {k}" for k in sp if f"'{k}'" not in src]
        if "PHASES" not in src or "adversarial" not in src:
            bad.append("worker/src/orchestrate.js lacks the PHASES map or the adversarial reviewer")
    except OSError:
        bad.append("worker/src/orchestrate.js is missing")
    for f in c.get("instruction_files", []):
        try:
            if "PHASED-WORK-1" not in (root / f).read_text(encoding="utf-8"):
                bad.append(f"{f} does not carry PHASED-WORK-1")
        except OSError:
            bad.append(f"{f} is missing")
    try:
        demo = new_run("check", ["a", "b"], ["g"], root)
        bad += validate(demo, root)
    except ValueError as e:
        bad.append(f"a run cannot be planned: {e}")
    return bad


def _load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def _save(p, run):
    Path(p).write_text(json.dumps(run, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def main(argv=None, root=ROOT) -> int:
    ap = argparse.ArgumentParser(prog="phasework", description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true")
    sub = ap.add_subparsers(dest="cmd")
    n = sub.add_parser("new"); n.add_argument("--goal", required=True); n.add_argument("--slices", required=True); n.add_argument("--gaps", default=""); n.add_argument("--out")
    x = sub.add_parser("next"); x.add_argument("run"); x.add_argument("--limit", type=int)
    d = sub.add_parser("done"); d.add_argument("run"); d.add_argument("agent"); d.add_argument("--by", required=True); d.add_argument("--tokens", type=int, default=0)
    g = d.add_mutually_exclusive_group(); g.add_argument("--ok", action="store_true"); g.add_argument("--finding", action="append")
    s = sub.add_parser("status"); s.add_argument("run")
    a = ap.parse_args(argv)
    if a.check:
        bad = check(root)
        print("phasework: ok" if not bad else "\n".join("phasework: " + b for b in bad))
        return 1 if bad else 0
    try:
        if a.cmd == "new":
            run = new_run(a.goal, a.slices.split(","), [x for x in a.gaps.split(",") if x], root)
            if a.out:
                _save(a.out, run)
            print(status(run, root))
        elif a.cmd == "next":
            for ag in ready(_load(a.run), root, a.limit):
                print(ag["id"])
        elif a.cmd == "done":
            run = _load(a.run)
            run = done(run, a.agent, a.by, ok=not a.finding, findings=a.finding or (), tokens=a.tokens, root=root)
            _save(a.run, run)
            print(status(run, root))
        elif a.cmd == "status":
            print(status(_load(a.run), root))
        else:
            ap.print_help()
            return 2
    except (ValueError, KeyError, OSError) as e:
        print(f"phasework: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
