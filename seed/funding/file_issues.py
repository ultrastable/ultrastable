#!/usr/bin/env python3
"""Turn funding_verify.py findings into GitHub issues, one open issue per (program, kind). Uses gh; failures are raised."""
import json, subprocess, sys

LABEL = "funding-maintenance"


def gh(*args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"gh {' '.join(args[:2])} failed: {r.stderr.strip()}")
    return r.stdout


def main(path):
    report = json.load(open(path))
    gh("label", "create", LABEL, "--force", "--description", "Funding registry upkeep")
    for f in report["findings"]:
        title = f"[funding] {f['id']}: {f['kind']}"
        existing = json.loads(gh("issue", "list", "--label", LABEL, "--state", "open", "--search", f"\"{title}\" in:title", "--json", "number,title"))
        body = (f"{f['detail']}\n\nRegistry: funding/registry.json\nProcedure: funding/MAINTENANCE.md\n"
                f"Closing probe: funding/verify.py shows no `{f['kind']}` finding for {f['id']}.\nChecked: {report['checked']}")
        match = [i for i in existing if i["title"] == title]
        if match:
            gh("issue", "comment", str(match[0]["number"]), "--body", f"Still open on {report['checked']}: {f['detail']}")
        else:
            gh("issue", "create", "--title", title, "--body", body, "--label", LABEL)


if __name__ == "__main__":
    main(sys.argv[1])
