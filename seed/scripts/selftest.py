# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SELFTEST-1 (Rowan, 2026-11-25: "Test, audit and remediate all failure modes"): standing self-tests for the failure classes found that day.

  python3 -m foundation selftest --data        every generated site/*-data.js whose own "at" stamp is older than its limit (frozen page)
  python3 -m foundation selftest --workflows   every scheduled workflow in the org whose last runs all failed or which stopped running (silent loop)
  python3 -m foundation selftest --outcomes    OUTCOME-PROBE-1: each pipeline's declared end state against live reality, on every domain
  python3 -m foundation selftest --effects     every loop names the metric its effect is measured on (shrink-only baseline)
  python3 -m foundation selftest --owner       OWNER-FIRST-1: every problem the owner found first names the detector added for it; prints the
                                               headline metric owner_found_first_30d (target 0)
  python3 -m foundation selftest --check       the config is well formed (in tests)

Both probes exit 1 on a finding. A source that cannot be read is unmeasured and also exits 1: an empty answer is never read as fine.
They run as detectors in doctrine/detectors.json, so failure-audit files a Q-AUDIT item with suspects and closes it when the probe passes.
Found on 2026-11-25: /balance frozen since 11-21 (only `balance --gate` ran), /changelog frozen since 11-21 (it rode a PR that kept going red),
and ultrastable/seed kit-sync red every day since 11-22 with nothing watching it.
"""
import json, os, re, sys, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CONFIG = "doctrine/selftest.json"
STAMP = re.compile(r'"at":\s*"(\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:\d{2}))"')


def load(root=REPO) -> dict:
    # The platform keeps it in doctrine/; a seeded system keeps it in autonomy/ (seed/scripts/selftest.py is this file, kept identical by a test).
    for rel in (CONFIG, "autonomy/selftest.json"):
        if (Path(root) / rel).is_file():
            return json.loads((Path(root) / rel).read_text(encoding="utf-8"))
    raise FileNotFoundError(CONFIG)


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def data_findings(root=REPO, now=None, cfg=None) -> list[str]:
    """A generated data module's first "at" stamp is when its generator last measured. Older than the limit means the page is frozen."""
    cfg = cfg or load(root)
    now = now or datetime.now(timezone.utc)
    lim, out = cfg["data"], []
    for f in sorted((Path(root) / "site").glob("*-data.js")):
        rel = f"site/{f.name}"
        if rel in lim.get("exempt", {}):
            continue
        m = STAMP.search(f.read_text(encoding="utf-8")[:4000])
        if not m:
            continue  # no stamp: the claims and freshness checks own these
        age_h = (now - _ts(m.group(1))).total_seconds() / 3600
        max_h = lim.get("max_age_h", {}).get(rel, lim["default_max_age_h"])
        if age_h > max_h:
            out.append(f"{rel}: generated {age_h:.0f} h ago, limit {max_h} h (frozen; its generator is not running or not landing)")
    return out


def _get(url: str, token: str | None):
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "ultrastable-selftest"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def workflow_findings(cfg=None, get=None, now=None) -> list[str]:
    cfg = cfg or load()
    now = now or datetime.now(timezone.utc)
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    get = get or (lambda url: _get(url, token))
    w, out = cfg["workflows"], []
    for repo in w["repos"] or [r for r in [os.environ.get("GITHUB_REPOSITORY")] if r]:  # a seeded system watches its own repository
        try:
            wfs = get(f"https://api.github.com/repos/{repo}/actions/workflows?per_page=100").get("workflows", [])
        except Exception as e:  # unreadable is unmeasured, never passed
            out.append(f"{repo}: unmeasured ({type(e).__name__}: {str(e)[:80]})"); continue
        for wf in wfs:
            if wf.get("state") != "active":
                continue
            try:
                runs = get(f"https://api.github.com/repos/{repo}/actions/workflows/{wf['id']}/runs?event=schedule&per_page={w['window']}").get("workflow_runs", [])
            except Exception as e:
                out.append(f"{repo} {wf.get('path')}: unmeasured ({type(e).__name__})"); continue
            done = [r for r in runs if r.get("status") == "completed"]
            if not done:
                continue  # never scheduled (dispatch-only) or brand new
            if len(done) >= w["window"] and all(r.get("conclusion") == "failure" for r in done):
                out.append(f"{repo} {wf['path']}: last {len(done)} scheduled runs all failed (silent loop stop)")
            age_h = (now - _ts(done[0]["created_at"])).total_seconds() / 3600
            if age_h > w["stale_h"]:
                out.append(f"{repo} {wf['path']}: no scheduled run for {age_h:.0f} h (limit {w['stale_h']} h)")
    return out


# OUTCOME-PROBE-1 (Rowan, 2026-11-25: "Having the user tell you that something is off is not autonomous"). A liveness probe asks "did it run";
# an outcome probe asks "did the result reach the place it was for". Each class the owner found first that day has a rule here:
#   (a) shipped but never reached its audience: papers_posted, sitemap
#   (b) an empty or failed read counted as success: domains (a page or sitemap that answers with nothing), nonzero
#   (c) jobs that stop silently: --data and --workflows above
#   (d) channels failing on every call: channels (3 failures in a row), also paused at the source by CHANNEL-BREAKER-1 in seed/worker/src/social.js
#   (e) a loop with no measured effect: --effects
def _fetch(url: str, timeout=20) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "ultrastable-selftest (+https://ultrastable.io)"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(2_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""


def _papers(root) -> list[dict]:
    f = Path(root) / "site/research-data.js"
    if not f.is_file():
        return []
    txt = f.read_text(encoding="utf-8")
    j = json.loads(txt[txt.index("{"): txt.rindex("}") + 1])
    return j.get("papers", [])


def _domains(root) -> list[str]:
    """Every public host the platform and its tenants serve, from doctrine/topology.json (no list typed by hand)."""
    f = Path(root) / "doctrine/topology.json"
    if not f.is_file():  # a seeded system names its own hosts in the config
        return list(load(root)["outcomes"]["domains"].get("hosts", []))
    topo = json.loads(f.read_text(encoding="utf-8"))
    out = []
    for w in topo.get("workers", []):
        if w.get("status", "live") not in ("live", None):
            continue
        for r in w.get("routes") or []:
            host = r.split("/")[0]
            if host and not host.startswith("www.") and host not in out:
                out.append(host)
    return out


def _dig(j, path: str):
    for k in path.split("."):
        j = j.get(k) if isinstance(j, dict) else (len(j) if k == "#" and isinstance(j, list) else None)
    return j


def outcome_findings(root=REPO, cfg=None, fetch=None, now=None) -> list[str]:
    cfg = cfg or load(root)
    oc = cfg["outcomes"]
    fetch = fetch or _fetch
    now = now or datetime.now(timezone.utc)
    out = []

    def get(url):
        try:
            return fetch(url)
        except Exception as e:  # unreadable is unmeasured, never passed
            return 0, f"__error__ {type(e).__name__}: {str(e)[:80]}"

    papers = _papers(root)
    # (a) every paper was scheduled and reached every channel it names, within max_days of its first scheduling
    cf = Path(root) / "social/calendar.json"
    cal = json.loads(cf.read_text(encoding="utf-8")).get("posts", []) if cf.is_file() else []
    pp = oc.get("papers_posted")
    if not pp:
        papers = []
    surl = pp["url"] if pp else next((f"https://{h}/api/social/outcomes" for h in oc.get("domains", {}).get("hosts", [])), None)  # a seed's own Worker serves it
    code, body = get(surl) if surl else (0, "")
    live = json.loads(body) if code == 200 and body.startswith("{") else None
    if pp and live is None:
        out.append(f"{pp['url']}: unmeasured (HTTP {code}) so no paper can be shown to have reached anyone")
    for p in papers:
        slug = p["slug"]
        mine = [x for x in cal if x.get("kind") == "paper" and x.get("paper") == slug]
        if not mine:
            out.append(f"paper {slug}: never scheduled for posting (in research, not in social/calendar.json)")
            continue
        first = min(x["date"] for x in mine)
        age_d = (now.date() - datetime.fromisoformat(first).date()).days
        if live is None or age_d < pp["max_days"]:
            continue
        for ch in pp["channels"]:
            reached = live.get("channels", {}).get(ch, {}).get("reached", [])
            if not any(i.startswith(f"paper:{slug}:") for i in reached):
                out.append(f"paper {slug}: scheduled {age_d} d ago, never reached {ch}")
    # (d) a channel failing on every call
    if live:
        for ch, c in live.get("channels", {}).items():
            if c.get("fail_streak", 0) >= oc["channels"]["fail_streak"]:
                out.append(f"channel {ch}: last {c['fail_streak']} sends all failed (paused by the breaker; reconnect it or drop it from the fan-out)")
    # (a) every paper is in the sitemap search engines read
    sm = oc.get("sitemap")
    code, body = get(sm["url"]) if sm else (200, "<loc>")
    if code != 200 or "<loc>" not in body:
        out.append(f"{sm['url']}: HTTP {code}, {body.count('<loc>')} urls (empty or failed read)")
    else:
        for p in papers:
            u = f"{sm['base']}/research/{p['slug']}"
            if f"<loc>{u}</loc>" not in body:
                out.append(f"sitemap: {u} missing (search engines never see it)")
    # (b) every public domain answers with a real page and a non-empty sitemap
    for host in _domains(root):
        if host in oc["domains"].get("exempt", {}):
            continue
        code, body = get(f"https://{host}/")
        if code != 200 or len(body) < oc["domains"]["min_bytes"]:
            out.append(f"https://{host}/: HTTP {code}, {len(body)} bytes (an empty or failed page counted as up)")
        code, body = get(f"https://{host}/sitemap.xml")
        if code != 200 or "<loc>" not in body:
            out.append(f"https://{host}/sitemap.xml: HTTP {code}, no urls (the domain is invisible to search)")
    # (b) a count that reads 0 while its source shows otherwise
    for n in oc.get("nonzero", []):
        code, body = get(n["url"])
        try:
            v = _dig(json.loads(body), n["field"]) if code == 200 else None
        except ValueError:
            v = None
        src = _source(root, n["source"], now)
        if v is None:
            out.append(f"{n['url']} {n['field']}: unreadable (HTTP {code})")
        elif not v and src:
            out.append(f"{n['url']} {n['field']} reads {v!r} while {n['source']} shows {src}")
    return out


def _source(root, name: str, now) -> int:
    """Independent counts read from the repository, never from the surface being checked."""
    import subprocess
    if name == "git_merges_7d":
        since = (now.timestamp() - 7 * 86400)
        r = subprocess.run(["git", "-C", str(root), "log", "--since", f"@{int(since)}", "--oneline", "--grep", r"(#[0-9]\+)", "origin/main"],
                           capture_output=True, text=True)
        if r.returncode != 0:
            r = subprocess.run(["git", "-C", str(root), "log", "--since", f"@{int(since)}", "--oneline", "--grep", r"(#[0-9]\+)"], capture_output=True, text=True)
        return len([l for l in r.stdout.splitlines() if l.strip()])
    if name == "papers":
        return len(_papers(root))
    raise ValueError(f"unknown source {name}")


def effect_findings(root=REPO, cfg=None) -> list[str]:
    """(e) a loop with no metric for its effect cannot show it did anything. Shrink-only: a new loop must name one; the baseline only falls."""
    cfg = cfg or load(root)
    f = next((Path(root) / r for r in ("instances/ultrastable/loop-registry.json", "autonomy/loop-registry.json") if (Path(root) / r).is_file()), None)
    if f is None:
        return []
    reg = json.loads(f.read_text(encoding="utf-8"))
    loops = reg if isinstance(reg, list) else reg.get("loops", [])
    bare = sorted(l.get("id", "?") for l in loops if not (l.get("cycle_metric") or l.get("metric") or l.get("measure")))
    base = cfg["effects"]["baseline"]
    if len(bare) > base:
        return [f"{len(bare)} loops name no metric for their effect, baseline {base}: a new loop must declare cycle_metric"]
    if len(bare) < base:
        return [f"only {len(bare)} loops lack a cycle_metric now: lower effects.baseline in {CONFIG} to {len(bare)} (shrink-only)"]
    return []


OWNER = "ops/owner-reports.jsonl"


def owner_findings(root=REPO, now=None) -> tuple[list[str], dict]:
    """OWNER-FIRST-1: each row is one problem the owner saw before the system. It must name the detector that now watches for it."""
    now = now or datetime.now(timezone.utc)
    df = Path(root) / "doctrine/detectors.json"
    det = {d["id"] for d in json.loads(df.read_text(encoding="utf-8"))["detectors"]} if df.is_file() else set()
    det |= {d["id"] for d in load(root).get("detectors", [])}  # a seeded system lists its detectors in its own config
    rows = [json.loads(l) for l in (Path(root) / OWNER).read_text(encoding="utf-8").splitlines() if l.strip()] if (Path(root) / OWNER).is_file() else []
    out = []
    for r in rows:
        missing = [d for d in r.get("detectors", []) if d not in det]
        if not r.get("detectors"):
            out.append(f"owner report {r['id']} ({r['what'][:60]}): no detector added for it (detector gap)")
        elif missing:
            out.append(f"owner report {r['id']}: names detectors that do not exist: {', '.join(missing)}")
    recent = [r for r in rows if (now - _ts(r["at"])).total_seconds() < 30 * 86400]
    return out, {"owner_found_first_30d": len(recent), "target": 0, "reports": len(rows)}


def check(root=REPO) -> list[str]:
    c, bad = load(root), []
    for k in ("data", "workflows", "outcomes", "effects"):
        if k not in c:
            bad.append(f"{CONFIG}: missing {k}")
    if "workflows" in c and (c["workflows"].get("window", 0) < 2 or not (c["workflows"].get("repos") or "detectors" in c)):
        bad.append(f"{CONFIG}: workflows needs a window of 2 or more and at least one repo")
    for rel, why in c.get("data", {}).get("exempt", {}).items():
        if not why:
            bad.append(f"{CONFIG}: {rel} is exempt without a reason")
    return bad


def main(argv) -> int:
    if "--check" in argv:
        bad = check(); print("\n".join(bad) or "selftest ok"); return 1 if bad else 0
    found = []
    if "--owner" in argv:
        f, metric = owner_findings(); found += f
        print(json.dumps(metric))
    if "--outcomes" in argv:
        found += outcome_findings()
    if "--effects" in argv:
        found += effect_findings()
    if "--data" in argv:
        found += data_findings()
    if "--workflows" in argv:
        found += workflow_findings()
    print("\n".join(found) or "selftest: no findings")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
