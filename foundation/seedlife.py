# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SEED-LIFECYCLE-1 (Rowan, 2026-11-21): every seed is built, deployed, verified live and runs a year unattended; a plan is not a system.
Ultrastable is the foundation for any autonomous system.

  python3 -m foundation seedlife --check            every lifecycle is well formed and no seed is reported further along than its evidence
  python3 -m foundation seedlife --status [SLUG]    computed stage, next stage, what it needs, the gates it runs on, the open survival classes
  python3 -m foundation seedlife --verify [--apply] fetch each seed's verify URL and append the reading to ops/runway.json (key seed_verify, carried over by the runway loop)
  python3 -m foundation seedlife --run [--apply] [--no-verify]  verify, scaffold a missing lifecycle.json, and file or refresh one Q-SEED-<slug> item per seed
                                                    that is not autonomous (closing probe: --probe SLUG); runs on every watchdog pass
  python3 -m foundation seedlife --probe SLUG       exit 0 only when the seed is autonomous

The engine is seed/scripts/seedlife.py (every system carries the same copy). Rules: doctrine/seed-lifecycle.json. Answers: instances/<slug>/lifecycle.json.
Survival classes that inherit a core input (doctrine/unattended.json) take its status, so a core gap such as offsite backups holds every seed below
autonomous until the core closes it: the seed is never reported as more unattended than the platform under it.
"""
from __future__ import annotations
import datetime as dt, importlib.util as _ilu, json, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
RULES = "doctrine/seed-lifecycle.json"
_spec = _ilu.spec_from_file_location("seedlife_core", REPO / "seed/scripts/seedlife.py")
core_engine = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(core_engine)
STAGES = core_engine.STAGES


def cfg(root=REPO) -> dict:
    return json.loads((Path(root) / RULES).read_text(encoding="utf-8"))


def core_inputs(root=REPO) -> dict:
    p = Path(root) / cfg(root)["core_inputs"]
    d = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {"dependencies": []}
    return {x["id"]: x for x in d.get("dependencies", [])}


def seeds(root=REPO) -> list[str]:
    """Every instances/<slug> with an IDEA.md or an instance.json, except the declared non-seeds and fixtures (each with its reason)."""
    root, c = Path(root), cfg(root)
    skip = set(c.get("not_seeds", {})) | set(c.get("fixtures", {}))
    return sorted(d.name for d in (root / "instances").iterdir()
                  if d.is_dir() and d.name not in skip and ((d / "IDEA.md").is_file() or (d / "instance.json").is_file()))


def lc_path(root, slug) -> Path:
    return Path(root) / "instances" / slug / "lifecycle.json"


def _load(p: Path):
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else None


def status(root=REPO, slug=None, now=None) -> list[dict]:
    root, c, core = Path(root), cfg(root), core_inputs(root)
    return [core_engine.evaluate(root, root / "instances" / s, lc_path(root, s), c, core, now) for s in ([slug] if slug else seeds(root))]


def _progress_ids(root, c) -> set:
    p = Path(root) / c["progress"]
    return {s.get("id") for s in (_load(p) or {}).get("systems", [])}


def check(root=REPO, now=None) -> list[str]:
    root, c, core, bad = Path(root), cfg(root), core_inputs(root), []
    if c.get("target_days", 0) < 365:
        bad.append(f"{RULES}: target_days is below the owner's minimum of 365")
    ids = [x["id"] for x in c["survival"]]
    bad += [f"{RULES}: survival class {i} listed twice" for i in sorted(set(ids)) if ids.count(i) > 1]
    bad += [f"{RULES}: {x['id']} inherits {x['default_inherit']}, which is not in {c['core_inputs']}" for x in c["survival"]
            if x.get("default_inherit") and x["default_inherit"] not in core]
    for k, why in {**c.get("not_seeds", {}), **c.get("fixtures", {})}.items():
        if len(why) < 20 or not (root / "instances" / k).is_dir():
            bad.append(f"{RULES}: exclusion {k} needs an existing directory and a reason")
    prog = _progress_ids(root, c)
    for s in seeds(root):
        lc, where = _load(lc_path(root, s)), f"instances/{s}/lifecycle.json"
        if lc:
            bad += core_engine.check_lifecycle(root, lc, c, core, where)
        r = core_engine.evaluate(root, root / "instances" / s, lc_path(root, s), c, core, now)
        bad += core_engine.false_claims(r, lc, _load(root / "instances" / s / "instance.json"), s in prog)
        it = _load(root / "docs/issues" / f"Q-SEED-{s}.json")
        if it and "**Status:** open" not in it.get("body", "") and r.get("stage") != "autonomous" and "**Status:** gate" not in it.get("body", "") \
                and "**Disposition:**" not in it.get("body", ""):  # DISPOSE-1 (SLA-8H-1) gives every item older than 6 h a recorded disposition; that is a final record, not a false closure
            bad.append(f"Q-SEED-{s}: closed while the seed is {r.get('stage')}; it closes only when --probe {s} passes")
    return bad


def scaffold(root, slug) -> dict:
    """A starter lifecycle a seed is filed with: every class inherits the core answer it shares, the rest are open on the seed's item."""
    c = cfg(root)
    surv = {}
    for x in c["survival"]:
        if x.get("default_inherit"):
            surv[x["id"]] = {"inherit": x["default_inherit"]}
        elif x["id"] == "health":
            surv[x["id"]] = {"status": "closed", "probe": "cmd:python3 -m foundation seedlife --verify",
                             "how": "the watchdog fetches the verify URL every pass; a failing reading reopens Q-SEED and the handoff closer rolls back"}
        else:
            surv[x["id"]] = {"status": "open", "item": f"Q-SEED-{slug}"}
    return {"_doc": f"SEED-LIFECYCLE-1 answers for {slug}; scaffolded by foundation/seedlife.py, completed by the executor through Q-SEED-{slug}.",
            "slug": slug, "build": {"paths": [], "tests": []}, "deploy": {"worker": ""}, "verify": {"url": "", "expect": ""}, "loops": [],
            "survival": surv}


