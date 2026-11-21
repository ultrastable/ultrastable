# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
# Ultrastable is the foundation for any autonomous system.

import sys
import os
import json
import urllib.parse
import urllib.request

# Environment variables injected by the Worker/System context
REPO_OWNER = os.getenv("GITHUB_REPOSITORY_OWNER")
REPO = os.getenv("GITHUB_REPOSITORY")
TOKEN = os.getenv("GITHUB_TOKEN")

API_BASE = "https://api.github.com"
HEADERS = {
    "Accept": "application/vnd.github.v3+json",
}

if TOKEN and REPO_OWNER and REPO:
    HEADERS["Authorization"] = f"token {TOKEN}"
else:
    print("Error: Missing GitHub credentials in environment.")
    sys.exit(1)

def get_checks_status(pr_number):
    """Fetch PR and verify its merge commit passed the 'checks' workflow."""
    pr_url = f"{API_BASE}/repos/{REPO}/pulls/{pr_number}"
    
    print(f"Auditing PR #{pr_number} from {REPO}...")

    try:
        with urllib.request.urlopen(urllib.request.Request(pr_url, headers=HEADERS)) as response:
            pr_data = json.loads(response.read())
    except urllib.error.HTTPError as e:
        print(f"Error fetching PR #{pr_number}: {e.code} {e.reason}")
        sys.exit(1)

    # Get the merge commit SHA
    merge_commit_sha = pr_data.get("merge_commit_sha")

    if not merge_commit_sha:
        print("Merge audit fails: No merge commit found (draft or not merged).")
        sys.exit(1)

    # Fetch Checks Runs for the commit
    runs_url = f"{API_BASE}/repos/{REPO}/commits/{merge_commit_sha}/checks-runs"
    
    try:
        with urllib.request.urlopen(urllib.request.Request(runs_url, headers=HEADERS)) as response:
            checks_data = json.loads(response.read())
    except urllib.error.HTTPError as e:
        print(f"Error fetching checks for {merge_commit_sha}: {e.code} {e.reason}")
        sys.exit(1)

    found_checks_failure = False

    for run in checks_data.get("check_runs", []):
        # Match the workflow name defined in .github/workflows/checks.yml
        # For safety, we look for 'checks' in the name or specific ID logic if needed
        if run.get("name") == "checks":
            status = run.get("status")
            conclusion = run.get("conclusion")
            
            print(f"Found 'checks' run: status={status}, conclusion={conclusion}")

            if status == "completed" and conclusion != "success":
                print(f"MERGE-AUDIT-1 VIOLATION: PR #{pr_number} merged incorrectly.")
                print(f"  Commit: {merge_commit_sha}")
                print(f"  Check Conclusion: {conclusion}")
                found_checks_failure = True
            elif status == "completed" and conclusion == "success":
                print("Checks passed. Merge audit succeeded.")
            else:
                # In progress or queued - assume failure for strict audit (vacuous compliance)
                print("Checks run is not completed. Failing audit to enforce strictness.")
                found_checks_failure = True

    if found_checks_failure:
        sys.exit(1)

if __name__ == "__main__":
    # Expecting argument: PR Number
    if len(sys.argv) < 2:
        print("Usage: python3 -m foundation mergeaudit <PR_NUMBER>")
        sys.exit(1)
    
    target_pr = sys.argv[1]
    
    if not target_pr.isdigit():
        print(f"Invalid PR number: {target_pr}")
        sys.exit(1)

    try:
        get_checks_status(target_pr)
    except Exception as e:
        print(f"Unexpected error during audit: {e}")
        sys.exit(1)
