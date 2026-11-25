"""REDTEAM-1 (Rowan, 2026-11-25): the system red-teams its own blind spots, on a clock, and counts who found each failure.

On 2026-11-25 Rowan caught nine problems before any loop did: a dry work queue, a date-pinned test that froze the lane, /live showing 0,
stale PRs and branches, papers never posted or indexed, frozen pages, a dead seed sync, result tables that looked invented, and a missing org
credential. Every one passed the probes that existed. They fall into a few blind-spot classes, and each class has an adversarial check here
that assumes the existing probes are wrong:

  vacuous     a reading with no data (n = 0, an empty list, a zero) is reported as met or fine
  stale       a figure says it is regenerated continuously but its source is days old
  unscored    a prediction is logged for a metric that nothing measures, so it can never be wrong
  phantom     a self-score counts no human touches while outside sessions drove the work
  timebomb    the test suite passes today and fails when the clock moves (run with the clock shifted, --chaos)
  undetected  an owner-found failure has no detector that would have caught it

Findings go to ops/redteam/findings.jsonl with found_by (redteam or owner). The headline metric is redteam_share: red-team findings over all
findings in the last 30 days; the target is that the owner finds nothing first (owner_found_30d -> 0). The failure-audit detector `redteam`
runs `--probe` daily, so a failing check files Q-AUDIT-redteam into the executor's queue through the existing machinery.

  python3 -m foundation redteam --run [--apply] [--chaos]   run every check; --apply appends new findings to the ledger
  python3 -m foundation redteam --probe                     exit 0 when no check finds anything (closing probe)
  python3 -m foundation redteam --owner ID --cls CLASS --detector DET --what TEXT   record a failure the owner found first
  python3 -m foundation redteam --metric                    redteam vs owner counts and share, as JSON
  python3 -m foundation redteam --check                     every owner-found finding names a detector that exists
"""
from __future__ import annotations
import datetime as dt, json, os, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LEDGER = "ops/redteam/findings.jsonl"
CLASSES = ("vacuous", "stale", "unscored", "phantom", "timebomb", "undetected", "unsourced", "credential", "starved")
STALE_DAYS = 3
PRED_RX = re.compile(r"\b([a-z][a-z0-9_]{2,})\s*(?:>=|<=|==|>|<)\s*-?[\d.]+\s+within\s+\d+\s*h\b")


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _ts(s):
    try:
        return dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def rows(root=REPO) -> list[dict]:
    p = Path(root) / LEDGER
    if not p.is_file():
        return []
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]


# ---- checks: each returns a list of {id, cls, what, evidence}

def check_vacuous(root=REPO) -> list[dict]:
    """A research measurement with n = 0 must never read as met."""
    from . import research
    out = []
    try:
        ms = research.measures(root)
    except Exception as e:  # a measurer that cannot run is itself a finding, not a pass
        return [{"id": "vacuous:research-measure", "cls": "vacuous", "what": "research measurements could not be computed", "evidence": repr(e)[:200]}]
    pol = research.load(root)
    finds = [f for s in research.studies(root, pol) for f in s.get("findings", [])] + list(pol.get("questions", []))
    for f in finds:
        m = ms.get(f.get("metric"), {})
        if m.get("n") == 0 and research.verdict(f, ms)["status"] == "met":
            out.append({"id": f"vacuous:{f.get('metric')}", "cls": "vacuous", "what": f"{f.get('metric')} reads met with n = 0",
                        "evidence": m.get("source", "")})
    for f in sorted((Path(root) / "research/papers").glob("*.md")):  # the published text too: a stale paper can still say met on no data
        for m in re.finditer(r"\(n = 0\)\. [^\n]*Verdict: \*\*met\*\*", f.read_text(encoding="utf-8")):
            out.append({"id": f"vacuous:paper:{f.stem}", "cls": "vacuous", "what": f"{f.name} says met on n = 0", "evidence": m.group(0)[:120]})
            break
    return out


def check_stale(root=REPO, at=None) -> list[dict]:
    """A source the papers cite must be younger than STALE_DAYS, since the papers say they are regenerated after every merge."""
    at = at or now()
    out = []
    p = Path(root) / "ops/research/prs.json"
    if p.is_file():
        f = _ts(json.loads(p.read_text(encoding="utf-8")).get("fetched_at"))
        if f is None or (at - f).days >= STALE_DAYS:
            out.append({"id": "stale:research-prs", "cls": "stale", "what": "pull-request snapshot behind the papers is stale",
                        "evidence": f"ops/research/prs.json fetched_at={f.isoformat() if f else None}"})
    return out


def _measured_names(root) -> str:
    root = Path(root)
    buf = []
    for d, pats in (("foundation", ("*.py",)), ("seed/worker/src", ("*.js",)), ("site", ("*.js",))):
        for pat in pats:
            for f in (root / d).rglob(pat):
                if f.name in ("generated.js", "redteam.py") or "vendor" in f.parts:
                    continue
                try:
                    buf.append(f.read_text(encoding="utf-8"))
                except (OSError, UnicodeDecodeError):
                    continue
    return "\n".join(buf)


