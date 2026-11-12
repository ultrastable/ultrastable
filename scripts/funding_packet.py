#!/usr/bin/env python3
"""Validate application packets against the funding registry and write a status tracker.

Usage: funding_packet.py [--today YYYY-MM-DD] [--out STATUS.md]
Each business/funding/applications/<name>/packet.json names a registry id. Findings: unknown registry id,
banned term in an answer, missing field, stale verification, prerequisite not met. A packet with an
applicant.json whose identity fields are all set and every prerequisite met is `ready`.
Exit 0 when the check ran; findings are printed as JSON and never swallowed.
"""
import argparse, datetime, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "business" / "funding"
REQUIRED = ["registry_id", "program", "status", "form_url", "verified_on", "prerequisites", "answers", "submit_steps", "default_in_effect", "closing_probe"]
STATUSES = {"drafted", "ready", "submitted", "decided", "rejected"}


def load_packets():
    for p in sorted((ROOT / "applications").glob("*/packet.json")):
        if p.parent.name.startswith("_"):
            continue
        yield p, json.loads(p.read_text())


def evaluate(path, pk, reg_ids, today):
    f = []
    name = path.parent.name
    for k in REQUIRED:
        if k not in pk:
            f.append({"packet": name, "kind": "missing-field", "detail": k})
    if pk.get("registry_id") not in reg_ids:
        f.append({"packet": name, "kind": "unknown-registry-id", "detail": str(pk.get("registry_id"))})
    if pk.get("status") not in STATUSES:
        f.append({"packet": name, "kind": "bad-status", "detail": str(pk.get("status"))})
    for term in pk.get("banned_terms", []):
        for q, a in pk.get("answers", {}).items():
            if re.search(re.escape(term), a, re.I):
                f.append({"packet": name, "kind": "banned-term", "detail": f"'{term}' in answer '{q}'"})
    if "verified_on" in pk:
        age = (today - datetime.date.fromisoformat(pk["verified_on"])).days
        if age > 30 and pk.get("status") in {"drafted", "ready"}:
            f.append({"packet": name, "kind": "stale", "detail": f"terms verified {age} days ago; re-read the program page"})
    unmet = [r["id"] for r in pk.get("prerequisites", []) if not r.get("met")]
    app = path.parent / "applicant.json"
    ident_ok = False
    if app.exists():
        a = json.loads(app.read_text())
        ident_ok = all(v for k, v in a.items() if not k.startswith("_"))
    if ident_ok:
        unmet = [u for u in unmet if u not in {"entity", "domain-email", "billing"}]
    state = pk.get("status")
    if state == "drafted" and not unmet and ident_ok:
        state = "ready"
    if unmet and state in {"drafted", "ready"}:
        f.append({"packet": name, "kind": "prerequisites-unmet", "detail": ", ".join(unmet)})
    return state, unmet, f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--today")
    ap.add_argument("--out", default=str(ROOT / "applications" / "STATUS.md"))
    a = ap.parse_args()
    today = datetime.date.fromisoformat(a.today) if a.today else datetime.date.today()
    reg_ids = {i["id"] for i in json.loads((ROOT / "registry.json").read_text())["items"]}
    findings, rows = [], []
    for path, pk in load_packets():
        state, unmet, f = evaluate(path, pk, reg_ids, today)
        findings += f
        rows.append(f"| {path.parent.name} | {pk.get('registry_id')} | {state} | {', '.join(unmet) or 'none'} | {pk.get('verified_on')} | {pk.get('closing_probe')} |")
    ev = pathlib.Path(__file__).resolve().parent.parent / "business" / "investor" / "evidence.json"
    if not ev.is_file():
        findings.append({"packet": "*", "kind": "no-evidence", "detail": "run python3 -m foundation components --evidence"})
    else:
        for o in json.loads(ev.read_text())["objections"]:
            if o["verdict"] == "invalid":
                findings.append({"packet": "*", "kind": "invalid-claim", "detail": f"objection {o['id']}: a competitor offers this natively ({', '.join(o['competitors_offering'])}); do not use the claim"})
    md = [f"# Application status (generated {today.isoformat()})\n", "| Packet | Registry | Status | Unmet prerequisites | Terms verified | Closing probe |", "|---|---|---|---|---|---|"] + rows
    pathlib.Path(a.out).write_text("\n".join(md) + "\n")
    print(json.dumps({"checked": today.isoformat(), "packets": len(rows), "findings": findings}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
