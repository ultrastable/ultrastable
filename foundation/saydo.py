# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SAY-DO-1: what the system says it does is checked against what its code does, every watchdog run. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation saydo --run [--apply] [--changed-file F]   measure every source, write ops/saydo.json, file Q-SAYDO-* for each gap
  python3 -m foundation saydo --probe ID                          closing probe of a Q-SAYDO item: that statement now matches the code (exit 0)
  python3 -m foundation saydo --check                             the module and its data are well formed

Rowan, 2026-11-21: "I don't really care what you say ... when I check in, I care that you're doing what you say ... Don't say it, code it."
Chat sessions are inputs; only the system's behaviour counts. Sources, each statement a unit that matches or not:
  rules     every rule in agents/AGENTS.md that carries an id: each repository path it names exists, and each `python3 -m foundation X --check`
            it names passes now (paths in other repositories and URLs are named as external, never counted as matched)
  claims    every statement on the public surfaces (foundation/claims.py, the same probes /claims shows)
  changes   every substantive change the server itself made on main in the window: a change that closes an item and touches no file outside the
            item, ledgers and write-backs said it did something it did not do (PR 836); foundation/executor.py saydo_gap now refuses that reply
  loops     the second loop says it keeps a step only when the variable returns: steps judged in the window and the share kept (0 kept of a run of
            judged steps is a gap: the mechanism exists in name only)
  year      the system says it is designed to run a year unattended: the measured horizon from foundation/yearsim.py must reach target_days
