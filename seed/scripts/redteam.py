# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""REDTEAM-1 in every seeded system: an adversarial reviewer that assumes this system's probes are wrong.

It reads the system's own ledgers and its live front end as a stranger would and files one work item per finding:
  unscored  a logged prediction names a metric no code in this repository measures, so it can never be wrong
  vacuous   a ledger row reports met, pass or ok on zero items (n = 0, count 0, empty)
  stale     the live front end shows an unfilled placeholder, or a JSON feed's newest date is days old
  owner     a failure the owner found first (scripts/redteam.py --owner ID --what TEXT), counted against the red team

The metric is owner_found_30d (target 0) against redteam_found_30d, written to ops/redteam/metric.json.

  python3 scripts/redteam.py --run [--apply] [--url https://...]   run the checks; --apply files docs/issues/RT-<id>.json and the ledger
  python3 scripts/redteam.py --probe                               exit 0 when no check finds anything
  python3 scripts/redteam.py --owner ID --what TEXT                record a failure the owner found first
"""
from __future__ import annotations
import datetime as dt, json, re, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEDGER, METRIC = "ops/redteam/findings.jsonl", "ops/redteam/metric.json"
PRED = re.compile(r"\b([a-z][a-z0-9_]{2,})\s*(?:>=|<=|==|>|<)\s*-?[\d.]+\s+within\s+\d+\s*h\b")
VACUOUS = re.compile(r'"(?:n|count|total|items)"\s*:\s*0\b[^\n]*"(?:status|verdict|result)"\s*:\s*"(?:met|pass|ok)"'
                     r'|"(?:status|verdict|result)"\s*:\s*"(?:met|pass|ok)"[^\n]*"(?:n|count|total|items)"\s*:\s*0\b')
NOW = lambda: dt.datetime.now(dt.timezone.utc)


def _code(root) -> str:
    buf = []
    for pat in ("**/*.py", "**/*.js", "**/*.mjs"):
        for f in Path(root).glob(pat):
            if "node_modules" in f.parts or "vendor" in f.parts or f.name == "redteam.py":
                continue
            try:
                buf.append(f.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError):
                continue
    return "\n".join(buf)


def ledgers(root):
    return [f for f in (Path(root) / "ops").rglob("*.jsonl") if "redteam" not in f.parts] if (Path(root) / "ops").is_dir() else []


def check_unscored(root=ROOT):
    names, code = {}, None
    for f in ledgers(root):
        for line in f.read_text(encoding="utf-8", errors="replace").splitlines()[-1:]:
            for m in PRED.finditer(line):
                names.setdefault(m.group(1), str(f.relative_to(root)))
    out = []
    for n, src in sorted(names.items()):
        code = code if code is not None else _code(root)
        if not re.search(r"[\"'`]" + re.escape(n) + r"[\"'`]", code):
            out.append({"id": f"unscored-{n}", "cls": "unscored", "what": f"predictions on {n} are logged but nothing measures {n}", "evidence": src})
    return out


def check_vacuous(root=ROOT):
    out = []
    for f in ledgers(root):
        for line in f.read_text(encoding="utf-8", errors="replace").splitlines()[-50:]:
            if VACUOUS.search(line):
                out.append({"id": f"vacuous-{f.stem}", "cls": "vacuous", "what": f"{f.name} reports met on zero items", "evidence": line[:160]})
                break
    return out


def _get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ultrastable-redteam/1"}), timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def check_live(url, get=_get, at=None):
    at, out = at or NOW(), []
    try:
        home = get(url.rstrip("/") + "/")
        if re.search(r"\{\{|\$\{|\bundefined\b|\bNaN\b|at commit generated", home):
            out.append({"id": "stale-placeholder", "cls": "stale", "what": "the front page shows an unfilled placeholder", "evidence": url})
    except Exception as e:
        return [{"id": "vacuous-site", "cls": "vacuous", "what": "the front end could not be read", "evidence": repr(e)[:160]}]
    for feed in ("/feed.json", "/progress.json"):
        try:
            dates = re.findall(r'"(?:date_published|date_modified|at|as_of)"\s*:\s*"(\d{4}-\d\d-\d\dT[^"]+)"', get(url.rstrip("/") + feed))
        except Exception:
            continue  # a system need not serve both feeds
        newest = max((dt.datetime.fromisoformat(d.replace("Z", "+00:00")) for d in dates), default=None)
        if newest is not None and (at - newest).days >= 3:
            out.append({"id": f"stale-{feed.strip('/').split('.')[0]}", "cls": "stale", "what": f"{feed} has nothing newer than {newest.date()}", "evidence": url + feed})
    return out


def rows(root=ROOT):
    p = Path(root) / LEDGER
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()] if p.is_file() else []


def metric(root=ROOT, at=None):
    at, first = at or NOW(), {}
    for r in rows(root):
        t = dt.datetime.fromisoformat(r["at"].replace("Z", "+00:00"))
        if (at - t).days < 30 and r["id"] not in first:
            first[r["id"]] = r["found_by"]
    rt, ow = sum(v == "redteam" for v in first.values()), sum(v == "owner" for v in first.values())
    return {"redteam_found_30d": rt, "owner_found_30d": ow, "redteam_share": round(rt / (rt + ow), 3) if rt + ow else None, "target": "owner_found_30d == 0"}


def run(root=ROOT, apply=False, url=None, get=_get):
    found = check_unscored(root) + check_vacuous(root) + (check_live(url, get) if url else [])
    if apply:
        root, stamp = Path(root), NOW().strftime("%Y-%m-%dT%H:%M:%SZ")
        seen = {r["id"] for r in rows(root)}
        (root / LEDGER).parent.mkdir(parents=True, exist_ok=True)
        with (root / LEDGER).open("a", encoding="utf-8") as fh:
            for f in found:
                if f["id"] in seen:
                    continue
                fh.write(json.dumps({"at": stamp, "found_by": "redteam", **f}) + "\n")
                (root / "docs/issues").mkdir(parents=True, exist_ok=True)
                (root / f"docs/issues/RT-{f['id']}.json").write_text(json.dumps({
                    "id": f"RT-{f['id']}", "title": f["what"], "status": "open", "owner": "operations", "trigger": "red-team pass",
                    "done": "cmd:python3 scripts/redteam.py --probe", "body": f"Fix the root cause in the code that produced this, not the reading. Evidence: {f['evidence']}"},
                    indent=1) + "\n", encoding="utf-8")
        (root / METRIC).write_text(json.dumps(metric(root), indent=1) + "\n", encoding="utf-8")
    return found


def main(argv=None):
    a = list(sys.argv[1:] if argv is None else argv)
    g = lambda k: a[a.index(k) + 1] if k in a and a.index(k) + 1 < len(a) else None
    if "--owner" in a:
        p = ROOT / LEDGER; p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"at": NOW().strftime("%Y-%m-%dT%H:%M:%SZ"), "found_by": "owner", "id": g("--owner"), "what": g("--what") or ""}) + "\n")
        return 0
    found = run(ROOT, apply="--apply" in a, url=g("--url"))
    for f in found:
        print(f"{f['cls']}: {f['what']} ({f['evidence']})")
    print(json.dumps(metric(ROOT)))
    return 1 if ("--probe" in a and found) else 0


if __name__ == "__main__":
    sys.exit(main())
