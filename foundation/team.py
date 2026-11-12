"""TEAM-1: the virtual team as code. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation team --gate                    which phase is active now (each phase opens only when its gate probes pass)
  python3 -m foundation team --check                   catalog valid; every active role fully wired; every future role has a filed item
  python3 -m foundation team --apply                   activate every role of every open phase (role files, seed roles, loop registry) and file items for the rest
  python3 -m foundation team --recommend --manifest F  which roles an instance should run, by phase

The test for each role: if this were a real startup, who would be hired? The catalog is doctrine/team.json. A role goes live
only when its phase gate passes, so the team grows as the code loop proves itself. Future roles are not prose: each is an
OL-ROLE-* item in docs/issues with owner, trigger (its gate) and a closing probe (its role file), worked by the queue lane.
"""
from __future__ import annotations
import copy, json, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CATALOG = "doctrine/team.json"
TREES = ("agents/roles", "seed/agents/roles")
REQUIRED = ("title", "program", "owns", "tick_every", "metric", "steps", "never", "owner_only")


def load(root=REPO) -> dict:
    return json.loads((Path(root) / CATALOG).read_text(encoding="utf-8"))


def _probe(root, spec: str) -> tuple[bool, str]:
    kind, _, rest = spec.partition(":")
    if kind == "file":
        return (Path(root) / rest).is_file(), spec
    if kind == "cmd":
        argv = [sys.executable if a == "python3" else a for a in rest.split()]
        try:
            r = subprocess.run(argv, cwd=root, capture_output=True, text=True, timeout=180)
        except (OSError, subprocess.TimeoutExpired) as e:
            return False, f"{spec}: {type(e).__name__}: {e}"
        return r.returncode == 0, f"{spec}: exit {r.returncode}"
    return False, f"unknown probe kind {kind!r}"


def gate(root=REPO, cat=None, run=_probe) -> dict:
    """Phases open in order; a phase opens only when every probe of its gate passes. Returns the active phase and the evidence."""
    cat, current, ev = cat or load(root), -1, []
    for ph in cat["phases"]:
        res = [run(root, p) for p in ph["gate"]]
        ev.append({"phase": ph["n"], "open": all(ok for ok, _ in res), "probes": [d for _, d in res]})
        if not all(ok for ok, _ in res):
            break
        current = ph["n"]
    return {"current": current, "evidence": ev}


def _split(text: str) -> tuple[str, str]:
    head, _, rest = text.partition("**Owns:**")
    return head, "## Measure" + rest.partition("## Measure")[2]


def render(root, tree: str, rid: str, role: dict) -> str:
    head, foot = _split((Path(root) / tree / "product-manager.md").read_text(encoding="utf-8"))
    head = head.replace("# Role: product manager", f"# Role: {role['title']}")
    body = [f"**Owns:** {role['owns']}", f"**Tick:** every {role['tick_every']} base ticks.", f"**Metric:** `{role['metric']}` (program: {role['program']}). Predict before you act; the data analyst scores it.", "",
            "## Each tick"] + [f"{i}. {s}" for i, s in enumerate(role["steps"], 1)] + ["", "## Never"] + [f"- {n}" for n in role["never"]]
    if role["owner_only"] != "none":
        body += ["", "## Owner-only", f"- {role['owner_only']} This is one card with a default in effect and a closing probe, never prose."]
    return head + "\n".join(body) + "\n\n" + foot


def _loop(reg: dict, rid: str, role: dict) -> dict:
    base = copy.deepcopy(next(l for l in reg["loops"] if l["id"] == "role-project-manager"))
    base.pop("program", None); base.pop("launch", None)
    base.update({"id": f"role-{rid}", "summary": f"{role['title'].capitalize()}: {role['owns'].split(':')[0].split('.')[0]}"[:160],
                 "trigger": f"each tick of the {rid} role (tick_every {role['tick_every']})", "owner": rid, "closing_probe": f"file:agents/roles/{rid}.md",
                 "system_path": [f"agents/roles/{rid}.md", f"seed/agents/roles/{rid}.md", "doctrine/team.json", "foundation/team.py"]})
    return base


def _dump(path: Path, data, indent):
    path.write_text(json.dumps(data, indent=indent, ensure_ascii=False) + "\n", encoding="utf-8")


def item(rid: str, phase: int, role: dict) -> dict:
    body = (f"**Owner:** portfolio-manager\n**Trigger:** phase {phase} gate passes (python3 -m foundation team --gate)\n**Done check:** file:agents/roles/{rid}.md\n**Status:** open\n\n"
            f"Activate the {role['title']} role: python3 -m foundation team --apply writes the role files, the seed role and the loop entry once the gate is open. Metric: {role['metric']}.")
    return {"id": f"OL-ROLE-{rid}", "title": f"OL-ROLE-{rid}: activate the {role['title']} role (phase {phase})", "body": body,
            "labels": ["role:portfolio-manager", "open-loop", "team", f"phase:{phase}"], "milestone": "Next" if phase == 1 else "Later", "workstream": "Virtual team"}


