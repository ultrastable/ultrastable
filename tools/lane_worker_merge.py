# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""LANE-WORKER-MERGE-1: ask the tick Worker to merge a PR the Actions token cannot (it changes .github/workflows/**). Usage: lane_worker_merge.py PR SHA.
The run's OIDC token (permissions: id-token: write) proves the caller; the Worker re-checks every gate and merges with the org GitHub App. Exit 0 = merged."""
import json, os, sys, urllib.request, urllib.error

URL = os.environ.get("LANE_MERGE_URL", "https://ultrastable-tick.ultrastable.workers.dev/api/lane/merge")

def oidc():
    u, t = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL"), os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if not (u and t):
        raise SystemExit("lane_worker_merge: no OIDC token; the job needs `permissions: id-token: write`")
    r = urllib.request.Request(u + "&audience=ultrastable-main", headers={"authorization": "Bearer " + t})
    return json.load(urllib.request.urlopen(r, timeout=20))["value"]

def main(argv):
    pr, sha = int(argv[0]), argv[1]
    req = urllib.request.Request(URL, data=json.dumps({"pr": pr, "sha": sha}).encode(), method="POST",
                                 headers={"authorization": "Bearer " + oidc(), "content-type": "application/json", "user-agent": "ultrastable-lane-merge/1"})
    try:
        res = json.load(urllib.request.urlopen(req, timeout=40))
        print("lane_worker_merge: merged", res.get("sha")); return 0
    except urllib.error.HTTPError as e:
        print(f"lane_worker_merge: HTTP {e.code}: {e.read().decode()[:200]}", file=sys.stderr); return 1
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"lane_worker_merge: {e}", file=sys.stderr); return 1

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
