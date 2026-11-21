"""INTENT-YIELD-1: for a given unit of human input, what is the best unit of output.

Ultrastable is the foundation for any autonomous system.

Unit of input: one intent, an owner directive in its own words (a bullet in agents/AGENTS.md that names the owner and a date). Its cost is the
attention it took: the words of the directive at a speaking pace, plus every restatement of it, which is charged to the original.
Unit of output: one kept outcome, the directive's own probe passing on an independent route, unrestated, after the settle window.
No count of hours, commits, PRs or deploys enters the measure, and no person is scored.

  python3 -m foundation intentyield --run [--apply]   parse, probe (rotating, time-boxed), score, file Q-YIELD items, publish /yield data
  python3 -m foundation intentyield --probe           the loop's own health: fresh, parsed, probed (detector intent-yield-fresh)
  python3 -m foundation intentyield --check           config valid, the parser still finds the owner's directives, the page data exists
  python3 -m foundation intentyield --report          the current yield as JSON
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shlex
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CONFIG = "doctrine/intent-yield.json"
BULLET = re.compile(r"^- \*\*(?P<title>.+?)\*\*(?P<rest>.*)$")
RULE_ID = re.compile(r"\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-(?:\d+|\d{3}))\b")
QUOTE = re.compile(r"\"([^\"]{12,})\"")
WORD = re.compile(r"[a-z0-9']+")


def load(root=REPO) -> dict:
    return json.loads((Path(root) / CONFIG).read_text(encoding="utf-8"))


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:48]


def _words(s: str) -> list[str]:
    return WORD.findall(s.lower())


def parse(text: str, cfg: dict, source: str = "agents/AGENTS.md") -> list[dict]:
    """Every bullet that names the owner and a date is one intent occurrence. Same id twice is a restatement of the first."""
    owners = "|".join(re.escape(n) for n in cfg["owner_names"])
    attributed = re.compile(r"\((?:[^()]*?)(?:" + owners + r"),?\s+(\d{4}-\d{2}-\d{2})[^()]*\)")
    probe_re = re.compile(cfg["probe_pattern"])
    out = []
    for n, line in enumerate(text.splitlines(), 1):
        m = BULLET.match(line)
        if not m:
            continue
        title, rest = m.group("title"), m.group("rest")
        head = title + " " + rest[:200]
        a = attributed.search(head)
        if not a:
            continue
        ids = RULE_ID.findall(a.group(0))
        iid = ids[0] if ids else "T-" + _slug(re.sub(r"\(.*?\)", "", title))
        quotes = QUOTE.findall(rest)
        quote = quotes[0] if quotes else ""
        said = quote or re.sub(r"\s*\(.*?\)\s*\.?$", "", title)
        out.append({
            "id": iid, "title": re.sub(r"\s*\(.*?\)\s*\.?$", "", title).strip(), "date": a.group(1), "source": f"{source}:{n}",
            "quote": quote, "quotes": quotes, "words": len(_words(said)), "probes": sorted(set(probe_re.findall(line))),
            "restated_note": len(re.findall(r"Restated by", line)),
        })
    return out


def intents(occ: list[dict], cfg: dict) -> dict:
    """Fold occurrences into intents. A repeat of the same id, an explicit 'Restated by', or a later quote that says the same words as an
    earlier one is a restatement and is charged to the earliest intent."""
    by: dict[str, dict] = {}
    for o in occ:
        i = by.get(o["id"])
        if i is None:
            by[o["id"]] = i = {**o, "restatements": [], "attention_s": 0.0}
        else:
            i["restatements"].append({"source": o["source"], "why": "same directive written again"})
            i["probes"] = sorted(set(i["probes"]) | set(o["probes"]))
        i["attention_s"] += o["words"] / cfg["words_per_second"]
        for _ in range(o["restated_note"]):
            i["restatements"].append({"source": o["source"], "why": "marked 'Restated by' in the text"})
    order = sorted(by.values(), key=lambda i: (i["date"], i["source"]))
    def same(a: str, b: str) -> bool:
        aw, bw = set(_words(a)), set(_words(b))
        return min(len(aw), len(bw)) >= cfg["restatement_min_words"] and len(aw & bw) / len(aw | bw) >= cfg["restatement_jaccard"]
    for k, later in enumerate(order):
        for early in order[:k]:
            if later.get("restates"):
                continue
            # the later directive restates the earlier when any of its quotes says the earlier directive's own words again
            if early["quote"] and any(same(q, early["quote"]) for q in later["quotes"]):
                later["restates"] = early["id"]
                early["restatements"].append({"source": later["source"], "why": f"{later['id']} says the same words"})
                early["attention_s"] += sum(len(_words(q)) for q in later["quotes"] if same(q, early["quote"])) / cfg["words_per_second"]
    for i in by.values():
        i["attention_s"] = round(i["attention_s"], 1)
        i.pop("restated_note", None)
        i.pop("quotes", None)
    return by


def run_probe(cmd: str, root: Path, timeout: int) -> dict:
    t0 = time.monotonic()
    try:
        p = subprocess.run(shlex.split(cmd), cwd=root, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"cmd": cmd, "result": "timeout", "seconds": timeout, "tail": f"no answer in {timeout} s"}
    except OSError as e:
        return {"cmd": cmd, "result": "error", "seconds": round(time.monotonic() - t0, 1), "tail": str(e)[:300]}
    tail = (p.stdout + p.stderr).strip().splitlines()[-1:] or [""]
    # 0 passes, 1 is a check that failed; any other code means the check could not measure (usage, missing access): unmeasured, never broken
    res = "pass" if p.returncode == 0 else "fail" if p.returncode == 1 else "error"
    return {"cmd": cmd, "result": res, "rc": p.returncode, "seconds": round(time.monotonic() - t0, 1), "tail": tail[0][:300]}


def verdict(i: dict, last: dict | None, now: datetime, cfg: dict) -> str:
    """kept: probe passes, unrestated, settled. holding: the same before the settle window. restated: the owner had to say it again.
    broken: its probe fails. unmeasured: no runnable probe, or the probe never answered."""
    if not i["probes"] or not last or last["result"] in ("timeout", "error"):
        return "unmeasured"
    if last["result"] == "fail":
        return "broken"
    if i["restatements"]:
        return "restated"
    age = (now.date() - datetime.strptime(i["date"], "%Y-%m-%d").date()).days
    return "kept" if age >= cfg["settle_days"] else "holding"


def score(by: dict, now: datetime, cfg: dict) -> dict:
    counted = list(by.values())
    measured = [i for i in counted if i["verdict"] != "unmeasured"]
    settled = [i for i in measured if (now.date() - datetime.strptime(i["date"], "%Y-%m-%d").date()).days >= cfg["settle_days"]]
    kept = [i for i in settled if i["verdict"] == "kept"]
    holding = [i for i in measured if i["verdict"] in ("kept", "holding")]
    att = sorted(i["attention_s"] for i in kept) or sorted(i["attention_s"] for i in holding)
    tally = {}
    for i in counted:
        tally[i["verdict"]] = tally.get(i["verdict"], 0) + 1
    return {
        "intents": len(counted), "measured": len(measured), "settled": len(settled),
        "kept_share": round(len(kept) / len(settled), 3) if settled else None,
        "holding_share": round(len(holding) / len(measured), 3) if measured else None,
        "restated_share": round(sum(1 for i in counted if i["restatements"]) / len(counted), 3) if counted else None,
        "attention_s_per_kept": att[len(att) // 2] if att else None,
        "verdicts": dict(sorted(tally.items())),
    }


def _read_state(root: Path, cfg: dict) -> dict:
    p = root / cfg["state"]
    if not p.is_file():
        return {"last_probe": {}, "runs": 0}
    return json.loads(p.read_text(encoding="utf-8"))


def _history(root: Path, cfg: dict) -> list[dict]:
    p = root / cfg["history"]
    if not p.is_file():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def item_id(iid: str) -> str:
    return "Q-YIELD-" + hashlib.sha1(iid.encode()).hexdigest()[:10]


def file_items(root: Path, by: dict, cfg: dict, apply: bool) -> list[str]:
    """One queue item per broken directive whose probe the owner named, closed by that same probe."""
    from . import pm
    try:
        from . import balance
        admit = balance.admit
    except ImportError as e:  # the balance loop is optional for a tenant; record why it is not consulted
        print(f"intentyield: balance not consulted ({e})", file=sys.stderr)
        admit = lambda root=None, item_id="": True  # noqa: E731
    filed = []
    for i in sorted(by.values(), key=lambda i: i["date"]):
        if i["verdict"] != "broken" or len(filed) >= cfg["max_items_per_run"]:
            continue
        qid = item_id(i["id"])
        if (root / "docs/issues" / f"{qid}.json").exists() or not admit(root, qid):
            continue
        failing = [p for p in i["probes"] if (i.get("probe_results") or {}).get(p, {}).get("result") == "fail"]
        probe = failing[0] if failing else i["probes"][0]
        text = (f"Intent Yield: the owner's directive {i['id']} ({i['title']}, {i['date']}, {i['source']}) is not holding: its own probe `{probe}` fails"
                f" ({(i.get('probe_results') or {}).get(probe, {}).get('tail', '')}).\n\nThe owner said it once; the system makes it true again so it is never said twice."
                f" Fix the cause, not the probe. Prediction: the probe passes within 168 h.")
        if apply:
            pm._write_item(root, qid, f"directive {i['id']} is not holding", f"cmd:{probe}", text, ["p1", "agent-ready", "intent-yield"], "Operations", "operations")
        filed.append(qid)
    return filed


def settle_prediction(hist: list[dict], summary: dict, now: datetime) -> dict | None:
    """Score the oldest open prediction whose window has passed against today's measured kept share."""
    for h in hist:
        p = h.get("prediction")
        if not p or p.get("outcome"):
            continue
        due = _parse_iso(h["at"]) + timedelta(hours=p["within_h"])
        if due > now:
            return None
        got = summary["kept_share"]
        return {"made_at": h["at"], "expect": f"kept_share >= {p['value']}", "got": got, "outcome": "unmeasured" if got is None else ("hit" if got >= p["value"] else "miss")}
    return None