A gap files one Q-SAYDO-<source>-<id> item whose closing probe is the same measurement. Output: ops/saydo.json (latest), ops/saydo.jsonl
(history), site/saydo-data.js (page /year). Tests: tests/foundation/test_saydo.py."""
from __future__ import annotations
import datetime as dt, json, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LATEST, LEDGER, DATA, PREFIX = "ops/saydo.json", "ops/saydo.jsonl", "site/saydo-data.js", "Q-SAYDO"
EXTERNAL = ("ultrastable/practical-solutions", "qnfo-workers", "rwnq8/resume", "QNFO/")
CHECK_TIMEOUT = 150


def rules(root=REPO, run_checks=True) -> list[dict]:
    t = (Path(root) / "agents/AGENTS.md").read_text(encoding="utf-8")
    out, cache = [], {}
    for b in re.split(r"\n(?=- \*\*|> )", t):
        m = re.search(r"\(([A-Z][A-Z0-9]+(?:-[A-Z0-9]+)*-\d+)\b", b) or re.match(r"> ([A-Z][A-Z-]+[A-Z])\b", b)
        if not m or not b.startswith(("- **", "> ")):
            continue
        rid = m.group(1)
        ext = any(x in b for x in EXTERNAL)
        missing, external, failing, checks, unmeasured = [], [], [], [], []
        for tok in re.findall(r"`([^`]+)`", b):
            if re.fullmatch(r"[\w.-]+(/[\w.-]+)+\.(py|js|mjs|json|jsonl|md|yml|sh|toml)", tok):
                if any((Path(root) / base / tok).exists() for base in ("", "seed", "workers")):
                    continue  # AGENTS.md is the seed's text too: a path resolves here, in the seed kit, or in workers/ (core, merged from the archived workers repo)
                (external if ext else missing).append(tok)
            cm = re.fullmatch(r"python3 -m (foundation[ .][\w]+)(?: [\w.]+)? --check", tok) or re.fullmatch(r"python3 -m (foundation \w+) --check", tok)
            if cm:
                cmd = tok.split()
                checks.append(tok)
                if run_checks:
                    if tok not in cache:
                        try:
                            r = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=CHECK_TIMEOUT)
                            o = (r.stdout + r.stderr).strip().splitlines()
                            # exit 2 is a check that could not measure on this host (no API reach): unmeasured, never a pass and never a gap
                            cache[tok] = None if r.returncode == 0 else ("unmeasured", o[-1][:200] if o else "exit 2") if r.returncode == 2 else ("fail", "; ".join(o[:2])[:200] if o else f"exit {r.returncode}")
                        except subprocess.TimeoutExpired:
                            cache[tok] = ("fail", f"no answer in {CHECK_TIMEOUT} s")
                    if cache[tok] and cache[tok][0] == "fail":
                        failing.append(f"{tok}: {cache[tok][1]}")
                    elif cache[tok]:
                        unmeasured.append(f"{tok}: {cache[tok][1]}")
        if not (missing or failing or checks or external) and "`" not in b:
            continue
        out.append({"id": rid, "ok": not missing and not failing, "missing": missing, "failing": failing, "external": external, "unmeasured": unmeasured, "checks": len(checks)})
    seen, uniq = set(), []
    for r in out:  # a rule stated twice (AGENTS.md repeats a few) is one statement; both copies must match
        if r["id"] in seen:
            prev = next(x for x in uniq if x["id"] == r["id"])
            prev.update(ok=prev["ok"] and r["ok"], missing=sorted(set(prev["missing"]) | set(r["missing"])), failing=sorted(set(prev["failing"]) | set(r["failing"])))
            continue
        seen.add(r["id"]); uniq.append(r)
    return uniq


def claims_source(root=REPO) -> list[dict]:
    from . import claims
    try:
        ev = claims.evaluate(root)
    except (OSError, ValueError, KeyError) as e:
        return [{"id": "claims-unreadable", "ok": False, "detail": f"{type(e).__name__}: {e}"}]
    _, all_rows, drift = ev
    total = len(all_rows)
    rows = [{"id": str(d["id"]), "ok": False, "detail": f"{d.get('surface')}: {d.get('detail') or d.get('claim')}"[:200]} for d in drift]
    return rows + [{"id": "claims-total", "ok": True, "total": total, "drift": len(drift)}]


def changes(root=REPO, days=14, now=None) -> list[dict]:
    from . import criticality
    since = ((now or dt.datetime.now(dt.timezone.utc)) - dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    r = subprocess.run(["git", "log", f"--since={since}", "--format=%H%x1f%B%x1e"], cwd=root, capture_output=True, text=True)
    if r.returncode != 0:
        return []
    c, out = criticality.cfg(root), []
    for chunk in r.stdout.split("\x1e"):
        if "\x1f" not in chunk:
            continue
        h, msg = chunk.strip().split("\x1f", 1)
        msg = msg.strip()
        if not msg or "[skip ci]" in msg.splitlines()[0] or criticality.origin_of(msg, c) not in ("executor", "self-agent"):
            continue
        files = [ln.split("\t")[-1] for ln in subprocess.run(["git", "show", "--numstat", "--format=", h], cwd=root, capture_output=True, text=True).stdout.splitlines() if "\t" in ln]
        did = [f for f in files if not f.startswith(("docs/issues/", "ops/", "doctrine/writeback/")) and "-data.js" not in f]
        out.append({"id": h[:12], "ok": bool(did), "said": msg.splitlines()[0][:120], "did": did[:8]})
    return out


def loops(root=REPO, days=14, now=None) -> list[dict]:
    p = Path(root) / "ops/ultrastability.jsonl"
    rows = [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()] if p.is_file() else []
    since = ((now or dt.datetime.now(dt.timezone.utc)) - dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    v = [r for r in rows if r.get("ev") == "verdict" and r.get("at", "") >= since]
    kept = sum(1 for r in v if r["verdict"] == "kept")
    return [{"id": "second-loop-kept", "ok": not v or kept > 0 or len(v) < 5, "judged": len(v), "kept": kept,
             "detail": f"{kept} of {len(v)} second-order steps kept in {days} days"}]


def year(root=REPO) -> list[dict]:
    p = Path(root) / "ops/yearsim.json"
    if not p.is_file():
        return [{"id": "unattended-year", "ok": False, "detail": "no year simulation recorded (python3 -m foundation yearsim --run --apply)"}]
    j = json.loads(p.read_text(encoding="utf-8"))
    h = (j.get("horizon") or {}).get("p10")
    return [{"id": "unattended-year", "ok": bool(h is not None and h >= j.get("target_days", 365)), "detail": f"simulated horizon p10 {h} days against {j.get('target_days')}"},
            {"id": "ships-daily", "ok": (j.get("self_rate_per_day") or 0) >= 1, "detail": f"{j.get('self_rate_per_day')} substantive server-originated changes a day (target 1)"}]


def measure(root=REPO, run_checks=True, now=None) -> dict:
    src = {"rules": rules(root, run_checks), "claims": claims_source(root), "changes": changes(root, now=now), "loops": loops(root, now=now), "year": year(root)}
    summary = {}
    for k, rows in src.items():
        units = [r for r in rows if r["id"] != "claims-total"]
        if k == "claims":
            tot = next((r for r in rows if r["id"] == "claims-total"), {})
            summary[k] = {"total": tot.get("total") or len(units), "gaps": len(units)}
        else:
            summary[k] = {"total": len(units), "gaps": sum(1 for r in units if not r["ok"])}
    tot = sum(s["total"] for s in summary.values())
    gaps = sum(s["gaps"] for s in summary.values())
    return {"at": (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"), "summary": summary, "total": tot, "gaps": gaps,
            "match_share": round((tot - gaps) / tot, 3) if tot else None, "sources": src}


def _item(root, source, r) -> str | None:
    if source == "changes":
        return None  # a merged change cannot be undone into truth; the guard in the executor is the fix, and the rate stays on the page
    iid = f"{PREFIX}-{source}-{re.sub(r'[^A-Za-z0-9_-]+', '-', r['id'])}"
    p = Path(root) / "docs/issues" / (iid + ".json")
    if p.exists():
        return None
    what = "; ".join(r.get("missing", []) + r.get("failing", [])) or r.get("detail", "")
    body = (f"**Owner:** executor\n**Trigger:** say-do check (SAY-DO-1) on the watchdog run\n**Done check:** cmd:python3 -m foundation saydo --probe {source}:{r['id']}\n**Status:** open\n\n"
            f"The system states `{r['id']}` ({source}) and its code does not do it: {what[:700]}\n\nChange the code to do what the statement says, or change the statement "
            f"to what the code does; never weaken the probe.\n\nsize: S\n\n**Closing probe:** `python3 -m foundation saydo --probe {source}:{r['id']}` exits 0.\n")
    p.write_text(json.dumps({"id": iid, "title": f"{iid}: says {r['id']}, does not do it", "body": body, "labels": ["p1", "agent-ready", "say-do"], "milestone": "Now", "workstream": "Ultrastability"}, indent=2) + "\n", encoding="utf-8")
    return iid


def _close_matched(root, m) -> list:
    """An open Q-SAYDO item whose statement now matches its code (or is no longer stated) is closed with that evidence in the same run."""
    gaps, closed = {f"{PREFIX}-{s}-{re.sub(r'[^A-Za-z0-9_-]+', '-', r['id'])}" for s, rows in m["sources"].items() for r in rows if not r["ok"]}, []
    for p in sorted((Path(root) / "docs/issues").glob(PREFIX + "-*.json")):
        j = json.loads(p.read_text(encoding="utf-8"))
        if "**Status:** open" not in j.get("body", "") or j["id"] in gaps:
            continue
        j["body"] = j["body"].replace("**Status:** open", "**Status:** closed", 1) + f"\n**Evidence:** say-do check at {m['at']}: the statement matches its code or is no longer stated.\n"
        p.write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")
        closed.append(j["id"])
    return closed


def run(root=REPO, apply=False, changed_file=None, now=None) -> dict:
    root = Path(root)
    m = measure(root, now=now)
    if apply:
        prev = json.loads((root / LATEST).read_text(encoding="utf-8")) if (root / LATEST).is_file() else {}
        (root / LATEST).write_text(json.dumps(m, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        with (root / LEDGER).open("a", encoding="utf-8", newline="\n") as fh:
            fh.write(json.dumps({"at": m["at"], "summary": m["summary"], "match_share": m["match_share"]}, sort_keys=True) + "\n")
        m["filed"] = [i for s, rows in m["sources"].items() for r in rows if not r["ok"] for i in [_item(root, s, r)] if i]
        m["closed"] = _close_matched(root, m)
        (root / DATA).write_text(render(root), encoding="utf-8")
        if changed_file and (m["filed"] or m["closed"] or prev.get("summary") != m["summary"] or prev.get("at", "")[:10] != m["at"][:10]):
            Path(changed_file).write_text("1", encoding="utf-8")
    return m


def probe(root, ref) -> int:
    source, _, rid = ref.partition(":")
    fn = {"rules": lambda: rules(root), "claims": lambda: claims_source(root), "changes": lambda: changes(root), "loops": lambda: loops(root), "year": lambda: year(root)}.get(source)
    if not fn:
        print("unknown source", source); return 2
    r = next((x for x in fn() if x["id"] == rid), None)
    if r is None:
        print(f"{ref}: no longer stated (statement removed), so nothing is claimed"); return 0
    print(json.dumps(r)); return 0 if r["ok"] else 1


def page_data(root=REPO) -> dict:
    p = Path(root) / LATEST
    if not p.is_file():
        return {"measured": False}
    j = json.loads(p.read_text(encoding="utf-8"))
    gaps = [{"source": s, "id": r["id"], "detail": ("; ".join(r.get("missing", []) + r.get("failing", [])) or r.get("detail") or r.get("said", ""))[:240]}
            for s, rows in j["sources"].items() for r in rows if not r["ok"]]
    return {"measured": True, "at": j["at"], "summary": j["summary"], "total": j["total"], "gaps": j["gaps"], "match_share": j["match_share"], "gap_list": gaps[:60], "omitted": max(0, len(gaps) - 60)}


def render(root=REPO) -> str:
    return ("// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n// GENERATED by python3 -m foundation saydo --run --apply from ops/saydo.json. Do not edit; --check fails when stale.\n"
            "export default " + json.dumps(page_data(root), indent=1, sort_keys=True) + ";\n")


def check(root=REPO) -> list[str]:
    root, errs = Path(root), []
    if not (root / "agents/AGENTS.md").is_file():
        errs.append("agents/AGENTS.md is missing: there is nothing to hold the system to")
    if "SAY-DO-1" not in (root / "foundation/executor.py").read_text(encoding="utf-8"):
        errs.append("foundation/executor.py no longer refuses a change that touches only its item and ledgers (SAY-DO-1)")
    if (root / DATA).is_file() and (root / DATA).read_text(encoding="utf-8") != render(root):
        errs.append(f"{DATA} is stale: run saydo --run --apply")
    return errs


def main(argv=None) -> int:
    a = sys.argv[1:] if argv is None else argv
    if "--check" in a:
        e = check(); print("\n".join(e) or "saydo ok"); return 1 if e else 0
    if "--probe" in a:
        i = a.index("--probe"); return probe(REPO, a[i + 1] if i + 1 < len(a) else "")
    if "--run" in a:
        cf = a[a.index("--changed-file") + 1] if "--changed-file" in a else None
        r = run(REPO, apply="--apply" in a, changed_file=cf)
        print(json.dumps({"summary": r["summary"], "match_share": r["match_share"], "filed": r.get("filed", [])}, indent=1)); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())
