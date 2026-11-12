"""BOUNDARY-1: creation and destruction inside a closed boundary (Rowan, 2026-11-12). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation boundary --check                    axiom in every instruction file, egress gated, permissions monotone, strange-loop ledger valid
  python3 -m foundation boundary --drill                    destroy a clean copy of HEAD and rebuild it from the repository; digests and checks must match
  python3 -m foundation boundary --decide SURFACE ACTION    allow or deny an inside action by the surface's trust rung (egress and reserved classes always deny)
  python3 -m foundation boundary --improve LOOP TEXT PROBE  record the improvement a closed loop makes to itself
  python3 -m foundation boundary --reap FILE.json           list sessions to archive (finished, or idle past the limit)
Data: doctrine/boundary.json.
"""
from __future__ import annotations
import hashlib, json, re, shutil, subprocess, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path
from . import trust

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/boundary.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def _kernel(root) -> dict:
    return json.loads((Path(root) / "doctrine/kernel.json").read_text(encoding="utf-8"))


def _files(root: Path, pats):
    return [p for g in pats for p in sorted(root.glob(g)) if p.is_file()]


def axiom_check(root, d) -> list[str]:
    bad = []
    for p in _files(root, d["instruction_files"]):
        t = p.read_text(encoding="utf-8")
        if p.name == "CLAUDE.md" and ("@agents/AGENTS.md" in t or "@AGENTS.md" in t):
            continue
        if d["marker"] not in t:
            bad.append(f"{p.relative_to(root).as_posix()}: lacks {d['marker']}")
    return bad


def probe_ok(root, spec: str) -> bool:
    root = Path(root)
    if spec.startswith("file:"):
        return (root / spec[5:]).is_file()
    if spec.startswith("grep:"):
        f, _, rx = spec[5:].partition("::")
        p = root / f
        return p.is_file() and re.search(rx, p.read_text(encoding="utf-8")) is not None
    return False


def policy_check(root, d) -> list[str]:
    bad, k = [], _kernel(root)
    ladder = k["trust"]["ladder"]
    for e in d["egress"]:
        if e.get("gate") not in ("interrupt", "confidentiality", "scope"):
            bad.append(f"egress {e['id']}: no gate")
        if not e.get("default") or not probe_ok(root, e.get("probe", "")):
            bad.append(f"egress {e['id']}: needs a default and a probe that passes")
    ins = d["permissions"]["inside"]
    for a, r in ins.items():
        if r not in ladder:
            bad.append(f"permission {a}: unknown rung {r}")
        if a in d["permissions"]["reserved"]:
            bad.append(f"permission {a}: reserved classes cannot be granted")
    order = ["read", "create", "edit", "destroy-derived", "rebuild", "destroy-instance", "self-modify"]
    ranks = [ladder.index(ins[a]) for a in order if a in ins and ins[a] in ladder]
    if ranks != sorted(ranks):
        bad.append("permissions are not monotone: destruction must need at least the trust that creation needs")
    if ins.get("destroy-instance") and ladder.index(ins["destroy-instance"]) < ladder.index(ins.get("create", "observed")):
        bad.append("destroy-instance below create")
    return bad


def improvements_check(root, d) -> list[str]:
    p = Path(root) / d["strange_loop"]["ledger"]
    if not p.is_file():
        return [f"{d['strange_loop']['ledger']}: missing"]
    led, bad = json.loads(p.read_text(encoding="utf-8")), []
    ids = {r["id"] for r in json.loads((Path(root) / "instances/ultrastable/loop-registry.json").read_text(encoding="utf-8"))["loops"]}
    for e in led["entries"]:
        if e["loop"] not in ids:
            bad.append(f"improvement for unknown loop {e['loop']}")
        if not probe_ok(root, e["probe"]):
            bad.append(f"improvement {e['loop']}: probe {e['probe']} does not pass (the next pass cannot use it)")
    return bad


def improve(loop: str, text: str, probe: str, root=REPO) -> dict:
    d = load(root)
    p = Path(root) / d["strange_loop"]["ledger"]
    led = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {"version": 1, "entries": []}
    e = {"loop": loop, "improvement": text, "probe": probe, "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")}
    led["entries"].append(e)
    p.write_text(json.dumps(led, indent=1) + "\n", encoding="utf-8")
    return e


