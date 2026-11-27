# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""PR-BOUND-1 (2026-11-26): no pull request stays open for hours. Rowan: "Why are PRs open for 10 hours? (or even 1 hour!?)".
Root cause: the lane labelled a conflicted or failed session PR and waited for the executor, whose model calls were all failing, and nothing
bounded the wait. This runs model-free from the lane after its merge pass:
  --apply  closes a PR whose `conflict` label is older than conflict_min or whose `ci-failed` label is older than failed_min,
           with a comment that names the reason; the branch is kept, so nothing is lost, and the row goes to ops/prbound.jsonl.
  --check  exits 1 while any open PR is older than max_open_h (detector `pr-age-bound`, failure mode fm-pr-stale).
A PR labelled `hold` is never closed. Read failures are unmeasured, never passed.
PR-NEVER-LOSE-1 (2026-11-27): #2615 was closed on a `conflict` label that was already stale (the branch merged cleanly). The label is only a candidate: the close goes through
foundation/prsafe.safe_close, which re-reads the pull request live, refuses to close anything mergeable, tries update-branch, and pins the head under refs/archive first.
PR-BOUND-3 (2026-11-27): the clock is the condition's, not the pull request's. PR-BOUND-2 counted minutes since the pull request opened, so one open for 31 minutes was
closed on the first pass that saw a conflict: #2686 was closed 17 seconds after main moved under it, with the reason "unresolved for 90 min". The age is now minutes since
the label was last put on (the lane adds it once per episode and removes it when the condition clears, so its own comments cannot refresh it). A label whose time cannot
be read is unmeasured and never closes anything."""
import json, os, sys, time
from . import prsafe
from datetime import datetime, timezone
CONF = {"conflict_min": 30, "failed_min": 60, "max_open_h": 2}
def _age_min(ts, now): return (now - datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()) / 60
BOUNDS = (("conflict", "conflict_min", "merge conflict with main unresolved for {} min"), ("ci-failed", "failed_min", "a failing check unrepaired for {} min"))
def since(repo, n, api=None, pages=5):
    """When each bounded label was last put on this pull request: {label: time}. Issue events come oldest first, so the last one read wins."""
    api, out = api or prsafe.gh_api, {}
    for page in range(1, pages + 1):
        ev = api(f"repos/{repo}/issues/{n}/events?per_page=100&page={page}")
        for e in ev:
            if e.get("event") == "labeled" and (e.get("label") or {}).get("name") in ("conflict", "ci-failed"): out[e["label"]["name"]] = e["created_at"]
        if len(ev) < 100: break
    return out
def read(prs, now=None, conf=CONF):
    """prs: [{number, createdAt, updatedAt, labels:[{name}], since:{label: time}}] -> (to_close [(n, reason)], stale [(n, hours)])."""
    now = now or time.time(); close, stale = [], []
    for p in prs:
        labels = {l["name"] for l in p.get("labels", [])}
        if "hold" in labels: continue
        for lab, key, why in BOUNDS:  # PR-BOUND-3: the first bounded label it carries decides, on that label's own clock
            if lab in labels:
                at = (p.get("since") or {}).get(lab)
                if at and _age_min(at, now) >= conf[key]: close.append((p["number"], why.format(int(_age_min(at, now)))))
                break
        h = _age_min(p["createdAt"], now) / 60
        if h >= conf["max_open_h"]: stale.append((p["number"], round(h, 1)))
    return close, stale
def main(argv):
    repo = os.environ.get("GITHUB_REPOSITORY", "ultrastable/ultrastable")
    try:
        raw = prsafe.gh_api(f"repos/{repo}/pulls?state=open&per_page=100")  # REST: `gh pr list` needs GraphQL, which cloud sessions refuse
        prs = [{"number": p["number"], "createdAt": p["created_at"], "updatedAt": p["updated_at"], "labels": p.get("labels", [])} for p in raw]
    except Exception as e:
        print(json.dumps({"state": "unmeasured", "error": str(e)})); return 1
    unread = []
    for p in prs:  # one events read per labelled pull request; an unreadable one is unmeasured, so it is not closed on a guess
        if {l["name"] for l in p["labels"]} & {"conflict", "ci-failed"}:
            try: p["since"] = since(repo, p["number"])
            except Exception as e: unread.append(p["number"]); print(f"#{p['number']} label time unmeasured: {e}")
    close, stale = read(prs)
    if "--apply" in argv:
        for n, why in close:
            try:
                r = prsafe.safe_close(repo, n, why)
                if r["closed"]:
                    with open("ops/prbound.jsonl", "a") as fh:
                        fh.write(json.dumps({"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "pr": n, "reason": why, "ref": r.get("ref")}) + "\n")
                    print(f"#{n} closed: {why} (head pinned at {r.get('ref')})")
                else:
                    print(f"#{n} kept open: {r['reason']}")
            except Exception as e:
                print(f"#{n} close failed: {e}")
    print(json.dumps({"open": len(prs), "closable": [n for n, _ in close], "stale": stale, "unmeasured": unread}))
    return 1 if "--check" in argv and stale else 0
if __name__ == "__main__": sys.exit(main(sys.argv[1:]))
