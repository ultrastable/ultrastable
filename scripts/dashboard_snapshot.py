#!/usr/bin/env python3
"""Build dashboard/snapshot.json: one read-only view of funding and outreach, IP status, trust, open owner cards and bootstrap gaps.

Usage: dashboard_snapshot.py [--today YYYY-MM-DD] [--out dashboard/snapshot.json]
Every value is read from a file in this repository, so the snapshot is as true as the repo. The dashboard worker stores the posted
snapshot and renders `panels` as is; nothing here is a claim the repo cannot back. Failures to read a source are listed in `problems`.
"""
import argparse, collections, datetime, json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def jload(rel, problems):
    p = ROOT / rel
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError) as e:
        problems.append(f"{rel}: {type(e).__name__}: {e}")
        return None


def table_rows(text, start, end=None):
    seg = text.split(start, 1)[-1]
    if end:
        seg = seg.split(end, 1)[0]
    rows = []
    for line in seg.splitlines():
        if line.startswith("|") and not re.match(r"^\|[-\s|]+\|?$", line):
            rows.append([c.strip() for c in line.strip().strip("|").split("|")])
    return rows


def build(today):
    problems = []
    panels = []

    # ---- funding and outreach
    reg = jload("business/funding/registry.json", problems) or {"items": []}
    st = jload("outreach/status.json", problems) or {"metrics": {}, "owner_cards": [], "targets": [], "trust": {}}
    by_track = collections.Counter(i["track"] for i in reg["items"])
    by_status = collections.Counter(i["status"] for i in reg["items"])
    m = st["metrics"]
    rows = [["Programmes in registry", f"{len(reg['items'])} (open source {by_track['A']}, startup {by_track['B']}, research {by_track['R']})", "info"],
            ["Source status", ", ".join(f"{k} {v}" for k, v in sorted(by_status.items())), "warn" if by_status.get("unverified") else "ok"],
            ["Outreach mode", f"{st.get('mode', '?')}; kill switch {'ON' if st.get('kill') else 'off'}; sender identity {'registered' if st.get('sender_registered') else 'not registered'}", "warn" if st.get("mode") != "live" else "ok"],
            ["Targets", f"{m.get('targets', 0)} in pipeline: queued {m.get('state_queued', 0)}, awaiting owner {m.get('state_awaiting-owner', 0)}, sent {m.get('outreach_sent_total', 0)}, replies {m.get('outreach_replies_total', 0)}", "info"],
            ["Waiting on source verification", str(m.get("blocked_source_unverified", 0)), "warn" if m.get("blocked_source_unverified") else "ok"]]
    ap = ROOT / "business/funding/applications"
    for pj in sorted(ap.glob("*/packet.json")):
        if pj.parent.name.startswith("_"):
            continue
        pk = json.loads(pj.read_text())
        rows.append([f"Application: {pk['program'][:60]}", f"{pk['status']}; blocked by {', '.join(pk.get('blocked_by', [])) or 'nothing'}", "warn" if pk.get("blocked_by") else "ok"])
    panels.append({"id": "funding", "title": "Funding and outreach pipeline", "rows": rows})

    # ---- IP
    gate = jload("social/gate.json", problems) or {}
    ev = (ROOT / "ip/evidence-log.md").read_text() if (ROOT / "ip/evidence-log.md").exists() else ""
    receipts = [r for r in table_rows(ev, "|---") if re.search(r"filing receipt|application number", " ".join(r), re.I)]
    panels.append({"id": "ip", "title": "IP status", "rows": [
        ["Priority application", "filed" if gate.get("provisional_filed") else "not filed (the owner's signature and payment; owner card FILE-PRIORITY)", "ok" if gate.get("provisional_filed") else "warn"],
        ["Filing receipts in evidence log", str(len(receipts)), "ok" if receipts else "warn"],
        ["Filing package", "ip/provisional (spec, drawings) and ip/europe (Dutch filing set); not legal advice, attorney questions open in ip/europe/DECISION-MEMO.md", "info"],
        ["Public content rule", "generic only until a filing receipt is recorded; nothing is asserted about prior publication", "info"]]})

    # ---- trust
    rows = [[k, f"reliability {v['reliability']} from {v['outcomes']} outcomes", "info"] for k, v in sorted(st.get("trust", {}).items())]
    pol = jload("seed/autonomy/policy.json", problems)
    if pol:
        rows.append(["Ladder start rung per surface", ", ".join(f"{k}: {v['start_rung']}" for k, v in pol["surfaces"].items()), "info"])
    panels.append({"id": "trust", "title": "Trust ledger (from recorded outcomes)", "rows": rows or [["no outcomes yet", "", "info"]]})

    # ---- owner cards
    mem = (ROOT / "docs/PROJECT-MEMORY.md").read_text()
    cards = []
    for r in table_rows(mem, "## 4. Owner-only items", "## 5.")[1:]:
        cards.append([r[0][:140], "default: " + (r[1] if len(r) > 1 else "") + (" | probe: " + r[2] if len(r) > 2 else ""), "warn"])
    for c in st.get("owner_cards", []):
        cards.append([f"{c['id']} ({c['count']})", "outreach card; default in effect: not sent. " + c["file"], "warn"])
    panels.append({"id": "cards", "title": "Open owner cards (identity-bound)", "rows": cards or [["none", "", "ok"]]})

    # ---- bootstrap gaps
    gaps = (ROOT / "docs/BOOTSTRAP-GAPS.md").read_text()
    counts = collections.Counter()
    open_gaps = []
    for r in table_rows(gaps, "| ID | What failed", "## Surfaces"):
        if r and r[0].startswith("BG-"):
            status = r[-1]
            k = "fixed" if re.match(r"(Fixed|Built|Running)", status) else "open"
            counts[k] += 1
            if k == "open":
                open_gaps.append([r[0], r[1][:110] + " | " + status[:80], "warn"])
    lib = jload("seed/bootstrap/cases.json", problems) or {"cases": []}
    panels.append({"id": "bootstrap", "title": "Bootstrap gaps and cases", "rows": [
        ["Gaps", f"{counts['fixed']} fixed or built, {counts['open']} open (docs/BOOTSTRAP-GAPS.md)", "warn" if counts["open"] else "ok"],
        ["Bootstrap case library", f"{len(lib['cases'])} starting conditions with routes and at most one owner card each (seed/bootstrap/cases.json)", "info"]] + open_gaps[:12]})

    try:
        head = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError) as e:
        problems.append(f"git: {e}")
        head = ""
    return {"generated": today.isoformat(), "commit": head, "problems": problems, "panels": panels}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--today")
    ap.add_argument("--out", default=str(ROOT / "dashboard/snapshot.json"))
    a = ap.parse_args(argv)
    today = datetime.date.fromisoformat(a.today) if a.today else datetime.date.today()
    snap = build(today)
    pathlib.Path(a.out).write_text(json.dumps(snap, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps({"panels": [p["id"] for p in snap["panels"]], "problems": snap["problems"]}))
    return 1 if snap["problems"] else 0


if __name__ == "__main__":
    sys.exit(main())
