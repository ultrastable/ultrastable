#!/usr/bin/env python3
"""CI-DOCTOR-1: the fleet watches its own GitHub Actions and files, diagnoses and closes issues for failing workflows.
Reads recent runs of every repo in REPOS (a repo it cannot read is reported unmeasured, never ok), ignores pull_request runs
(the PR's author owns them), and keeps one issue per failing workflow in this repository (label ci-doctor). The diagnosis comes from
GitHub Models with the built-in token (no secret); when that is unavailable the failure is logged, never swallowed.
Usage: ci_doctor.py [--dry-run]. Needs GH_TOKEN (issues: write, actions: read, models: read)."""
import json, os, sys, urllib.request, urllib.error, datetime

API = "https://api.github.com"
HOME = os.environ.get("GITHUB_REPOSITORY", "ultrastable/ultrastable")
REPOS = ["ultrastable/ultrastable", "ultrastable/workers", "ultrastable/ops", "ultrastable/practical-solutions"]
LABEL = "ci-doctor"
MODEL = "openai/gpt-4.1-mini"

def call(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None, headers={
        "Authorization": f"Bearer {os.environ['GH_TOKEN']}", "Accept": "application/vnd.github+json", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}

def failing_workflows(runs):
    """Latest completed non-PR run per workflow; failing when its conclusion is failure or timed_out. Pure, tested."""
    latest = {}
    for r in sorted(runs, key=lambda r: r["created_at"]):
        if r.get("event") == "pull_request" or r.get("conclusion") in (None, "cancelled", "skipped"):
            continue
        latest[r["name"]] = r
    return {n: r for n, r in latest.items() if r["conclusion"] in ("failure", "timed_out")}, set(latest)

def diagnose(repo, run, name):
    jobs = call("GET", f"{API}/repos/{repo}/actions/runs/{run['id']}/jobs")["jobs"]
    steps = [f"{j['name']} / {s['name']}" for j in jobs for s in j.get("steps", []) if s.get("conclusion") == "failure"]
    facts = f"Workflow {name} in {repo} failed on {run['event']} run {run['html_url']}. Failed steps: {steps or 'none recorded (job failed before any step)'}."
    try:
        out = call("POST", "https://models.github.ai/inference/chat/completions", {"model": MODEL, "messages": [
            {"role": "system", "content": "You are a CI engineer. In 5 lines: likely root cause and the concrete code change that fixes it."},
            {"role": "user", "content": facts}]})
        return facts + "\n\nDiagnosis (" + MODEL + "):\n" + out["choices"][0]["message"]["content"]
    except (urllib.error.URLError, KeyError) as e:
        print(f"::warning::diagnosis model unavailable: {e}")
        return facts + "\n\nDiagnosis unavailable (models call failed); the failed steps above are the lead."

def main(dry):
    since = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=2)).strftime("%Y-%m-%d")
    open_issues = {i["title"]: i for i in call("GET", f"{API}/repos/{HOME}/issues?labels={LABEL}&state=open&per_page=100")}
    seen, unmeasured = set(), []
    for repo in REPOS:
        try:
            runs = call("GET", f"{API}/repos/{repo}/actions/runs?status=completed&created=>={since}&per_page=100")["workflow_runs"]
        except urllib.error.HTTPError as e:
            unmeasured.append(f"{repo} (HTTP {e.code})")
            continue
        bad, names = failing_workflows(runs)
        for name, run in bad.items():
            title = f"ci-doctor: {repo}/{name} is failing"
            seen.add(title)
            print(f"failing: {title}")
            if title not in open_issues and not dry:
                call("POST", f"{API}/repos/{HOME}/issues", {"title": title, "labels": [LABEL], "body": diagnose(repo, run, name) +
                     "\n\nOwner: the fleet. Trigger: next ci-doctor run. Closing probe: the latest non-PR run of this workflow succeeds; ci-doctor closes this issue itself."})
        for name in names - set(bad):
            t = f"ci-doctor: {repo}/{name} is failing"
            if t in open_issues and not dry:
                call("POST", f"{API}/repos/{HOME}/issues/{open_issues[t]['number']}/comments", {"body": "Latest run succeeded; closing."})
                call("PATCH", f"{API}/repos/{HOME}/issues/{open_issues[t]['number']}", {"state": "closed", "state_reason": "completed"})
                print(f"closed: {t}")
    for u in unmeasured:
        print(f"::warning::unmeasured (not ok): {u}")
    print(f"ci-doctor: {len(seen)} failing, {len(unmeasured)} unmeasured")
    return 0

if __name__ == "__main__":
    sys.exit(main("--dry-run" in sys.argv))