def js(data: dict) -> str:
    return ("// GENERATED by python3 -m foundation intentyield --run --apply; do not edit.\n// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n"
            "export const INTENT_YIELD = " + json.dumps(data, indent=1, ensure_ascii=False) + ";\n")


def run(root=REPO, apply=False, now: datetime | None = None, runner=run_probe) -> dict:
    root, now = Path(root), now or _now()
    cfg, error = load(root), None
    occ = []
    for src in cfg["sources"]:
        occ += parse((root / src).read_text(encoding="utf-8"), cfg, src)
    by = intents(occ, cfg)
    state = _read_state(root, cfg)
    last = state.get("last_probe", {})
    # Rotate: commands never run or run longest ago go first, inside a fixed time box, so the run stays bounded as directives grow.
    cmds = sorted({p for i in by.values() for p in i["probes"]}, key=lambda c: (last.get(c, {}).get("at", ""), c))
    t0, ran = time.monotonic(), 0
    for c in cmds:
        if time.monotonic() - t0 > cfg["run_budget_s"]:
            break
        r = runner(c, root, cfg["probe_timeout_s"])
        r["at"] = _iso(now)
        last[c] = r
        ran += 1
    for i in by.values():
        i["probe_results"] = {p: last[p] for p in i["probes"] if p in last}
        res = list(i["probe_results"].values())
        worst = next((r for r in res if r["result"] == "fail"), None) or next((r for r in res if r["result"] == "pass"), None) or (res[0] if res else None)
        i["verdict"] = verdict(i, worst, now, cfg)
    summary = score(by, now, cfg)
    hist = _history(root, cfg)
    settled = settle_prediction(hist, summary, now)
    if settled:
        for h in hist:
            if h["at"] == settled["made_at"]:
                h["prediction"]["outcome"] = settled["outcome"]
                h["prediction"]["got"] = settled["got"]
    filed = file_items(root, by, cfg, apply)
    prev = hist[-1] if hist else None
    if summary["intents"] < cfg["min_intents"]:
        error = f"parsed {summary['intents']} directives, fewer than {cfg['min_intents']}: the source format changed"
    elif prev and prev["summary"]["intents"] and summary["intents"] < prev["summary"]["intents"] * (1 - cfg["max_drop_share"]):
        error = f"parsed directives fell from {prev['summary']['intents']} to {summary['intents']}: the parser lost them"
    elif cmds and not ran:
        error = "no probe ran this pass"
    rec = {"at": _iso(now), "summary": summary, "probes_run": ran, "probes_total": len(cmds), "filed": filed, "error": error,
           "prediction": {"metric": "kept_share", "op": ">=", "value": cfg["prediction_floor"], "within_h": cfg["settle_days"] * 24}}
    rows = [{k: i[k] for k in ("id", "title", "date", "source", "verdict", "attention_s", "probes")}
            | {"restatements": len(i["restatements"]), "restates": i.get("restates"),
               "item": item_id(i["id"]) if (root / "docs/issues" / f"{item_id(i['id'])}.json").exists() or item_id(i["id"]) in filed else None}
            for i in sorted(by.values(), key=lambda i: (i["date"], i["id"]))]
    page = {"marker": "INTENT-YIELD-1", "at": rec["at"], "settle_days": cfg["settle_days"], "target_kept_share": cfg["target_kept_share"], "summary": summary,
            "probes_run": ran, "probes_total": len(cmds), "error": error, "intents": rows,
            "history": [{"at": h["at"], "holding_share": h["summary"]["holding_share"], "kept_share": h["summary"]["kept_share"]} for h in (hist + [rec])[-60:]],
            "predictions": [h["prediction"] | {"made_at": h["at"]} for h in hist if (h.get("prediction") or {}).get("outcome")][-12:]}
    if apply:
        state = {"at": rec["at"], "runs": state.get("runs", 0) + 1, "last_probe": last, "error": error, "intents": summary["intents"], "probes_run": ran}
        sp = root / cfg["state"]
        sp.parent.mkdir(parents=True, exist_ok=True)
        sp.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        hp = root / cfg["history"]
        keep = (hist + [rec])[-cfg["history_keep"]:]
        hp.write_text("".join(json.dumps(h, sort_keys=True) + "\n" for h in keep), encoding="utf-8")
        (root / cfg["site_data"]).write_text(js(page), encoding="utf-8")
    return page


