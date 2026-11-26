# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SELFTEST-1 (Rowan, 2026-11-25: "Test, audit and remediate all failure modes"): standing self-tests for the failure classes found that day.

  python3 -m foundation selftest --data        every generated site/*-data.js whose own "at" stamp is older than its limit (frozen page)
  python3 -m foundation selftest --workflows   every scheduled workflow in the org whose last runs all failed or which stopped running (silent loop)
  python3 -m foundation selftest --check       the config is well formed (in tests)

Both probes exit 1 on a finding. A source that cannot be read is unmeasured and also exits 1: an empty answer is never read as fine.
They run as detectors in doctrine/detectors.json, so failure-audit files a Q-AUDIT item with suspects and closes it when the probe passes.
Found on 2026-11-25: /balance frozen since 11-21 (only `balance --gate` ran), /changelog frozen since 11-21 (it rode a PR that kept going red),
and ultrastable/seed kit-sync red every day since 11-22 with nothing watching it.
"""
import json, os, re, sys, urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CONFIG = "doctrine/selftest.json"
STAMP = re.compile(r'"at":\s*"(\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:\d{2}))"')


def load(root=REPO) -> dict:
    return json.loads((Path(root) / CONFIG).read_text(encoding="utf-8"))


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


def _declared_repos(root=None) -> list[str]:
    """Every repository the org declares: org/repos.json (not archived) and doctrine/tenant-repos.json (not retired)."""
    root = Path(root or REPO); out = []
    try:
        out += [f"ultrastable/{r['name']}" for r in json.loads((root / "org/repos.json").read_text())["repos"] if not r.get("archived")]
        out += [t["repo"] for t in json.loads((root / "doctrine/tenant-repos.json").read_text())["tenants"].values() if t.get("repo") and t.get("state") != "retired"]
    except (OSError, ValueError, KeyError) as e:
        print(f"selftest: declared repositories unread ({e})", file=sys.stderr)
    return out


def workflow_findings(cfg=None, get=None, now=None) -> list[str]:
    cfg = cfg or load()
    now = now or datetime.now(timezone.utc)
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    get = get or (lambda url: _get(url, token))
    w, out = cfg["workflows"], []
    repos = list(dict.fromkeys(w["repos"] + _declared_repos()))  # DECLARED-LIVE-1: a hand-kept list missed every tenant repository made after it
    for repo in repos:
        try:
            wfs = get(f"https://api.github.com/repos/{repo}/actions/workflows?per_page=100").get("workflows", [])
        except Exception as e:  # unreadable is unmeasured, never passed
            out.append(f"{repo}: unmeasured ({type(e).__name__}: {str(e)[:80]})"); continue
        for wf in wfs:
            if wf.get("state") != "active":
                continue
            try:
                runs = get(f"https://api.github.com/repos/{repo}/actions/workflows/{wf['id']}/runs?event=schedule&per_page={w['window']}").get("workflow_runs", [])
                anyev = get(f"https://api.github.com/repos/{repo}/actions/workflows/{wf['id']}/runs?per_page={w['window']}").get("workflow_runs", [])
            except Exception as e:
                out.append(f"{repo} {wf.get('path')}: unmeasured ({type(e).__name__})"); continue
            last = [r for r in anyev if r.get("status") == "completed"]
            if len(last) >= w["window"] and all(r.get("conclusion") == "failure" for r in last) and not all(r.get("event") == "schedule" for r in last):
                out.append(f"{repo} {wf['path']}: last {len(last)} runs (push, dispatch or schedule) all failed")  # ultrastable/.github branch-cleanup was red on dispatch runs
            done = [r for r in runs if r.get("status") == "completed"]
            if not done:
                continue  # never scheduled (dispatch-only) or brand new
            if len(done) >= w["window"] and all(r.get("conclusion") == "failure" for r in done):
                out.append(f"{repo} {wf['path']}: last {len(done)} scheduled runs all failed (silent loop stop)")
            age_h = (now - _ts(done[0]["created_at"])).total_seconds() / 3600
            if age_h > w["stale_h"]:
                out.append(f"{repo} {wf['path']}: no scheduled run for {age_h:.0f} h (limit {w['stale_h']} h)")
    return out


def check(root=REPO) -> list[str]:
    c, bad = load(root), []
    for k in ("data", "workflows"):
        if k not in c:
            bad.append(f"{CONFIG}: missing {k}")
    if "workflows" in c and (c["workflows"].get("window", 0) < 2 or not c["workflows"].get("repos")):
        bad.append(f"{CONFIG}: workflows needs a window of 2 or more and at least one repo")
    for rel, why in c.get("data", {}).get("exempt", {}).items():
        if not why:
            bad.append(f"{CONFIG}: {rel} is exempt without a reason")
    return bad


def main(argv) -> int:
    if "--check" in argv:
        bad = check(); print("\n".join(bad) or "selftest ok"); return 1 if bad else 0
    found = []
    if "--data" in argv:
        found += data_findings()
    if "--workflows" in argv:
        found += workflow_findings()
    print("\n".join(found) or "selftest: no findings")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
