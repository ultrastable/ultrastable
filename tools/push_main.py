# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""MAIN-WRITER-1: replaces `git push origin HEAD:main` in workflows. Sends the files of the last local commit to the tick Worker, which verifies this run's
GitHub Actions OIDC token and writes one commit to main with the org's GitHub App (exempt from the main ruleset). Needs `permissions: id-token: write`.
Appended ledger lines go as appends, so concurrent writers never overwrite each other. Exit 0 only when the commit landed on main or the Worker opened a pull request that carries it (MAIN-WRITER-PR-1)."""
import base64, json, os, subprocess, sys, time, urllib.request, urllib.error

MAX_FILES = 20  # seed/worker/src/maincommit.js MAX_FILES
URL = os.environ.get("MAIN_WRITER_URL", "https://ultrastable-tick.ultrastable.workers.dev/api/main/commit")

def git(*a):
    return subprocess.run(["git", *a], check=True, capture_output=True).stdout

def changes(rev="HEAD"):
    out = []
    for line in git("diff-tree", "--no-commit-id", "--name-status", "-r", "--no-renames", rev).decode().splitlines():
        st, path = line.split("\t", 1)
        if st == "D":
            out.append({"path": path, "delete": True}); continue
        new = git("show", f"{rev}:{path}")
        try:
            old = git("show", f"{rev}~1:{path}")
        except subprocess.CalledProcessError:
            old = None
        if old is not None and new.startswith(old) and path.endswith((".jsonl", ".ndjson", ".log")):
            out.append({"path": path, "append": base64.b64encode(new[len(old):]).decode()})
        else:
            out.append({"path": path, "content": base64.b64encode(new).decode()})
    return out

def oidc():
    u, t = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL"), os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if not (u and t):
        raise SystemExit("push_main: no OIDC token; the job needs `permissions: id-token: write`")
    r = urllib.request.Request(u + "&audience=ultrastable-main", headers={"authorization": "Bearer " + t})
    return json.load(urllib.request.urlopen(r, timeout=20))["value"]

def main():
    msg = git("log", "-1", "--format=%s").decode().strip()
    # Commits by the GitHub App trigger push workflows (workflow-token pushes never did): a deploy record then starts regen-generated, whose commit
    # touches site/ and starts the deploy again, without end (seen live 2026-11-18 12:17 UTC). Data commits therefore carry [skip ci].
    if "[skip ci]" not in msg:
        msg += " [skip ci]"
    files = changes()
    # PUSH-MAIN-BATCH-1: the Worker writes at most MAX_FILES (seed/worker/src/maincommit.js) per commit, so a fleet pass that changed 100+ queue
    # items got HTTP 400 and fell back to a direct push the ruleset refuses (2026-11-19). Larger changes land as consecutive commits of MAX_FILES.
    parts = [files[i:i + MAX_FILES] for i in range(0, len(files), MAX_FILES)] or [[]]
    for n, part in enumerate(parts, 1):
        m = msg if len(parts) == 1 else msg.replace(" [skip ci]", f" (part {n}/{len(parts)}) [skip ci]")
        if post(m, part) != 0:
            return fallback() if n == 1 else 1  # after a part has landed, a direct push would duplicate it: fail loudly instead
    return 0

def post(msg, files):
    body = json.dumps({"message": msg, "files": files}).encode()
    for attempt in range(1, 5):
        req = urllib.request.Request(URL, data=body, method="POST", headers={"authorization": "Bearer " + oidc(), "content-type": "application/json", "user-agent": "ultrastable-push-main/1"})  # Cloudflare answers 403 (error 1010) to the default Python-urllib agent
        try:
            res = json.load(urllib.request.urlopen(req, timeout=40))
            print("push_main: landed", res.get("sha")); return 0
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:300]
            print(f"push_main: HTTP {e.code} (try {attempt}): {detail}", file=sys.stderr)
            if e.code not in (409, 502, 503): return 1
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"push_main: {e} (try {attempt})", file=sys.stderr)
        time.sleep(attempt * 3)
    return 1

def fallback():
    # Rollout safety: until the ruleset on main is active a plain push still lands. Once it is active GitHub refuses this and the step fails loudly.
    print("push_main: the Worker route did not land the commit; trying a direct push", file=sys.stderr)
    for _ in range(3):
        if subprocess.run(["git", "pull", "--rebase", "-q", "origin", "main"]).returncode == 0 and subprocess.run(["git", "push", "-q", "origin", "HEAD:main"]).returncode == 0:
            return 0
        time.sleep(3)
    return 1

if __name__ == "__main__":
    try:
        rc = main()
    except SystemExit as e:  # no OIDC token in this job: the Worker route cannot start, so the second route still runs
        print(f"push_main: worker route unavailable: {e}", file=sys.stderr); rc = fallback()
    sys.exit(rc)
