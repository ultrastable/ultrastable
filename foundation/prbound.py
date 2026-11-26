"""PR-BOUND-1 (2026-11-26): no pull request stays open for hours. Rowan: "Why are PRs open for 10 hours? (or even 1 hour!?)".
Root cause: the lane labelled a conflicted or failed session PR and waited for the executor, whose model calls were all failing, and nothing
bounded the wait. This runs model-free from the lane after its merge pass:
  --apply  closes a PR labelled `conflict` older than conflict_min or `ci-failed` older than failed_min (age = minutes since its last update),
           with a comment that names the reason; the branch is kept, so nothing is lost, and the row goes to ops/prbound.jsonl.
  --check  exits 1 while any open PR is older than max_open_h (detector `pr-age-bound`, failure mode fm-pr-stale).
A PR labelled `hold` is never closed. Read failures are unmeasured, never passed."""
import json, os, subprocess, sys, time
from datetime import datetime, timezone
CONF = {"conflict_min": 30, "failed_min": 60, "max_open_h": 2}
def _gh(*a):
    r = subprocess.run(["gh", *a], capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr.strip()[:200])
    return r.stdout
def _age_min(ts, now): return (now - datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()) / 60
def read(prs, now=None, conf=CONF):
    """prs: [{number, createdAt, updatedAt, labels:[{name}]}] -> (to_close [(n, reason)], stale [(n, hours)])."""
    now = now or time.time(); close, stale = [], []
    for p in prs:
        labels = {l["name"] for l in p.get("labels", [])}
        if "hold" in labels: continue
        upd = _age_min(p["updatedAt"], now)
        if "conflict" in labels and upd >= conf["conflict_min"]:
            close.append((p["number"], f"merge conflict with main unresolved for {int(upd)} min"))
        elif "ci-failed" in labels and upd >= conf["failed_min"]:
            close.append((p["number"], f"a failing check unrepaired for {int(upd)} min"))
        h = _age_min(p["createdAt"], now) / 60
        if h >= conf["max_open_h"]: stale.append((p["number"], round(h, 1)))
    return close, stale
def main(argv):
    repo = os.environ.get("GITHUB_REPOSITORY", "ultrastable/ultrastable")
    try:
        prs = json.loads(_gh("pr", "list", "-R", repo, "--state", "open", "--limit", "200", "--json", "number,createdAt,updatedAt,labels"))
    except Exception as e:
        print(json.dumps({"state": "unmeasured", "error": str(e)})); return 1
    close, stale = read(prs)
    if "--apply" in argv:
        for n, why in close:
            body = (f"lane (PR-BOUND-1): closed after {why}. The branch is kept; the change is carried onto current main by the next pass "
                    f"that takes its queue item (OL-PR-{n}). No pull request waits on a person.")
            try:
                _gh("pr", "close", str(n), "-R", repo, "--comment", body)
                with open("ops/prbound.jsonl", "a") as fh:
                    fh.write(json.dumps({"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "pr": n, "reason": why}) + "\n")
                print(f"#{n} closed: {why}")
            except Exception as e:
                print(f"#{n} close failed: {e}")
    print(json.dumps({"open": len(prs), "closable": [n for n, _ in close], "stale": stale}))
    return 1 if "--check" in argv and stale else 0
if __name__ == "__main__": sys.exit(main(sys.argv[1:]))