def decide(surface: str, action: str, root=REPO, led: dict | None = None) -> dict:
    d, k = load(root), _kernel(root)
    if action in d["permissions"]["reserved"] or action in {e["id"] for e in d["egress"]}:
        return {"allow": False, "why": "egress or reserved: gated, trust never grants it"}
    need = d["permissions"]["inside"].get(action)
    if need is None:
        return {"allow": False, "why": f"unknown action {action}: not inside the boundary"}
    led = led or trust.load(root)
    rows = [r for key, r in led["rows"].items() if key.split("|")[0] == surface]
    have = max((k["trust"]["ladder"].index(r["rung"]) for r in rows), default=0)
    ok = have >= k["trust"]["ladder"].index(need)
    return {"allow": ok, "why": f"needs {need}; {surface} holds {k['trust']['ladder'][have]}"}


def digest(root: Path, paths) -> str:
    h = hashlib.sha256()
    for g in paths:
        for p in sorted((root / g).rglob("*")) if (root / g).is_dir() else [root / g]:
            if p.is_file() and "__pycache__" not in p.parts:
                h.update(p.relative_to(root).as_posix().encode() + p.read_bytes())
    return h.hexdigest()


def _export(root: Path, dest: Path):
    dest.mkdir(parents=True)
    ar = subprocess.run(["git", "-C", str(root), "archive", "HEAD"], capture_output=True, check=True).stdout
    subprocess.run(["tar", "-x", "-C", str(dest)], input=ar, check=True)


def drill(root=REPO) -> list[str]:
    """Destroy a copy of HEAD, rebuild it from the repository, and require identical digests and passing checks."""
    root, d, bad = Path(root), load(root), []
    tmp = Path(tempfile.mkdtemp(prefix="boundary-drill-"))
    try:
        a, b = tmp / "first", tmp / "rebuilt"
        _export(root, a)
        da = digest(a, d["rebuild"]["digest_paths"])
        shutil.rmtree(a)  # destruction
        _export(root, b)  # creation from the repository alone
        db = digest(b, d["rebuild"]["digest_paths"])
        if da != db:
            bad.append("rebuild digest differs from the original")
        for cmd in d["rebuild"]["drill_checks"]:
            r = subprocess.run(cmd, cwd=b, capture_output=True, text=True)
            if r.returncode:
                bad.append(f"{' '.join(cmd)} failed in the rebuilt copy: {(r.stdout + r.stderr).strip()[-200:]}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return bad


def reap(sessions: list[dict], d: dict, now: datetime | None = None) -> list[dict]:
    """Sessions to archive: finished, or idle beyond the limit. Each decision carries its reason."""
    now, r, out = now or datetime.now(timezone.utc), d["reaper"], []
    for s in sessions:
        if s.get("state") in r["finished_states"]:
            out.append({"id": s["id"], "reason": f"state {s['state']}"})
            continue
        last = datetime.fromisoformat(s["last_active"].replace("Z", "+00:00"))
        if (now - last).total_seconds() > r["idle_hours"] * 3600:
            out.append({"id": s["id"], "reason": f"idle over {r['idle_hours']}h"})
    return out


def check(root=REPO) -> list[str]:
    root, d = Path(root), load(root)
    return axiom_check(root, d) + policy_check(root, d) + improvements_check(root, d)


def main(argv) -> int:
    a = argv[0] if argv else "--check"
    if a == "--check":
        bad = check()
    elif a == "--drill":
        bad = drill()
    elif a == "--decide":
        r = decide(argv[1], argv[2]); print(json.dumps(r)); return 0 if r["allow"] else 1
    elif a == "--improve":
        print(json.dumps(improve(argv[1], argv[2], argv[3]))); return 0
    elif a == "--reap":
        print(json.dumps(reap(json.loads(Path(argv[1]).read_text()), load()))); return 0
    else:
        print(__doc__); return 2
    for b in bad:
        print("boundary:", b)
    print("boundary: ok" if not bad else f"boundary: {len(bad)} problem(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
