# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""PATHFINDER-1 (Rowan, 2026-11-21): find another path before asking. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation pathfinder --check              every owner ask carries an exhaustion proof (a gate, needs-you item or ask id)
  python3 -m foundation pathfinder --resolve ASK_ID     try every route of every surface class for the ask, record each attempt, stop at the first that works
  python3 -m foundation pathfinder --regress            for each integration whose probe fails, list the changes since it last worked (revert candidates)

Rule: multiple paths always exist and the information is usually already held. An owner ask is allowed only after attempts in every surface class
(doctrine/pathfinder.json) are recorded in ops/paths/attempts.jsonl, or the gate's surfaces carry a `class` tag per class. A previously working
integration that fails is diffed against its last good commit before anything is escalated. Tests: tests/foundation/test_pathfinder.py."""
from __future__ import annotations
import json, os, subprocess, sys, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CFG = "doctrine/pathfinder.json"
LEDGER = "ops/paths/attempts.jsonl"


def _cfg(root) -> dict:
    return json.loads((Path(root) / CFG).read_text(encoding="utf-8"))


def attempts(root=ROOT) -> list[dict]:
    p = Path(root) / LEDGER
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.is_file() else []


def record(root, ask: str, cls: str, route: str, ok: bool, detail: str, now=None) -> dict:
    row = {"at": (now or datetime.datetime.now(datetime.timezone.utc)).isoformat(timespec="seconds"), "ask": ask, "class": cls, "route": route, "ok": ok, "detail": detail}
    p = Path(root) / LEDGER
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row) + "\n")
    return row


def try_route(route: str, root=ROOT, env=None, fetch=None, git=None) -> tuple[bool, str]:
    """One route. env:A|B (a credential is bound), file:PATH, http:URL ~ TEXT (answers 200 and says TEXT), git:PATH (history exists)."""
    env = os.environ if env is None else env
    kind, _, arg = route.partition(":")
    if kind == "env":
        hit = [n for n in arg.split("|") if env.get(n)]
        return bool(hit), f"bound: {','.join(hit)}" if hit else "no such binding in this run"
    if kind == "file":
        return (Path(root) / arg).exists(), arg
    if kind == "http" and "~" in arg:
        from . import needsyou
        url, text = (s.strip() for s in arg.split("~", 1))
        return needsyou._http_says(url, text, fetch), url
    if kind == "git":
        out = (git or _git_log)(root, arg)
        return bool(out), f"{len(out)} commits" if out else "no history"
    return False, f"unknown route kind {kind}"


def _git_log(root, path, since=None) -> list[str]:
    cmd = ["git", "-C", str(root), "log", "--format=%h %s", "-n", "20"] + ([f"{since}..HEAD"] if since else []) + ["--", path]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        print(f"pathfinder: git log failed ({r.stderr.strip()[:120]})")  # never swallowed: a failed history read is an attempt that failed
        return []
    return [l for l in r.stdout.splitlines() if l]


def resolve(ask: str, root=ROOT, env=None, fetch=None, git=None, now=None) -> dict:
    """Walk every class's routes for the ask; record each attempt. Returns {resolved, via, proof} where proof is the classes attempted."""
    cfg = _cfg(root)
    routes = cfg["asks"].get(ask, {})
    done, via = set(), None
    for cls in cfg["surface_classes"]:
        for r in routes.get(cls, []):
            ok, detail = try_route(r, root, env, fetch, git)
            record(root, ask, cls, r, ok, detail, now)
            done.add(cls)
            if ok and via is None:
                via = {"class": cls, "route": r}
    missing = [c for c in cfg["surface_classes"] if c not in done]
    return {"resolved": via is not None, "via": via, "classes_attempted": sorted(done), "classes_missing": missing}


def regress(root=ROOT, run=None, git=None, now=None) -> list[dict]:
    """REGRESSION-FIRST: for each integration whose probe fails, the suspects are the commits to its files since `last_good`; the first remedy is
    reverting or diffing them. Every finding is a recorded attempt (class prior-working-config)."""
    cfg, out = _cfg(root), []
    for i in cfg["integrations"]:
        ok, detail = try_route(i["probe"], root, env=(run or os.environ))
        if ok:
            continue
        sus = []
        for f in i["files"]:
            sus += (git or _git_log)(root, f, i.get("last_good"))
        out.append({"integration": i["id"], "probe": i["probe"], "suspects": sus, "action": "diff and revert the suspects first; escalate only after this attempt is recorded"})
        record(root, i["id"], "prior-working-config", f"regress:{','.join(i['files'])}", bool(sus), f"{len(sus)} suspect commits since {i.get('last_good','start')}", now)
    return out


def exhausted(ask_id: str, cfg: dict, rows: list[dict], surfaces=()) -> list[str]:
    """Surface classes still without an attempt for this ask (ledger rows plus class-tagged gate surfaces; `na` entries count with a reason)."""
    have = {r["class"] for r in rows if r["ask"] == ask_id}
    have |= {s["class"] for s in surfaces if s.get("class") and (s.get("result") or s.get("na"))}
    return [c for c in cfg["surface_classes"] if c not in have]


def check(root=ROOT) -> list[str]:
    root = Path(root)
    cfg, rows, bad = _cfg(root), attempts(root), []
    grand = set(cfg["grandfathered_gates"])
    gates = json.loads((root / "doctrine/open-loops.json").read_text(encoding="utf-8"))["gates"]
    ids = {g["id"] for g in gates}
    for g in gates:
        miss = exhausted(g["id"], cfg, rows, g.get("surfaces", []))
        if g["id"] in grand:
            if not miss:
                bad.append(f"gate {g['id']}: now exhausted, remove it from grandfathered_gates (shrink-only)")
        elif miss and not g.get("closed"):
            bad.append(f"gate {g['id']}: owner ask without exhaustion proof, no attempt in {', '.join(miss)}")
    bad += [f"grandfathered gate {g} no longer exists, remove it" for g in grand - ids]
    ny = root / "foundation/data/needs-you.json"
    for i in json.loads(ny.read_text(encoding="utf-8")).get("items", []):
        miss = exhausted(i["id"], cfg, rows)
        if miss:
            bad.append(f"needs-you {i['id']}: owner ask without exhaustion proof, no attempt in {', '.join(miss)}")
    return bad


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if a[:1] == ["--resolve"] and len(a) > 1:
        r = resolve(a[1])
        print(json.dumps(r))
        return 0 if r["resolved"] or not r["classes_missing"] else 1
    if a[:1] == ["--regress"]:
        r = regress()
        print(json.dumps(r, indent=1) if r else "pathfinder: no integration regressed")
        return 0
    bad = check()
    print("\n".join(bad) or "pathfinder ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
