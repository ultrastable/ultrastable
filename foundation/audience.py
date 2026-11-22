# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""AUDIENCE-1 on the platform: ultrastable.io builds and holds a returning audience. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation audience --run [--apply]   measure supply, promotion, attention and return (seed/scripts/audience.py, rules doctrine/audience.json);
                                                   with --apply: record the reading, file Q-AUD-<metric> for each breach, close items whose metric is met,
                                                   and run the producer of every stale section once a day (the fresh-content loop)
  python3 -m foundation audience --probe METRIC    closing probe of a Q-AUD item (exit 0 when the latest reading meets it)
  python3 -m foundation audience --check           rules valid, the engine and the feed counter are wired

The engine is shared with every seeded system; this wrapper adds the queue items and the producer runs. Daily in .github/workflows/social-post.yml.
Tests: tests/foundation/test_audience.py."""
from __future__ import annotations
import datetime as dt, importlib.util as _ilu, json, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PREFIX, MAX_FILED = "Q-AUD", 4
PRODUCERS = {"research --run --apply", "thought --run --apply", "reach --run --apply"}  # foundation subcommands the loop may run itself
_spec = _ilu.spec_from_file_location("audience_core", REPO / "seed/scripts/audience.py")
core = _ilu.module_from_spec(_spec)
sys.modules["audience_core"] = core
_spec.loader.exec_module(core)


def _iid(metric: str) -> str:
    return PREFIX + "-" + re.sub(r"[^A-Za-z0-9_-]+", "-", metric).strip("-")


def _file(root, f) -> str | None:
    iid, p = _iid(f["id"]), Path(root) / "docs/issues" / (_iid(f["id"]) + ".json")
    if p.exists() and "**Status:** open" in json.loads(p.read_text(encoding="utf-8")).get("body", ""):
        return None
    pred = f"{f['id']} {f['op'] if f['op'] != 'grows' else '>='} {f['target'] if f['op'] != 'grows' else f.get('previous')} within 336 h"
    body = (f"**Owner:** marketing-manager\n**Trigger:** audience pass (AUDIENCE-1), daily in social-post\n**Done check:** cmd:python3 -m foundation audience --probe {f['id']}\n"
            f"**Prediction:** {pred}\n**Status:** open\n\nStage: {f['stage']}. {f['why']}.\n\nRemedy: {f['remedy']}.\n\nsize: S\n\n"
            f"**Closing probe:** `python3 -m foundation audience --probe {f['id']}` exits 0.\n")
    p.write_text(json.dumps({"id": iid, "title": f"{iid}: {f['why'][:100]}", "body": body, "labels": ["p2", "agent-ready", "growth", "audience"], "milestone": "Now", "workstream": "Growth"}, indent=2) + "\n", encoding="utf-8")
    return iid


def _close_met(root, rows, at) -> list[str]:
    met = {_iid(r["id"]): r for r in rows if r["status"] == "met"}
    closed = []
    for p in sorted((Path(root) / "docs/issues").glob(PREFIX + "-*.json")):
        j = json.loads(p.read_text(encoding="utf-8"))
        if "**Status:** open" in j.get("body", "") and j["id"] in met:
            j["body"] = j["body"].replace("**Status:** open", "**Status:** closed", 1) + f"\n**Evidence:** audience reading at {at}: {met[j['id']]['why']}.\n"
            p.write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")
            closed.append(j["id"])
    return closed


def refresh(root, findings, today, runner=None) -> list[dict]:
    """The fresh-content loop: a stale section's producer runs, at most once a day per producer."""
    runner = runner or (lambda cmd: subprocess.run([sys.executable, "-m", "foundation", *cmd.split()], cwd=root, capture_output=True, text=True, timeout=900).returncode)
    log = Path(root) / core.OUT / "refresh.jsonl"
    done = {(r["day"], r["producer"]) for r in (json.loads(l) for l in log.read_text(encoding="utf-8").splitlines() if l.strip())} if log.is_file() else set()
    out = []
    for f in findings:
        prod = f.get("remedy", "")
        if not f["id"].startswith("fresh:") or prod not in PRODUCERS or (today, prod) in done:
            continue
        try:
            rc = runner(prod)
        except (OSError, subprocess.TimeoutExpired) as e:
            print(f"audience: producer {prod} failed: {e}", file=sys.stderr)
            rc = -1
        rec = {"day": today, "producer": prod, "section": f["id"][6:], "rc": rc}
        out.append(rec)
        done.add((today, prod))
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")
    return out


def _d1():
    """The analytics D1 the insight loop already reads (doctrine/insight.json source), over the Cloudflare API; None without a token."""
    from . import insight
    src = insight.source_from_env(insight.load() if hasattr(insight, "load") else json.loads((REPO / "doctrine/insight.json").read_text()))
    return src._q if src is not None and hasattr(src, "_q") else core.d1_query()


def run(root=REPO, apply=False, today=None, runner=None, **kw) -> dict:
    root = Path(root)
    if "query" not in kw and kw.get("live", True):
        kw["query"] = _d1()
    rec = core.run(root, apply=apply, today=today, **kw)
    if apply:
        rec["filed"] = [i for i in (_file(root, f) for f in rec["findings"]) if i][:MAX_FILED]
        rec["closed"] = _close_met(root, rec["rows"], rec["at"])
        rec["refreshed"] = refresh(root, rec["findings"], rec["at"][:10], runner)
    return rec


def check(root=REPO) -> list[str]:
    errs = core.check(root)
    w = (Path(root) / "site/worker.js").read_text(encoding="utf-8")
    if "recordFeed(env, request" not in w:
        errs.append("site/worker.js does not count feed requests (recordFeed)")
    for s in core.rules(root)["sections"]:
        if s["producer"] not in PRODUCERS:
            errs.append(f"section {s['id']}: producer {s['producer']!r} is not a command this loop can run")
    return errs


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--check" in a:
        e = check()
        print("\n".join(e) or "audience ok")
        return 1 if e else 0
    if "--probe" in a:
        ok, why = core.probe(REPO, a[a.index("--probe") + 1])
        print(why)
        return 0 if ok else 1
    rec = run(apply="--apply" in a)
    print(json.dumps({k: rec.get(k) for k in ("at", "values", "findings", "unmeasured", "ratchet", "filed", "closed", "refreshed")}, indent=1, default=str))
    return 0