def probe(root=REPO, now: datetime | None = None) -> tuple[bool, str]:
    """The loop's own health. Fails loudly when the run is stale, errored, parsed too little, or ran no probe."""
    root, now = Path(root), now or _now()
    cfg = load(root)
    p = root / cfg["state"]
    if not p.is_file():
        return False, f"{cfg['state']} missing: the yield loop has never run"
    s = json.loads(p.read_text(encoding="utf-8"))
    age_h = (now - _parse_iso(s["at"])).total_seconds() / 3600
    if age_h > cfg["stale_hours"]:
        return False, f"last run {s['at']} is {age_h:.0f} h old (limit {cfg['stale_hours']} h): the daily run stopped"
    if s.get("error"):
        return False, f"last run failed: {s['error']}"
    return True, f"fresh ({age_h:.0f} h), {s.get('intents')} directives, {s.get('probes_run')} probes run"


def check(root=REPO) -> list[str]:
    root, problems = Path(root), []
    cfg = load(root)
    for k in ("sources", "probe_pattern", "settle_days", "stale_hours", "min_intents", "state", "history", "site_data"):
        if k not in cfg:
            problems.append(f"{CONFIG}: missing {k}")
    if problems:
        return problems
    occ = []
    for src in cfg["sources"]:
        occ += parse((root / src).read_text(encoding="utf-8"), cfg, src)
    by = intents(occ, cfg)
    if len(by) < cfg["min_intents"]:
        problems.append(f"parser finds {len(by)} owner directives, fewer than {cfg['min_intents']}")
    if not (root / cfg["site_data"]).is_file():
        problems.append(f"{cfg['site_data']} missing: run python3 -m foundation intentyield --run --apply")
    return problems


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="foundation intentyield")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--report", action="store_true")
    a = ap.parse_args(argv)
    if a.run:
        page = run(apply=a.apply)
        print(json.dumps({"at": page["at"], "summary": page["summary"], "probes_run": page["probes_run"], "probes_total": page["probes_total"], "error": page["error"]}, indent=1))
        return 1 if page["error"] else 0
    if a.probe:
        ok, msg = probe()
        print(("intentyield ok: " if ok else "intentyield FAIL: ") + msg)
        return 0 if ok else 1
    if a.check:
        problems = check()
        for p in problems:
            print("intentyield: " + p)
        print("intentyield ok" if not problems else f"intentyield: {len(problems)} problem(s)")
        return 1 if problems else 0
    if a.report:
        cfg = load()
        p = REPO / cfg["site_data"]
        print(p.read_text(encoding="utf-8") if p.is_file() else "no run yet")
        return 0
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
