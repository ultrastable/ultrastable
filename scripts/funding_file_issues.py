#!/usr/bin/env python3
"""Turn funding_verify.py findings into GitHub issues, one open issue per (program, kind). Uses gh; failures are raised."""
import json, os, pathlib, re, subprocess, sys

LABEL = "funding-maintenance"


def gh(*args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"gh {' '.join(args[:2])} failed: {r.stderr.strip()}")
    return r.stdout


def issues_on():
    return gh("api", "repos/" + os.environ["GITHUB_REPOSITORY"], "--jq", ".has_issues").strip() != "false"


def to_queue(report):
    """QUEUE-1: Issues are off on the code repository, so each finding becomes a queue item (docs/issues/FUND-*.json) that the executor works."""
    out = pathlib.Path("docs/issues")
    for f in report["findings"]:
        iid = "FUND-" + re.sub(r"[^A-Za-z0-9]+", "-", f"{f['id']}-{f['kind']}").strip("-")
        nl = chr(10)
        body = nl.join(["**Owner:** executor", "**Trigger:** funding-maintenance finding, executor tick", f"**Done check:** grep:docs/issues/{iid}.json::Status:.{{0,4}}closed", "**Status:** open", "", f["detail"], "", "Registry: business/funding/registry.json", f"Checked: {report['checked']}"])
        (out / (iid + ".json")).write_text(json.dumps({"id": iid, "title": f"{iid}: {f['kind']}", "body": body, "labels": ["p2", "funding-maintenance"]}, indent=2) + nl, encoding="utf-8")
        print("queued", iid)


def main(path):
    report = json.load(open(path))
    if not issues_on():
        return to_queue(report)
    gh("label", "create", LABEL, "--force", "--description", "Funding registry upkeep")
    for f in report["findings"]:
        title = f"[funding] {f['id']}: {f['kind']}"
        existing = json.loads(gh("issue", "list", "--label", LABEL, "--state", "open", "--search", f"\"{title}\" in:title", "--json", "number,title"))
        body = (f"{f['detail']}\n\nRegistry: business/funding/registry.json\nProcedure: business/funding/MAINTENANCE.md\n"
                f"Closing probe: scripts/funding_verify.py shows no `{f['kind']}` finding for {f['id']}.\nChecked: {report['checked']}")
        match = [i for i in existing if i["title"] == title]
        if match:
            gh("issue", "comment", str(match[0]["number"]), "--body", f"Still open on {report['checked']}: {f['detail']}")
        else:
            gh("issue", "create", "--title", title, "--body", body, "--label", LABEL)


if __name__ == "__main__":
    main(sys.argv[1])
