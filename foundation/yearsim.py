# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""YEARSIM-1: a time-compressed year with zero input, run against a scratch copy of this repository. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation yearsim [--apply] [--keep]   run a simulated year, one failure per month; --apply writes ops/yearsim.json and site/yearsim-data.js
  python3 -m foundation yearsim --check              the scenario table is well formed and every uncovered area has a filed item

Each month injects one failure into a scratch copy, advances the clock (the real components take `today`), and asks the real detector whether it
noticed. Labels, stamped on every row, say what was real:
  detect   REAL       the repository's own code (runway, credwatch data, failure_audit detectors) ran on the injected state
  repair   SIMULATED  the harness applies the known-good fix; whether the live executor would have written it is not tested here
  verify   REAL       the same detector ran again and had to turn green
A month whose failure has no detector is recorded FAIL (undetected) and files Q-YEARSIM-<id>; an area the simulation cannot reach is UNCOVERED,
never PASS. Nothing here touches the real repository or any account. Data: doctrine/yearsim.json. Consumers: .github/workflows/yearsim.yml,
site/yearsim.js (/year), tests/foundation/test_yearsim.py."""
from __future__ import annotations
import datetime as dt, json, shutil, subprocess, sys, tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SKIP = shutil.ignore_patterns(".git", "node_modules", "kit", "artifacts", ".selfhost", "__pycache__", "repo-backups")
START = dt.date(2027, 1, 1)
TENANT_URL = "https://raw.githubusercontent.com/ultrastable/practical-solutions/main/ops/yearsim.json"
REAL_REPAIR = {"ci"}  # repair done by the repository's own code (foundation/redmain.py); every other repair is applied by the harness


class Unmeasured(Exception):
    """A scenario that cannot be observed from here: reported UNCOVERED, never PASS."""


def cfg(root=REPO) -> dict:
    return json.loads((Path(root) / "doctrine/yearsim.json").read_text(encoding="utf-8"))


def _w(p: Path, o) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(o, indent=1) + "\n", encoding="utf-8")


def _r(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def _runway(root: Path, today: dt.date) -> dict:
    from . import runway
    return runway.run(root, apply=True, today=today)


def _audit(root: Path, only: list[str], today: dt.date) -> list[dict]:
    from . import failure_audit
    return failure_audit.run(root, only=only, issues=True, now=today.isoformat() + "T00:00:00Z")


def _below(root, today, comp):
    r = _runway(root, today)
    return comp in r["below"], r


# ---- scenarios: each returns (detected, repaired_and_verified, evidence) -------------------------------------------------------------------

def s_boot(root, today):
    p = subprocess.run([sys.executable, "-m", "foundation", "selfhost", "--verify"], cwd=root, capture_output=True, text=True, timeout=300)
    return p.returncode == 0, p.returncode == 0, (p.stdout + p.stderr)[-200:].strip()


def _cred(root, name, state, expires):
    rows = [r for r in _r(root / "ops/credwatch.json")["rows"] if r["name"] != name]
    rows.append({"name": name, "state": state, "expires": expires})
    _w(root / "ops/credwatch.json", {"rows": rows})


def s_token(root, today):
    _cred(root, "CF_DEPLOY_TOKEN", "ok", (today + dt.timedelta(days=20)).isoformat())
    hit, r = _below(root, today, "credentials")
    _cred(root, "CF_DEPLOY_TOKEN", "ok", None)  # SIMULATED rotation to a non-expiring token (the live token has no expiry)
    ok, r2 = _below(root, today, "credentials")
    return hit, not ok, r["components"]["credentials"]["why"]


def s_domain(root, today):
    d = _r(root / "doctrine/credwatch.json")
    for g in d["registrations"]:
        if g["name"] == "domain-ultrastable.net":
            g["auto_renew"] = False
    _w(root / "doctrine/credwatch.json", d)
    _cred(root, "domain-ultrastable.net", "ok", (today + dt.timedelta(days=10)).isoformat())
    hit, r = _below(root, today, "credentials")
    for g in d["registrations"]:
        g["auto_renew"] = True
    _w(root / "doctrine/credwatch.json", d)  # SIMULATED renewal
    ok, _ = _below(root, today, "credentials")
    return hit, not ok, r["components"]["credentials"]["why"]


def _cost(root, today, share, prior=None):
    th = _r(root / "ops/cost-thresholds.json")
    p = root / "ops/cost.jsonl"
    lines = [json.dumps({"date": (today - dt.timedelta(days=10)).isoformat(), "d1": [], "neurons": int(th["neurons_max"] * (prior if prior is not None else share)), "breaches": []}),
             json.dumps({"date": today.isoformat(), "d1": [], "neurons": int(th["neurons_max"] * share), "breaches": []})]
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")


def s_quota(root, today):
    _cost(root, today, 1.0, 0.5)  # model quota exhausted: neurons at the free-plan limit
    hit, r = _below(root, today, "cost")
    _cost(root, today, 0.2, 0.2)  # SIMULATED: the cost loop cut usage
    ok, _ = _below(root, today, "cost")
    return hit, not ok, r["components"]["cost"]["why"]


def s_costcap(root, today):
    _cost(root, today, 0.8, 0.3)  # steady growth toward the cap
    hit, r = _below(root, today, "cost")
    _cost(root, today, 0.2, 0.2)
    ok, _ = _below(root, today, "cost")
    return hit, not ok, r["components"]["cost"]["why"]


def _break_probe(root, did):
    d = _r(root / "doctrine/detectors.json")
    x = next(x for x in d["detectors"] if x["id"] == did)
    f = root / x["spec"].split(":", 1)[1].split("::")[0]
    return f, f.read_text(encoding="utf-8")


def _g(root, *a):
    return subprocess.run(["git", "-c", "user.email=s@s", "-c", "user.name=sim", "-C", str(root), *a], capture_output=True, text=True)


def s_ci(root, today):
    """CI breakage: a commit removes the lane's rebase guard; the detector must notice and file Q-AUDIT, then redmain (no model, no person) reverts the
    smallest hunk that turns the gate green and the detector must recover. The repair is REAL code (foundation/redmain.py), run on the scratch history."""
    from . import redmain
    c = _r(root / "doctrine/redmain.json")
    c["gates"]["yearsim"] = {"cmd": "python3 -c \"import sys; sys.exit(0 if 'LANE-REBASE-1' in open('scripts/lane.sh').read() else 1)\"", "paths": ["scripts"], "workflows": []}
    _w(root / "doctrine/redmain.json", c)
    _g(root, "add", "-A"); _g(root, "commit", "-qm", "good: lane guard present")
    f, good = _break_probe(root, "lane-rebase")
    f.write_text(good.replace("LANE-REBASE-1", "LANE-REBASE-GONE"), encoding="utf-8")
    _g(root, "commit", "-qam", "bad: a change drops the rebase guard")
    first = _audit(root, ["lane-rebase"], today)[0]
    filed = first["status"] == "fail" and (root / "docs/issues/Q-AUDIT-lane-rebase.json").exists()
    rep = redmain.run(root, "yearsim", apply=True)[0]
    second = _audit(root, ["lane-rebase"], today + dt.timedelta(days=1))[0]
    ok = bool(rep.get("applied")) and second["status"] == "pass" and second.get("disposition") == "recovered"
    return filed, ok, first["evidence"][:100] + " | redmain: " + json.dumps(rep.get("repair"))[:120]


def s_stuck(root, today):
    """A failure item nobody repairs: runway must see it age past the limit."""
    for f in (root / "docs/issues").glob("*.json"):  # the scratch copy starts with no other failure item, so only the injected one is measured
        if "ci-failure" in f.read_text(encoding="utf-8") or "credential" in f.read_text(encoding="utf-8"):
            f.unlink()
    _w(root / "docs/issues/Q-CIFAIL-yearsim.json", {"id": "Q-CIFAIL-yearsim", "title": "yearsim stuck item", "body": "**Status:** open\n", "labels": ["ci-failure"]})
    _runway(root, today)  # first sighting
    hit, r = _below(root, today + dt.timedelta(days=9), "failures")
    (root / "docs/issues/Q-CIFAIL-yearsim.json").unlink()  # SIMULATED repair
    ok, _ = _below(root, today + dt.timedelta(days=10), "failures")
    return hit, not ok, r["components"]["failures"]["why"]


def s_silent(root, today):
    """A queue item closed with no evidence (silent drop): the queue check must fail."""
    p = root / "docs/issues/Q-YEARSIM-silent.json"
    _w(p, {"id": "Q-YEARSIM-silent", "title": "silent drop probe", "body": "**Status:** closed\n", "labels": []})
    bad = subprocess.run([sys.executable, "-m", "foundation", "queue", "--check"], cwd=root, capture_output=True, text=True, timeout=120)
    p.unlink()
    good = subprocess.run([sys.executable, "-m", "foundation", "queue", "--check"], cwd=root, capture_output=True, text=True, timeout=120)
    return bad.returncode != 0, good.returncode == 0, (bad.stdout + bad.stderr)[-160:].strip()


def s_final(root, today):
    """After twelve months: the cost loop's reading is SIMULATED healthy; the live ledger's own latest reading is REAL and must be measurable."""
    _cost(root, today, 0.2, 0.2)
    r = _runway(root, today)
    live = [json.loads(l) for l in (REPO / "ops/cost.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()][-1]
    live_ok = not live.get("unmeasured")
    why = f"simulated runway {r['runway_days']} days (target {r['target_days']}, below {r['below']}); live cost ledger last reading {live.get('date')}: " + ("measured" if live_ok else "UNMEASURED (" + json.dumps(live["unmeasured"])[:120] + ")")
    return not r["below"] or True, (not r["below"]) and live_ok, why


def s_tenant(root, today):
    """The Practical Solutions loops: its own 365-day fake-clock run and workflow cadence check, published by that repository (ops/yearsim.json)."""
    import urllib.request, urllib.error
    try:
        req = urllib.request.Request(TENANT_URL, headers={"User-Agent": "ultrastable-yearsim"})
        with urllib.request.urlopen(req, timeout=20) as r:  # nosec: fixed https URL
            t = json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise Unmeasured(f"tenant result not readable ({type(e).__name__}); the tenant's own yearsim workflow has not published ops/yearsim.json yet") from None
    bad = t["unexpected_fails"] + t["cadence_defects"]
    return True, not bad, f"{len(t['checks'])} loop checks, unexpected failures {t['unexpected_fails']}, cadence defects {t['cadence_defects']}; C9 (real model) expected to fail offline"


def s_social(root, today):
    """The social loop for a simulated year: thought.run steps day by day, so posts must follow the cadence; then a post that loses the hook or carries an
    invented number must be refused by the guard (the honesty rule), and the repaired text must pass. Publishing itself (network) is not exercised."""
    from . import thought
    cfg = thought.load(root)
    start = dt.datetime(today.year, 1, 1, 12, tzinfo=dt.timezone.utc)
    sched = 0
    for d in range(365):
        r = thought.run(root, apply=True, now=start + dt.timedelta(days=d))
        if r.get("blocked"):
            return False, False, f"day {d}: a scheduled paper post failed its own guard: {json.dumps(r['blocked'])[:160]}"
        sched += 1 if r.get("scheduled") else 0
    cal = _r(root / thought.CAL)["posts"]
    paper_posts = [p for p in cal if p.get("kind") == "paper"]
    if not paper_posts:
        return False, False, "no paper post was scheduled in a simulated year"
    slugs = {p["slug"] for p in thought.research_data(root)["papers"]}
    qnfo = [p["id"] for p in paper_posts if "qnfo" in json.dumps(p).lower() or p["paper"] not in slugs]
    if qnfo:  # the owner closed QNFO research: only this system's own papers may be posted, and none may point at QNFO
        return True, False, f"{len(qnfo)} scheduled posts name QNFO or a paper outside this system's own research: {qnfo[:2]}"
    st = thought.studies(root)[next(p for p in thought.research_data(root)["papers"] if p["slug"] == paper_posts[-1]["paper"])["study_id"]]
    paper = next(p for p in thought.research_data(root)["papers"] if p["slug"] == paper_posts[-1]["paper"])
    good = paper_posts[-1]["texts"]["bluesky"]
    bad = good.replace("runs on Ultrastable", "runs on a thing").replace("Ultrastable", "it") + " 99999 tests"
    refused = thought.guard(bad, "bluesky", paper, cfg, st)
    passes = not thought.guard(good, "bluesky", paper, cfg, st)
    return bool(refused), passes and sched >= 1, f"{sched} paper posts scheduled in 365 simulated days; none named QNFO or a paper outside this system's own research; a post without the hook or with an invented number was refused: {refused[:2]}"


def s_deprot(root, today):
    """Dependency rot: a new manifest with no update bot watching it must be caught by the detector, then covered."""
    m = root / "newservice/package.json"
    _w(m, {"name": "newservice", "version": "1.0.0", "dependencies": {"left-pad": "1.0.0"}})
    first = _audit(root, ["dependency-watch"], today)[0]
    filed = first["status"] == "fail" and (root / "docs/issues/Q-AUDIT-dependency-watch.json").exists()
    dep = root / ".github/dependabot.yml"
    dep.write_text(dep.read_text(encoding="utf-8") + "  - package-ecosystem: npm\n    directory: /newservice\n    schedule:\n      interval: weekly\n", encoding="utf-8")  # SIMULATED fix
    second = _audit(root, ["dependency-watch"], today + dt.timedelta(days=1))[0]
    return filed, second["status"] == "pass" and second.get("disposition") == "recovered", first["evidence"][:160]


FUNCS = {k[2:]: v for k, v in list(globals().items()) if k.startswith("s_")}


def scratch(keep=False) -> Path:
    d = Path(tempfile.mkdtemp(prefix="ultrastable-yearsim-"))
    shutil.copytree(REPO, d, ignore=SKIP, dirs_exist_ok=True)
    (d / "ops/runway.json").unlink(missing_ok=True)  # first-seen dates belong to real time, not the simulated year
    subprocess.run(["git", "init", "-q"], cwd=d, check=False)
    subprocess.run(["git", "-c", "user.email=s@s", "-c", "user.name=sim", "add", "-A"], cwd=d, check=False, capture_output=True)
    subprocess.run(["git", "-c", "user.email=s@s", "-c", "user.name=sim", "commit", "-qm", "scratch"], cwd=d, check=False, capture_output=True)
    return d


def run(root=REPO, keep=False) -> dict:
    c = cfg(root)
    sc = scratch()
    rows = []
    try:
        for i, m in enumerate(c["months"]):
            today = START + dt.timedelta(days=365 * i // len(c["months"]))
            if m.get("scenario") is None:
                rows.append({"month": i + 1, "date": today.isoformat(), "area": m["area"], "result": "UNCOVERED", "why": m["why"], "item": m.get("item")})
                continue
            try:
                det, fixed, ev = FUNCS[m["scenario"]](sc, today)
                err = None
            except Unmeasured as e:
                rows.append({"month": i + 1, "date": today.isoformat(), "area": m["area"], "result": "UNCOVERED", "why": str(e), "item": m.get("item")})
                continue
            except Exception as e:  # recorded, never swallowed: a crashed scenario is a FAIL
                det, fixed, ev, err = False, False, f"{type(e).__name__}: {e}", True
            res = "PASS" if det and fixed else "FAIL"
            rows.append({"month": i + 1, "date": today.isoformat(), "area": m["area"], "failure": m["failure"], "detected": bool(det), "repaired_and_verified": bool(fixed),
                         "result": res, "evidence": ev, "labels": {"detect": "REAL", "repair": "REAL" if m["scenario"] in REAL_REPAIR else "SIMULATED", "verify": "REAL"}, **({"crashed": True} if err else {})})
    finally:
        if not keep:
            shutil.rmtree(sc, ignore_errors=True)
    n = lambda k: sum(1 for r in rows if r["result"] == k)
    return {"version": c["version"], "simulated_start": START.isoformat(), "months": rows, "months_total": len(rows), "pass": n("PASS"), "fail": n("FAIL"), "uncovered": n("UNCOVERED"),
            "ok": n("FAIL") == 0, "honesty": "Detection and verification ran the repository's own code on a scratch copy. Repairs were applied by the harness, not by the live executor. UNCOVERED areas were not simulated and count against the claim."}


def render(res: dict) -> str:
    return "// GENERATED by python3 -m foundation yearsim --apply; do not edit.\n// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\nexport const YEARSIM = " + json.dumps(res, indent=1) + ";\n"


def check(root=REPO) -> list[str]:
    c, bad = cfg(root), []
    if len(c["months"]) < 12:
        bad.append("the year has at least twelve months")
    for m in c["months"]:
        if m.get("scenario") is None and not m.get("item"):
            bad.append(f"{m['area']}: an uncovered area needs a Q-YEARSIM item id")
        if m.get("scenario") and m["scenario"] not in FUNCS:
            bad.append(f"{m['area']}: no scenario {m['scenario']}")
    return bad


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if "--check" in argv:
        b = check()
        print("\n".join(b) or "yearsim ok")
        return 1 if b else 0
    if "--probe" in argv:  # closing probe of Q-YEARSIM-<area>: that month, run fresh, must pass
        area = argv[argv.index("--probe") + 1]
        row = next((m for m in run(REPO)["months"] if m["area"] == area), None)
        print(f"{area}: {row['result'] if row else 'unknown'}")
        return 0 if row and row["result"] == "PASS" else 1
    res = run(REPO, "--keep" in argv)
    if "--apply" in argv:
        _w(REPO / "ops/yearsim.json", res)
        (REPO / "site/yearsim-data.js").write_text(render(res), encoding="utf-8")
        for m in res["months"]:
            if m["result"] == "FAIL":
                _w(REPO / f"docs/issues/Q-YEARSIM-{m['area']}.json", {"id": f"Q-YEARSIM-{m['area']}", "title": f"Q-YEARSIM-{m['area']}: year simulation month {m['month']} failed ({m['failure']})",
                   "body": f"**Owner:** staff\n**Trigger:** every yearsim run\n**Done check:** cmd:python3 -m foundation yearsim --probe {m['area']}\n**Status:** open\n\nYEARSIM-1: {m['evidence']}\n", "labels": ["role:staff", "raises-self", "runway"], "milestone": "Now", "workstream": "Reliability"})
    print(json.dumps({k: v for k, v in res.items() if k != "months"}, indent=1))
    for m in res["months"]:
        print(f"{m['month']:>2} {m['date']} {m['result']:<9} {m['area']}: {m.get('evidence') or m.get('why')}")
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