def check_unscored(root=REPO) -> list[dict]:
    """A logged prediction names a metric. If no measuring code reads that name apart from the line that writes the prediction, it can never fail."""
    root = Path(root)
    metrics = {}
    for f in (root / "ops").rglob("*.jsonl"):
        try:
            for line in f.read_text(encoding="utf-8").splitlines()[-1:]:  # the latest row shows what the code writes now
                for m in PRED_RX.finditer(line):
                    metrics.setdefault(m.group(1), str(f.relative_to(root)))
        except (OSError, UnicodeDecodeError):
            continue
    code = _measured_names(root)
    out = []
    for name, src in sorted(metrics.items()):
        hits = len(re.findall(r"[\"'`]" + re.escape(name) + r"[\"'`]", code))
        if hits < 1:
            out.append({"id": f"unscored:{name}", "cls": "unscored", "what": f"predictions on {name} are logged but no code measures {name}", "evidence": src})
    return out


def check_phantom(root=REPO) -> list[dict]:
    """The latest criticality tick must not report zero human touches while outside sessions originated its verified deploys."""
    p = Path(root) / "ops/criticality.jsonl"
    if not p.is_file():
        return []
    last = [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()][-1]
    outside = int((last.get("origins") or {}).get("outside", 0))
    if outside and not last.get("human_touches"):
        return [{"id": "phantom:criticality", "cls": "phantom", "what": f"criticality counts 0 human touches while {outside} deploys came from outside sessions",
                 "evidence": f"ops/criticality.jsonl at {last.get('at')}"}]
    return []


def check_undetected(root=REPO) -> list[dict]:
    """Every failure the owner found first names a detector that exists, so the same failure is caught by code next time."""
    from . import failure_audit
    ids = {d["id"] for d in failure_audit.load(root)["detectors"]} | {"redteam:" + c for c in CLASSES}
    return [{"id": f"undetected:{r['id']}", "cls": "undetected", "what": f"owner-found {r['id']} has no live detector", "evidence": str(r.get("detector"))}
            for r in rows(root) if r.get("found_by") == "owner" and r.get("detector") not in ids]


def check_timebomb(root=REPO, days=(30, 200)) -> list[dict]:
    """Run the foundation tests with the clock shifted forward. A test that passes today and fails later is a date bomb in the lane."""
    try:
        import libfaketime
    except ImportError:
        return [{"id": "timebomb:unavailable", "cls": "timebomb", "what": "libfaketime is not installed, so the clock cannot be shifted", "evidence": "pip install libfaketime"}]
    _, env = libfaketime.get_reload_information()
    base = _failing(root, dict(os.environ))
    out = []
    for d in days:
        e = {**os.environ, **env, "FAKETIME": f"+{d}d"}
        for t in sorted(_failing(root, e) - base):
            out.append({"id": f"timebomb:{t}", "cls": "timebomb", "what": f"{t} passes today and fails {d} days from now", "evidence": f"FAKETIME=+{d}d"})
    return out


def _failing(root, env) -> set[str]:
    r = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests/foundation"], cwd=root, env=env, capture_output=True, text=True, timeout=1500)
    return set(re.findall(r"^(?:FAIL|ERROR): (\S+ \([^)]+\))", r.stderr, re.M))


def check_starved(root=REPO) -> list[dict]:
    """A dry work queue reads as calm, yet the improvement loop is meant to never run out of work (IMPROVE-1)."""
    from . import queue
    n = sum(1 for it in queue.items(root) if it.get("status") == "open")
    return [] if n else [{"id": "starved:queue", "cls": "starved", "what": "the work queue has no open item", "evidence": "foundation.queue.items"}]


def check_credential(root=REPO) -> list[dict]:
    """A credential the loops need is expired or missing: credwatch's own check, run adversarially rather than trusted."""
    r = subprocess.run([sys.executable, "-m", "foundation", "credwatch", "--check"], cwd=root, capture_output=True, text=True, timeout=120)
    return [] if r.returncode == 0 else [{"id": "credential:credwatch", "cls": "credential", "what": "credwatch check fails", "evidence": (r.stdout + r.stderr).strip()[-200:]}]


