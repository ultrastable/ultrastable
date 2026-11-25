# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""FULLSTACK-1 (Rowan, 2026-11-25): every Ultrastable system deploys itself in full: repository, back end and public web front end.
Ultrastable is the foundation for any autonomous system.

  python3 -m foundation fullstack --check        every system has all three parts declared, or an open queue item for the part it lacks
  python3 -m foundation fullstack --live         fetch each front end and back end; exit 1 when one does not answer (daily in tenant-repos.yml)
  python3 -m foundation fullstack --probe ID     closing probe of Q-FULLSTACK-<ID>: passes when that system declares all three parts
  python3 -m foundation fullstack --list         one line per system

Data: doctrine/full-stack.json, instances/ultrastable/progress.json, doctrine/seed-deploys.json. Tests: tests/foundation/test_fullstack.py.
Visitor apps are judged by deploy/launch-apps.mjs stackOf() on every launch run."""
from __future__ import annotations
import json, re, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
POLICY = "doctrine/full-stack.json"
RULE = "FULLSTACK-1"
RULE_FILES = ["agents/AGENTS.md", "seed/agents/AGENTS.md", "agents/PROJECT-INSTRUCTIONS.md"]
PARTS = ("repo", "backend", "frontend")


def _j(root, rel):
    return json.loads((Path(root) / rel).read_text(encoding="utf-8"))


def _verify_url(root, sid):
    """A system's own lifecycle.json names the back-end address its watchdog fetches; a new tenant needs no row here."""
    f = Path(root) / "instances" / sid / "lifecycle.json"
    if not f.exists():
        return None
    return (json.loads(f.read_text(encoding="utf-8")).get("verify") or {}).get("url")


def systems(root=REPO) -> list[dict]:
    """One row per system with whatever parts it declares. A part it does not declare is None."""
    root, pol = Path(root), _j(root, POLICY)
    rows = {s["id"]: {"id": s["id"], "repo": s.get("repo"), "frontend": s.get("url")} for s in _j(root, "instances/ultrastable/progress.json").get("systems", [])}
    for slug in _j(root, "doctrine/seed-deploys.json").get("seeds", []):
        rows.setdefault(slug, {"id": slug, "repo": None, "frontend": None})
    for sid, r in rows.items():
        p = pol.get("systems", {}).get(sid, {})
        r["backend"] = p.get("backend") or _verify_url(root, sid)
        r["repo"] = r["repo"] or p.get("repo")
        r["frontend"] = r["frontend"] or p.get("frontend")
        r["gaps"] = p.get("gaps", {})
    return list(rows.values())


def _open(root, item) -> bool:
    f = Path(root) / "docs/issues" / f"{item}.json"
    return f.exists() and "**Status:** closed" not in f.read_text(encoding="utf-8")


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    for s in systems(root):
        for part in PARTS:
            v = s.get(part)
            ok = bool(re.fullmatch(r"[\w.-]+/[\w.-]+", v or "")) if part == "repo" else str(v or "").startswith("https://")
            item = s["gaps"].get(part)
            if ok and item:
                bad.append(f"{s['id']}: {part} is declared, so its gap ({item}) should be removed")
            elif not ok and not item:
                bad.append(f"{s['id']}: no {part} and no queue item building one ({RULE}: repository, back end and public front end)")
            elif not ok and not _open(root, item):
                bad.append(f"{s['id']}: no {part}, and its item {item} is missing or closed")
    known = {s["id"] for s in systems(root)}
    bad += [f"{sid}: row in {POLICY} for a system that is not in progress.json or seed-deploys.json" for sid in _j(root, POLICY).get("systems", {}) if sid not in known]
    for rel in RULE_FILES:
        p = root / rel
        if not p.exists() or RULE not in p.read_text(encoding="utf-8"):
            bad.append(f"{rel}: rule {RULE} missing")
    return bad


def _fetch(url, ua, timeout=20):
    try:
        req = urllib.request.Request(url, headers={"user-agent": ua, "accept": "*/*"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("content-type", ""), r.read(4000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("content-type", ""), e.read(4000).decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001  a refused or timed-out fetch is the reading
        return 0, "", str(e)[:200]


def live(root=REPO, fetch=_fetch) -> list[dict]:
    """A front end answers 200 with HTML. A back end answers with JSON (a seed's /health says 503 with a JSON report until its first tick ends)."""
    ua, out = _j(root, POLICY).get("user_agent", "ultrastable-fullstack-probe/1"), []
    for s in systems(root):
        row = {"id": s["id"], "repo": "declared" if s.get("repo") else "missing"}
        if s.get("frontend"):
            st, ct, body = fetch(s["frontend"], ua)
            row["frontend"] = "live" if st == 200 and ("html" in ct or "<html" in body.lower()) else f"down ({st})"
        else:
            row["frontend"] = "missing"
        if s.get("backend"):
            st, ct, body = fetch(s["backend"], ua)
            row["backend"] = "live" if st in (200, 503) and ("json" in ct or body.lstrip()[:1] in "{[") and body.strip() else f"down ({st})"
        else:
            row["backend"] = "missing"
        row["ok"] = all(row[p] in ("live", "declared") for p in PARTS)
        out.append(row)
    return out


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--list" in argv:
        for s in systems():
            print(f"{s['id']}: " + ", ".join(f"{p} {s.get(p) or 'MISSING (' + s['gaps'].get(p, 'no item') + ')'}" for p in PARTS))
        return 0
    if "--probe" in argv:
        sid = argv[argv.index("--probe") + 1]
        s = next((x for x in systems() if x["id"] == sid), None)
        miss = [p for p in PARTS if not (s or {}).get(p)]
        print(f"{sid}: " + ("all three parts declared" if s and not miss else "missing " + ", ".join(miss or ["the system itself"])))
        return 0 if s and not miss else 1
    if "--live" in argv:
        rows = live()
        for r in rows:
            print(("ok   " if r["ok"] else "FAIL ") + f"{r['id']}: repo {r['repo']}, back end {r['backend']}, front end {r['frontend']}")
        print(json.dumps({"systems": len(rows), "complete": sum(r["ok"] for r in rows)}))
        return 0 if all(r["ok"] for r in rows) else 1
    bad = check()
    for b in bad:
        print("FAIL " + b)
    print("fullstack ok: every system has a repository, a back end and a public front end, or an open item for the part it lacks" if not bad else f"fullstack: {len(bad)} problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
