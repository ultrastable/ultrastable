# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SEED-LIFECYCLE-1 core: a seed is not done until it is built, deployed, live and able to run a year unattended. Ultrastable is the foundation for any autonomous system.

Rowan, 2026-11-21: "for any seed based on the ultrastable platform, the system actually has to build and deploy it and make it fully autonomous with a
design goal of being completely unsupervised and unattended for a minimum of 1 year." A plan is not a system. Every system carries this engine, so one
improvement reaches every seed; the platform imports it (foundation/seedlife.py) and judges every seed under instances/, and a seeded system runs
`python3 scripts/seedlife.py --check` on itself.

Stages are computed from evidence, never declared: seeded (IDEA.md and instance.json), planned (a system test and a lifecycle file), built (the code
paths and tests the lifecycle names exist), deployed (a deploy row for its worker whose live version matched the commit), live (a recorded verify
fetch that passed inside max_age_hours), autonomous (the deploy lane owns the worker, every loop is a clock, the progress monitor lists it, and every
one-year survival class is answered: closed by a probe, n/a with a reason, or an identity-bound gate with a default in effect; none open, and no
gate expires inside the target). A gate is the honest record of what cannot be unattended; it keeps the seed running on its default and is listed.

  python3 scripts/seedlife.py --check     lifecycle well formed, and nothing claims a stage the evidence does not reach
  python3 scripts/seedlife.py --status    the computed stage, the next step and the open survival classes
"""
from __future__ import annotations
import datetime as dt, json, re, shlex, sys
from pathlib import Path

STAGES = ("seeded", "planned", "built", "deployed", "live", "autonomous")
DONE_WORDS = ("done", "complete", "completed", "launched", "autonomous", "live", "shipped")
ANSWERS = ("closed", "n/a", "gate", "open")


def _load(p: Path, default=None):
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else default
    except ValueError:
        return default


def _rows(p: Path) -> list[dict]:
    out = []
    if p.is_file():
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                out.append(json.loads(line)) if line.strip() else None
            except ValueError:
                continue
    return out


def _iso(s: str):
    try:
        return dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def verify_rows(root: Path, cfg: dict, slug: str) -> list[dict]:
    """Readings live in a JSON store under a key per seed (verify_store, verify_key) or in one JSONL ledger per seed (verify_ledger)."""
    if cfg.get("verify_store"):
        return ((_load(root / cfg["verify_store"], {}) or {}).get(cfg.get("verify_key", "seed_verify")) or {}).get(slug) or []
    return _rows(root / cfg["verify_ledger"].format(slug=slug))


def record_verify(root: Path, cfg: dict, slug: str, row: dict, keep: int = 30) -> None:
    if cfg.get("verify_store"):
        p = root / cfg["verify_store"]
        d = _load(p, {}) or {}
        k = cfg.get("verify_key", "seed_verify")
        d.setdefault(k, {})
        d[k][slug] = (d[k].get(slug) or [])[-(keep - 1):] + [row]
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(d, indent=1) + "\n", encoding="utf-8")
        return
    p = root / cfg["verify_ledger"].format(slug=slug)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(row, separators=(",", ":")) + "\n")


def _remote_has(repo: str, path: str, _seen: dict = {}) -> bool:
    """TENANT-REPO-1: a tenant whose code lives in its own public repository names it as build.repo; its paths are read there."""
    key = (repo, path)
    if key not in _seen:
        import urllib.request
        req = urllib.request.Request(f"https://raw.githubusercontent.com/{repo}/main/{path}", method="HEAD", headers={"user-agent": "ultrastable-seedlife"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                _seen[key] = r.status == 200
        except Exception as e:  # logged, never hidden: an unreachable path counts as missing
            print(f"seedlife: {repo}/{path} unreadable: {e}", file=sys.stderr)
            _seen[key] = False
    return _seen[key]


def exists(root: Path, p: str, repo: str = "") -> bool:
    return _remote_has(repo, p) if repo else (root / p).exists()


def resolves(root: Path, probe, repo: str = "") -> bool:
    """file:PATH exists, or cmd:python3 -m foundation MOD ... / cmd:python3 scripts/X.py ... names a module that exists."""
    kind, _, arg = str(probe or "").partition(":")
    if kind == "file":
        return bool(arg) and (root / arg).exists()
    if kind == "cmd":
        a = shlex.split(arg)
        if a[:3] == ["python3", "-m", "foundation"] and len(a) > 3:
            return (root / "foundation" / (a[3] + ".py")).is_file()
        if a[:1] == ["python3"] and len(a) > 1 and a[1].endswith(".py"):
            return (root / a[1]).is_file()
        if a[:2] == ["node", "--test"] and len(a) > 2:
            return all(exists(root, x, repo) for x in a[2:])
    return False


def survival(lc: dict, cfg: dict, core: dict) -> dict:
    """Each class: {status, via}. inherit:<id> takes the core input's status (closed, gate or open); unanswered is open."""
    out = {}
    for cls in cfg["survival"]:
        a = (lc.get("survival") or {}).get(cls["id"])
        if not a:
            out[cls["id"]] = {"status": "open", "via": "unanswered", "expires": None}
        elif a.get("inherit"):
            c = core.get(a["inherit"])
            out[cls["id"]] = {"status": c["status"] if c else "open", "via": f"core:{a['inherit']}" + ("" if c else " (unknown)"),
                              "expires": (c or {}).get("expires"), "item": (c or {}).get("item")}
        else:
            out[cls["id"]] = {"status": a.get("status", "open"), "via": a.get("probe") or a.get("why") or a.get("item") or "",
                              "expires": a.get("expires"), "item": a.get("item")}
    return out


