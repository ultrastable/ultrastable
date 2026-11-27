# SPDX-License-Identifier: LicenseRef-Ultrastable
# JOB-TRUST-1 (ZHC-R12): no workflow job holds untrusted text, secrets and write access at once (the rule of two, per job).
# python3 -m foundation jobtrust --check   fails a job that holds all three and is not on the shrink-only baseline in doctrine/job-trust.json.
import json, re, sys
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parent.parent
UNTRUSTED = re.compile(r"github\.event\.(issue|pull_request|comment|review|review_comment|discussion)\.(title|body)|github\.head_ref|github\.event\.head_commit\.message|github\.event\.client_payload")
SECRET = re.compile(r"secrets\.(?!GITHUB_TOKEN\b)\w+")
WRITE = re.compile(r"\b(contents|pull-requests|issues|actions|deployments|id-token|statuses|checks|packages)\s*:\s*write\b|write-all")


def jobs_of(path):
    """Yield (job id, holds) for each job of one workflow file, `holds` being the subset of {untrusted, secrets, write}."""
    text = path.read_text()
    doc = yaml.safe_load(text) or {}
    wf_perm = json.dumps(doc.get("permissions") or "")
    for jid, job in (doc.get("jobs") or {}).items():
        blob = json.dumps(job)
        held = set()
        if UNTRUSTED.search(blob): held.add("untrusted")
        if SECRET.search(blob): held.add("secrets")
        if WRITE.search((json.dumps(job.get("permissions") or "") + (wf_perm if "permissions" not in job else "")).replace('"', "")): held.add("write")
        yield jid, held


def scan(root=ROOT):
    out = []
    for p in sorted((root / ".github" / "workflows").glob("*.yml")):
        try:
            for jid, held in jobs_of(p):
                if len(held) == 3: out.append(f"{p.name}:{jid}")
        except yaml.YAMLError as e:
            out.append(f"{p.name}:unreadable ({e.__class__.__name__})")
    return out


def check(root=ROOT):
    base = json.loads((root / "doctrine" / "job-trust.json").read_text()).get("baseline", [])
    found = scan(root)
    new = [f for f in found if f not in base]
    stale = [b for b in base if b not in found]
    for n in new: print("FAIL  new job holds untrusted text, secrets and write access:", n)
    for s in stale: print("FAIL  baseline entry no longer needed, remove it:", s)
    print(f"jobtrust: {len(found)} job(s) hold all three, {len(base)} on the baseline")
    return 1 if new or stale else 0


def main(argv=None):
    return check()


if __name__ == "__main__":
    sys.exit(main())
