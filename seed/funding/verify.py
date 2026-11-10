#!/usr/bin/env python3
"""Check funding/registry.json for stale, expiring, passed or unreachable entries.

Usage: verify.py [--fetch] [--today YYYY-MM-DD] [--out report.json]
Exit code is 0 when the check ran; findings are in the report. Failures to fetch are findings, never swallowed.
"""
import argparse, datetime, json, pathlib, sys, urllib.request, urllib.error

HERE = pathlib.Path(__file__).resolve().parent
REG = HERE / "registry.json"


def check(reg, today, fetch):
    findings = []
    for it in reg["items"]:
        lv = datetime.date.fromisoformat(it["last_verified"])
        age = (today - lv).days
        limit = reg["max_age_days"] if it["status"] == "verified" else reg["max_age_days"] // 2
        if age > limit:
            findings.append({"id": it["id"], "kind": "stale", "detail": f"last verified {age} days ago (limit {limit}, status {it['status']})"})
        if it["status"] == "unverified":
            findings.append({"id": it["id"], "kind": "unverified", "detail": "no primary-source read yet"})
        if it.get("deadline"):
            dl = datetime.date.fromisoformat(it["deadline"])
            days = (dl - today).days
            if days < 0:
                findings.append({"id": it["id"], "kind": "deadline-passed", "detail": f"deadline {it['deadline']} passed; find the next one"})
            elif days <= reg["deadline_warn_days"]:
                findings.append({"id": it["id"], "kind": "deadline-soon", "detail": f"deadline {it['deadline']} in {days} days"})
        if fetch:
            try:
                req = urllib.request.Request(it["url"], headers={"User-Agent": "ultrastable-funding-check"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    if r.status >= 400:
                        findings.append({"id": it["id"], "kind": "url-error", "detail": f"HTTP {r.status}"})
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                findings.append({"id": it["id"], "kind": "url-error", "detail": str(e)})
    return findings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--today", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--registry", default=None)
    a = ap.parse_args()
    today = datetime.date.fromisoformat(a.today) if a.today else datetime.date.today()
    reg = json.loads(pathlib.Path(a.registry or REG).read_text())
    findings = check(reg, today, a.fetch)
    out = {"checked": today.isoformat(), "items": len(reg["items"]), "findings": findings}
    text = json.dumps(out, indent=2)
    if a.out:
        pathlib.Path(a.out).write_text(text)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