def _get(url, token=None):
    import urllib.request
    h = {"User-Agent": "ultrastable-redteam/1"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def check_live(root=REPO, get=_get, at=None) -> list[dict]:
    """Read production as a stranger would. Runs only where REDTEAM_LIVE=1 (the scheduled workflow); a page that cannot be read is a finding."""
    at, out, site = at or now(), [], "https://ultrastable.io"
    def f(i, c, w, e): out.append({"id": i, "cls": c, "what": w, "evidence": str(e)[:200]})
    try:
        home = get(site + "/")
        if re.search(r"at commit generated|\{\{|\$\{", home):
            f("unsourced:home-placeholder", "unsourced", "homepage shows an unfilled placeholder where a commit or number belongs", "at commit generated")
        claims = get(site + "/api/claims")
        if re.search(r'" \+ [A-Za-z_.]+ \+ "', claims):
            f("unsourced:claims-template", "unsourced", "a published claim contains unrendered template code", 'pattern \" + X + \"')
        prog = json.loads(get(site + "/progress.json"))
        apps = prog.get("apps") or {}
        t = _ts(apps.get("as_of"))
        if t is None or (at - t).days >= STALE_DAYS:
            f("stale:progress-apps", "stale", "progress.json apps block is stale", apps.get("as_of"))
        pulse = json.loads(get(site + "/pulse.json"))
        a, b = (pulse.get("week") or {}).get("substantive"), ((prog.get("digests") or {}).get("weekly") or {}).get("substantive")
        if isinstance(a, int) and isinstance(b, int) and abs(a - b) > 0.1 * max(a, b, 1):
            f("conflict:weekly-substantive", "unsourced", f"two pages give different weekly substantive counts ({a} vs {b})", "/pulse.json vs /progress.json")
    except Exception as e:
        f("vacuous:site-unreadable", "vacuous", "production could not be read", repr(e))
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    for repo in ("ultrastable/ultrastable", "ultrastable/seed", "ultrastable/workers"):
        try:
            prs = json.loads(get(f"https://api.github.com/repos/{repo}/pulls?state=open&per_page=100", tok))
            old = [p["number"] for p in prs if _ts(p.get("updated_at")) and (at - _ts(p["updated_at"])).total_seconds() > 86400]
            if old:
                f(f"stale:prs:{repo}", "stale", f"{repo} has {len(old)} open PRs idle over a day", old[:10])
        except Exception as e:
            f(f"vacuous:github:{repo}", "vacuous", f"{repo} pull requests could not be read", repr(e))
    return out


CHECKS = {"vacuous": check_vacuous, "stale": check_stale, "unscored": check_unscored, "phantom": check_phantom, "undetected": check_undetected, "starved": check_starved, "credential": check_credential}


def run(root=REPO, apply=False, chaos=False) -> dict:
    found = []
    for name, fn in CHECKS.items():
        found += fn(root)
    if os.environ.get("REDTEAM_LIVE") == "1":
        found += check_live(root)
    if chaos:
        found += check_timebomb(root)
    new = []
    if apply:
        seen = {r["id"] for r in rows(root) if r.get("found_by") == "redteam" and r.get("status") != "fixed"}
        stamp = now().strftime("%Y-%m-%dT%H:%M:%SZ")
        live = {f["id"] for f in found}
        p = Path(root) / LEDGER
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as fh:
            for f in found:
                if f["id"] not in seen:
                    new.append(f)
                    fh.write(json.dumps({"at": stamp, "found_by": "redteam", "status": "open", "detector": "redteam:" + f["cls"], **f}) + "\n")
            for sid in sorted(seen - live):  # a check that passes again closes its finding with evidence, never by deletion
                if sid.startswith("timebomb:") and not chaos:
                    continue
                fh.write(json.dumps({"at": stamp, "id": sid, "found_by": "redteam", "status": "fixed", "evidence": "check passes"}) + "\n")
    return {"findings": found, "new": new, "metric": metric(root)}


def metric(root=REPO, days=30, at=None) -> dict:
    at = at or now()
    first = {}
    for r in rows(root):
        if r.get("status") == "fixed":
            continue
        t = _ts(r.get("at"))
        if t and (at - t).days < days and r["id"] not in first:
            first[r["id"]] = r["found_by"]
    rt = sum(1 for v in first.values() if v == "redteam")
    ow = sum(1 for v in first.values() if v == "owner")
    return {"redteam_found_30d": rt, "owner_found_30d": ow, "redteam_share": round(rt / (rt + ow), 3) if rt + ow else None,
            "target": "owner_found_30d == 0"}


def record_owner(root, fid, cls, detector, what, at=None) -> dict:
    if cls not in CLASSES:
        raise SystemExit(f"class must be one of {CLASSES}")
    r = {"at": at or now().strftime("%Y-%m-%dT%H:%M:%SZ"), "id": fid, "found_by": "owner", "status": "open", "cls": cls, "detector": detector, "what": what}
    p = Path(root) / LEDGER
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(r) + "\n")
    return r


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--metric" in a:
        print(json.dumps(metric(REPO), indent=1)); return 0
    if "--check" in a:
        bad = check_undetected(REPO)
        for b in bad:
            print("redteam:", b["what"])
        return 1 if bad else 0
    if "--owner" in a:
        g = lambda k: a[a.index(k) + 1] if k in a else ""
        print(json.dumps(record_owner(REPO, g("--owner"), g("--cls"), g("--detector"), g("--what")))); return 0
    if "--probe" in a:
        r = run(REPO)
        for f in r["findings"]:
            print(f"{f['cls']}: {f['what']} ({f['evidence']})")
        return 1 if r["findings"] else 0
    r = run(REPO, apply="--apply" in a, chaos="--chaos" in a)
    print(json.dumps({"findings": len(r["findings"]), "new": len(r["new"]), **r["metric"]}, indent=1))
    for f in r["findings"]:
        print(f"  {f['cls']}: {f['what']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