def item(r: dict) -> dict:
    s = r["slug"]
    need = "\n".join(f"- {n}" for n in r.get("need", [])) or "- nothing"
    gates = ", ".join(r.get("gates", [])) or "none"
    return {"id": f"Q-SEED-{s}",
            "title": f"Q-SEED-{s}: seed {s} is {r.get('stage') or 'not a seed yet'}; take it to {r.get('next') or 'autonomous'} (SEED-LIFECYCLE-1)",
            "body": f"**Owner:** executor\n**Trigger:** every watchdog pass (seedlife --run)\n**Done check:** cmd:python3 -m foundation seedlife --probe {s}\n"
                    f"**Status:** open\n\nSEED-LIFECYCLE-1 (Rowan, 2026-11-21): a seed is built, deployed, verified live and wired into its loops, with a "
                    f"design goal of {r.get('target_days', 365)} days unattended. A plan is not a system.\n\nStage: {r.get('stage')}. Next: {r.get('next')}.\n\n"
                    f"What the next stages need, computed from evidence:\n{need}\n\nGates it runs on (identity-bound, default in effect): {gates}.\n\n"
                    f"Answers live in instances/{s}/lifecycle.json; build the code under the paths it names, deploy through the lane "
                    "(doctrine/topology.json), and close each open survival class with a probe. Never edit the claim or this item to pass.\n\nsize: L\n\n"
                    f"**Closing probe:** `python3 -m foundation seedlife --probe {s}` exits 0.\n",
            "labels": ["p1", "agent-ready", "unattended", "seed"], "milestone": "Now", "workstream": "Seeds"}


def verify(root=REPO, apply=False, fetch=None, now=None) -> list[dict]:
    root, c, out = Path(root), cfg(root), []
    now = now or dt.datetime.now(dt.timezone.utc)

    def _get(url):
        req = urllib.request.Request(url, headers={"User-Agent": "ultrastable-seedlife"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read(65536).decode("utf-8", "replace")
    fetch = fetch or _get
    for s in seeds(root):
        v = (_load(lc_path(root, s)) or {}).get("verify") or {}
        if not str(v.get("url", "")).startswith("https://"):
            continue
        try:
            code, body = fetch(v["url"])
            row = {"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "url": v["url"], "status": code, "ok": code == 200 and v.get("expect", "") in body}
        except Exception as e:  # a failed fetch is a reading, recorded, never swallowed
            row = {"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "url": v["url"], "status": None, "ok": False, "error": str(e)[:200]}
        out.append({"slug": s, **row})
        if apply:
            core_engine.record_verify(root, c, s, row)
    return out


def run(root=REPO, apply=False, fetch=None, now=None, live=True) -> dict:
    root = Path(root)
    readings = verify(root, apply, fetch, now) if live else []
    changed = bool(readings) and apply
    for s in seeds(root):
        if apply and not lc_path(root, s).is_file():
            lc_path(root, s).write_text(json.dumps(scaffold(root, s), indent=1) + "\n", encoding="utf-8"); changed = True
    rs = status(root, now=now)
    for r in rs:
        p = root / "docs/issues" / f"Q-SEED-{r['slug']}.json"
        if r.get("stage") == "autonomous":
            if apply and p.is_file() and "**Status:** open" in p.read_text(encoding="utf-8"):
                it = json.loads(p.read_text(encoding="utf-8"))
                it["body"] = it["body"].replace("**Status:** open", "**Status:** closed") + (f"\nClosed by seedlife --run: the seed is autonomous ({now or dt.datetime.now(dt.timezone.utc):%Y-%m-%d}).\n"
                              f"**Evidence:** `python3 -m foundation seedlife --probe {r['slug']}` passed in the same run (stage autonomous).\n")  # queue --check: a closed item carries evidence
                p.write_text(json.dumps(it, indent=2) + "\n", encoding="utf-8"); changed = True
            continue
        new = json.dumps(item(r), indent=2) + "\n"
        if apply and (not p.is_file() or p.read_text(encoding="utf-8") != new):
            p.parent.mkdir(parents=True, exist_ok=True); p.write_text(new, encoding="utf-8"); changed = True
    return {"seeds": [{k: r.get(k) for k in ("slug", "stage", "next", "gates", "open", "horizon_days")} for r in rs], "verify": readings, "changed": changed}


def probe(slug, root=REPO, now=None) -> int:
    r = status(root, slug, now)[0]
    print(f"{slug}: {r.get('stage')}" + ("" if r.get("stage") == "autonomous" else f"; next {r.get('next')}: " + "; ".join(r.get("need", [])[:3])))
    return 0 if r.get("stage") == "autonomous" else 1


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if "--probe" in argv:
        return probe(argv[argv.index("--probe") + 1])
    if "--status" in argv:
        i = argv.index("--status")
        slug = argv[i + 1] if len(argv) > i + 1 and not argv[i + 1].startswith("--") else None
        print(json.dumps(status(REPO, slug), indent=1)); return 0
    if "--verify" in argv:
        print(json.dumps(verify(REPO, "--apply" in argv), indent=1)); return 0
    if "--run" in argv:
        r = run(REPO, "--apply" in argv, live="--no-verify" not in argv)
        if "--changed-file" in argv and r["changed"]:
            Path(argv[argv.index("--changed-file") + 1]).write_text("1", encoding="utf-8")
        print(json.dumps(r, indent=1)); return 0
    bad = check()
    print("\n".join(bad) or "seedlife ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