def evaluate(root, seed_dir, lc_path, cfg: dict, core: dict, now=None) -> dict:
    """The stage this seed's evidence reaches, what the next stage needs, and the honest limits (gates) it runs on."""
    root, seed_dir, now = Path(root), Path(seed_dir), now or dt.datetime.now(dt.timezone.utc)
    lc = _load(Path(lc_path), None)
    slug = (lc or {}).get("slug") or seed_dir.name
    stage, need = "seeded", []
    idea = (seed_dir / "IDEA.md").read_text(encoding="utf-8") if (seed_dir / "IDEA.md").is_file() else ""
    if not (idea and (seed_dir / "instance.json").is_file()):
        need.append("IDEA.md and instance.json")
        return {"slug": slug, "stage": None, "next": "seeded", "need": need, "survival": {}, "gates": [], "open": [], "horizon_days": None}
    if "# System test" not in idea:
        need.append("IDEA.md has a '# System test' section")
    if lc is None:
        need.append(f"{Path(lc_path).relative_to(root) if Path(lc_path).is_relative_to(root) else lc_path} exists")
    surv = survival(lc or {}, cfg, core)
    gates = sorted(k for k, v in surv.items() if v["status"] == "gate")
    opened = sorted(k for k, v in surv.items() if v["status"] == "open")
    expiring = []
    for k, v in surv.items():
        if v["status"] != "closed" and v.get("expires"):
            try:
                left = (dt.date.fromisoformat(v["expires"]) - now.date()).days
            except ValueError:
                left = 0
            if left < cfg["target_days"]:
                expiring.append((left, k))
    horizon = min([n for n, _ in expiring], default=None)
    res = {"slug": slug, "survival": surv, "gates": gates, "open": opened, "horizon_days": horizon, "target_days": cfg["target_days"]}

    def done(st, nxt):
        return {**res, "stage": st, "next": nxt, "need": need}

    if need:
        return done("seeded", "planned")
    stage = "planned"
    b = lc.get("build") or {}
    paths, tests = b.get("paths") or [], b.get("tests") or []
    miss = [p for p in paths + tests if not exists(root, p, b.get("repo", ""))]
    if not paths or not tests or miss:
        need.append("build: code paths and tests exist" + (f" (missing: {', '.join(miss)})" if miss else "" if paths and tests else " (none named)"))
        return done(stage, "built")
    stage = "built"
    d = lc.get("deploy") or {}
    worker = d.get("worker")
    deps = [r for r in _rows(root / d.get("evidence", "ops/deploys.jsonl")) if r.get("worker") == worker and r.get("uploaded") and r.get("live_matches_commit")]
    if not worker or not deps:
        need.append(f"deploy: a deploy row for worker {worker or '(none named)'} whose live version matched the commit")
        return done(stage, "deployed")
    stage = "deployed"
    v = lc.get("verify") or {}
    ok = [r for r in verify_rows(root, cfg, slug) if r.get("ok")]
    fresh = ok and (_iso(ok[-1].get("at")) or now) >= now - dt.timedelta(hours=cfg["verify_max_age_hours"])
    if not (v.get("url", "").startswith("https://") and v.get("expect")) or not fresh:
        need.append(f"live: a passing verify of {v.get('url') or '(no https url)'} expecting {v.get('expect')!r} inside {cfg['verify_max_age_hours']} h")
        return done(stage, "live")
    stage = "live"
    topo = {w.get("id"): w for w in (_load(root / cfg["topology"], {}) or {}).get("workers", [])}
    clocks = {c.get("id") for c in (_load(root / cfg["clocks"], {}) or {}).get("clocks", [])}
    prog = {s.get("id") for s in (_load(root / cfg["progress"], {}) or {}).get("systems", [])}
    loops = lc.get("loops") or []
    seeds = set(((_load(root / cfg["seed_deploys"], {}) or {}).get("seeds") or []) if cfg.get("seed_deploys") else [])  # SEED-DEPLOY-1: the lane deploys these after the platform workers
    if (topo.get(worker) or {}).get("state") != "live" and slug not in seeds:
        need.append(f"autonomous: {cfg['topology']} lists {worker} as live (or {cfg.get('seed_deploys') or 'the seed deploy list'} names {slug}), so the deploy lane redeploys it on every merge")
    if not loops or any(l not in clocks for l in loops):
        need.append(f"autonomous: every loop is a clock in {cfg['clocks']} (missing: {', '.join(l for l in loops if l not in clocks) or 'none named'})")
    if slug not in prog:
        need.append(f"autonomous: {cfg['progress']} lists {slug}, so its release cadence is judged")
    need += [f"autonomous: survival class {k} is open ({surv[k]['via']})" for k in opened]
    need += [f"autonomous: {k} lapses in {n} days, inside the {cfg['target_days']}-day target" for n, k in sorted(expiring)]
    return done(stage if need else "autonomous", "autonomous" if need else None)


