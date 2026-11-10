#!/usr/bin/env bash
# Run once the GitHub organization exists (GitHub has no API to create one). Needs the gh CLI signed in with repo + project scopes.
# Usage: ORG=<org name> ./github/bootstrap-github.sh
set -euo pipefail
ORG="${ORG:?set ORG}"; REPO="$ORG/ultrastable"
gh repo create "$REPO" --private --source=. --remote=origin --push
python3 - "$REPO" <<'PY'
import json,subprocess,sys
repo=sys.argv[1]
for i in json.load(open("github/issues.json")):
    cmd=["gh","issue","create","-R",repo,"-t",i["title"],"-b",i["body"]]
    for l in i["labels"]: cmd+=["-l",l]
    subprocess.run(["gh","label","create","-R",repo,l,"-f"],capture_output=True) if False else None
    subprocess.run(cmd,check=False)
PY
gh project create --owner "$ORG" --title "Ultrastable roadmap" || true
echo "Add the issues to the project board using github/roadmap.json (Now / Next / Later)."