def apply(root=REPO, g=None) -> dict:
    root, cat = Path(root), load(root)
    g = g or gate(root, cat)
    seed_p, reg_p = root / "seed/ultrastable.json", root / "instances/ultrastable/loop-registry.json"
    seed, reg = json.loads(seed_p.read_text(encoding="utf-8")), json.loads(reg_p.read_text(encoding="utf-8"))
    have_roles, have_loops = {r["id"] for r in seed["roles"]}, {l["id"] for l in reg["loops"]}
    done, filed = [], []
    for ph in cat["phases"]:
        for rid in ph["roles"]:
            role = cat["roles"].get(rid)
            if ph.get("existing") or role is None:
                continue
            if ph["n"] <= g["current"]:
                for tree in TREES:
                    (root / tree / f"{rid}.md").write_text(render(root, tree, rid, role), encoding="utf-8")
                if rid not in have_roles:
                    seed["roles"].append({"id": rid, "count": 1, "instructions": f"agents/roles/{rid}.md", "tick_every": role["tick_every"]})
                if f"role-{rid}" not in have_loops:
                    reg["loops"].append(_loop(reg, rid, role))
                (root / "docs/issues" / f"OL-ROLE-{rid}.json").unlink(missing_ok=True)
                done.append(rid)
            else:
                p = root / "docs/issues" / f"OL-ROLE-{rid}.json"
                _dump(p, item(rid, ph["n"], role), 2); filed.append(rid)
    _dump(seed_p, seed, 2); _dump(reg_p, reg, 1)
    from . import triggers
    triggers.sync(root)  # every new role gets its wake route in the same change
    return {"activated": done, "filed": filed, "phase": g["current"]}


def check(root=REPO, g=None) -> list[str]:
    root, bad = Path(root), []
    cat = load(root)
    g = g or gate(root, cat)
    seen = set()
    for ph in cat["phases"]:
        for rid in ph["roles"]:
            if rid in seen:
                bad.append(f"{rid}: listed in two phases")
            seen.add(rid)
            role = cat["roles"].get(rid)
            if ph.get("existing"):
                if not (root / "agents/roles" / f"{rid}.md").is_file():
                    bad.append(f"{rid}: phase 0 role has no role file")
                continue
            if role is None:
                bad.append(f"{rid}: in phase {ph['n']} but not defined in roles")
                continue
            for f in REQUIRED:
                if not role.get(f):
                    bad.append(f"{rid}: lacks {f}")
            if ph["n"] <= g["current"]:
                for tree in TREES:
                    if not (root / tree / f"{rid}.md").is_file():
                        bad.append(f"{rid}: phase {ph['n']} is open but {tree}/{rid}.md is missing (run team --apply)")
                if rid not in {r["id"] for r in json.loads((root / "seed/ultrastable.json").read_text(encoding="utf-8"))["roles"]}:
                    bad.append(f"{rid}: active but not a role in seed/ultrastable.json")
            elif not (root / "docs/issues" / f"OL-ROLE-{rid}.json").is_file():
                bad.append(f"{rid}: future role has no filed item (run team --apply)")
    for rid in set(cat["roles"]) - seen:
        bad.append(f"{rid}: defined but in no phase")
    return bad


def recommend(manifest: dict, root=REPO) -> dict:
    """Roles an instance needs, by phase. Derived from its resolved manifest; a role outside the catalog is never invented here."""
    cat = load(root)
    core = list(cat["phases"][0]["roles"])
    if not manifest["funding"]["routes"]:
        core = [r for r in core if r not in {"funding-manager", "outreach-manager", "outreach-coordinator"}]
    p1 = ["org-designer", "customer-success"]
    if manifest["ip"]["has_invention"]:
        p1.append("legal-ip-manager")
    if manifest.get("research") or manifest["kind"] in ("research", "business"):
        p1.append("research-publisher")
    if manifest["disclosure"]["public_allowed"] or manifest["kind"] == "business":
        p1.append("marketing-manager")
    p2 = ["data-analyst", "security-compliance"]
    if manifest["kind"] == "business":
        p2 += ["business-manager", "sales-partnerships", "finance-controller"]
    if manifest["disclosure"]["public_allowed"]:
        p2.append("community-manager")
    return {"phase_0": core, "phase_1": p1, "phase_2": p2}


def main(argv) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="foundation team")
    ap.add_argument("--gate", action="store_true"); ap.add_argument("--check", action="store_true"); ap.add_argument("--apply", action="store_true")
    ap.add_argument("--recommend", action="store_true"); ap.add_argument("--manifest")
    a = ap.parse_args(argv)
    if a.recommend:
        from . import manifest as mf
        print(json.dumps(recommend(mf.resolve(json.loads(Path(a.manifest).read_text(encoding="utf-8")))), indent=1)); return 0
    if a.gate:
        g = gate(); print(json.dumps(g, indent=1)); return 0
    if a.apply:
        r = apply(); print(json.dumps(r, indent=1)); return 0
    bad = check()
    print("team ok" if not bad else "\n".join(bad))
    return 1 if bad else 0
