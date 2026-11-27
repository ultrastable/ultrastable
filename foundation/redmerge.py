# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
# RED-MERGE-1 (ZHC-R5): the closing probe of the merge-lane item, measured: how many commits that reached main in the window had a failing
# `checks` run. python3 -m foundation redmerge [--days 7] [--repo O/R]   exit 1 when any, and unmeasured (gh unreadable) is never 0.
import json, subprocess, sys
from datetime import datetime, timedelta, timezone


def _gh(args, run=subprocess.run):
    r = run(["gh", "api", *args], capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(r.stderr.strip()[:200])
    return json.loads(r.stdout)


def red_commits(commits, checks_of):
    """commits: [{sha, subject}]; checks_of(sha) -> list of (name, conclusion). A commit is red when its `checks` run failed."""
    red = []
    for c in commits:
        for name, concl in checks_of(c["sha"]):
            if name == "checks" and concl == "failure": red.append(c); break
    return red


def read(days=7, repo="ultrastable/ultrastable", gh=_gh, now=None):
    since = ((now or datetime.now(timezone.utc)) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    cs = gh([f"repos/{repo}/commits?sha=main&since={since}&per_page=100", "--jq", "[.[]|{sha:.sha,subject:(.commit.message|split(\"\\n\")[0])}]"])
    cs = [c for c in cs if "[skip ci]" not in c["subject"]]  # bookkeeping commits run no checks
    def checks_of(sha):
        j = gh([f"repos/{repo}/commits/{sha}/check-runs?per_page=100", "--jq", "[.check_runs[]|[.name,.conclusion]]"])
        return [tuple(x) for x in j]
    return {"commits": len(cs), "red": red_commits(cs, checks_of)}


def main(argv=None):
    a = list(argv or [])
    days = int(a[a.index("--days") + 1]) if "--days" in a else 7
    repo = a[a.index("--repo") + 1] if "--repo" in a else "ultrastable/ultrastable"
    try: r = read(days, repo)
    except Exception as e:
        print("redmerge: unmeasured:", e); return 1
    for c in r["red"]: print("RED  ", c["sha"][:9], c["subject"])
    print(f"redmerge: {len(r['red'])} red merge(s) among {r['commits']} commit(s) in {days} day(s)")
    return 1 if r["red"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