def check_lifecycle(root, lc: dict, cfg: dict, core: dict, where: str) -> list[str]:
    root, bad = Path(root), []
    known = {c["id"] for c in cfg["survival"]}
    for k, a in (lc.get("survival") or {}).items():
        if k not in known:
            bad.append(f"{where}: unknown survival class {k}"); continue
        if a.get("inherit"):
            if a["inherit"] not in core:
                bad.append(f"{where}: {k} inherits {a['inherit']}, which is not a core input")
            continue
        s = a.get("status")
        if s not in ANSWERS:
            bad.append(f"{where}: {k} needs a status in {ANSWERS} or inherit"); continue
        if s == "closed" and not resolves(root, a.get("probe"), (lc.get("build") or {}).get("repo", "")):
            bad.append(f"{where}: {k} is closed but its probe `{a.get('probe')}` does not resolve")
        if s == "n/a" and len(str(a.get("why", ""))) < 12:
            bad.append(f"{where}: {k} is n/a and needs a reason")
        if s == "gate" and not (a.get("default") and re.fullmatch(r"https://\S+", str(a.get("connect", ""))) and a.get("why")):
            bad.append(f"{where}: {k} is a gate and needs why (identity-bound), a default in effect and one https connect link")
        if s == "open" and not a.get("item"):
            bad.append(f"{where}: {k} is open and needs a queue item")
    claim = lc.get("claim")
    if claim is not None and claim not in STAGES:
        bad.append(f"{where}: claim {claim!r} is not a stage")
    return bad


def false_claims(r: dict, lc: dict | None, manifest: dict | None, listed_in_progress: bool) -> list[str]:
    """A seed may not be reported further along than its evidence: the gate that keeps a plan from passing as a system."""
    have = STAGES.index(r["stage"]) if r.get("stage") in STAGES else -1
    bad = []
    claim = (lc or {}).get("claim")
    if claim in STAGES and STAGES.index(claim) > have:
        bad.append(f"{r['slug']}: lifecycle claims {claim} but the evidence reaches {r.get('stage')}")
    st = str((manifest or {}).get("status", "")).lower()
    if st in DONE_WORDS and r.get("stage") != "autonomous":
        bad.append(f"{r['slug']}: instance.json says status {st!r} but the seed is {r.get('stage')}; only an autonomous seed is done")
    if listed_in_progress and have < STAGES.index("deployed"):
        bad.append(f"{r['slug']}: the progress monitor lists it as a running system but nothing of it is deployed ({r.get('stage')})")
    return bad


def main(argv=None) -> int:
    """Self-check for a seeded system: the repository root is the seed, autonomy/seed-lifecycle.json the rules, autonomy/lifecycle.json its answers."""
    argv = sys.argv[1:] if argv is None else argv
    root = Path(__file__).resolve().parents[1]
    cfg = _load(root / "autonomy/seed-lifecycle.json")
    if not cfg:
        print("autonomy/seed-lifecycle.json missing"); return 1
    lc_path = root / "autonomy/lifecycle.json"
    r = evaluate(root, root, lc_path, cfg, {})
    lc = _load(lc_path, None)
    bad = (check_lifecycle(root, lc, cfg, {}, "autonomy/lifecycle.json") if lc else []) + false_claims(r, lc, _load(root / "instance.json", None), False)
    if "--status" in argv:
        print(json.dumps(r, indent=1)); return 0
    print("\n".join(bad) or f"seedlife ok: stage {r.get('stage')}, next {r.get('next')}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
