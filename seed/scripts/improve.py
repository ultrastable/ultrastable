# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""IMPROVE-1 and FRONTEND-AUTO-1: the improvement loop that always has work (Rowan, 2026-11-25).

"An Ultrastable system shall always continue improving entirely on its own, 100% autonomously." and "An Ultrastable system shall always
automate its back-end and also front-end development." Every system carries this engine (seed/scripts/improve.py); the platform runs it
through foundation/improve.py. Config: doctrine/improve.json on the platform, autonomy/improve.json in a seeded system.

  python3 -m foundation improve --report        what one pass would do (no writes)
  python3 -m foundation improve --run [--apply] measure, file, escalate, settle
  python3 -m foundation improve --check         config is sound and the loop has beaten inside its window

The other growth loops only act when a measured metric falls behind, so a system with no numbers reads as fine and goes quiet. This one
does not wait for a metric. Each pass (doctrine/improve.json):
1. Signals: every reach and impact signal it knows about is read. A missing, empty or stale signal is itself a defect and gets a queue item.
2. Work: it files at least `min_items_per_cycle` reach and impact items from its bank, and a protected plus share for system-wide
   upgrades that are not bug fixes. Every item carries a prediction and a probe that fails until the work exists.
3. Market: when the R&D log is older than `market_max_age_days` it files the research pass as a queue item.
4. Managers: each tier (portfolio, program, project, product) has a window. No matching merge on main inside it files a p0 stall item.
5. Settle: an item closed `settle_days` ago is judged on its metric. Kept if it moved, else a revert-or-replace item is filed.
Every step is a row in ops/improve/ledger.jsonl; the last pass is ops/improve/status.json.
"""
from __future__ import annotations
import argparse, json, re, subprocess, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if not (REPO / "autonomy/improve.json").is_file() and (REPO.parent / "doctrine/improve.json").is_file():
    REPO = REPO.parent   # running from seed/ inside the platform repository
CFGS = ("doctrine/improve.json", "autonomy/improve.json")
CFG, LEDGER, STATUS = "doctrine/improve.json", "ops/improve/ledger.jsonl", "ops/improve/status.json"
OWNER = {"reach": "marketing-manager", "impact": "product-manager", "plus": "portfolio-manager", "frontend": "uiux-manager", "backend": "program-manager"}
# Front-end work is checked on the real pages before it counts: the UI/UX audit (a11y in light and dark, phone and desktop, visual
# fingerprint, size budgets), Core Web Vitals from the lab run, and the human-voice check on every changed line of copy.
FRONTEND_GATE = ("Before closing: run the UI/UX audit on the changed pages (`python3 -m foundation uiux --tick` on the platform, the seed's "
                 "uiux audit in a tenant), keep Core Web Vitals inside budget (LCP <= 2.5 s, CLS <= 0.1, INP <= 200 ms), and pass the human-voice "
                 "check on every changed line of copy. A change that adds a blocking finding is reverted, not waived.")


def load(root=REPO) -> dict:
    for c in CFGS:
        p = Path(root) / c
        if p.is_file():
            return json.loads(p.read_text(encoding="utf-8"))
    raise FileNotFoundError("no improve config (doctrine/improve.json or autonomy/improve.json)")


def _iso(s):
    try:
        t = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _rows(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out


def signals(root, cfg, now) -> list[dict]:
    res = []
    for s in cfg["signals"]:
        p = Path(root) / s["path"]
        st = {"id": s["id"], "path": s["path"], "state": "missing", "value": None, "age_h": None}
        if p.is_file():
            if p.suffix == ".jsonl":
                rows = _rows(p)
                last = rows[-1] if rows else {}
                at = _iso(last.get("at") or last.get("ts") or last.get("time"))
                val = last.get(s["key"]) if s["key"] else (len(rows) or None)
            else:
                try:
                    j = json.loads(p.read_text(encoding="utf-8"))
                except ValueError:
                    j = {}
                at = _iso(j.get("at") or j.get("generated_at")) if isinstance(j, dict) else None
                val = (j.get(s["key"]) if s["key"] and isinstance(j, dict) else 1) if j else None
            if at is None:
                at = datetime.fromtimestamp(p.stat().st_mtime, timezone.utc)
            st["age_h"] = round((now - at).total_seconds() / 3600, 1)
            st["value"] = val
            st["state"] = "unmeasured" if val is None else ("stale" if st["age_h"] > s["max_age_hours"] else "ok")
        res.append(st)
    return res


def metric_now(root, key):
    if key.startswith("uiux:"):
        p = Path(root) / "ops/uiux/status.json"
        try:
            return json.loads(p.read_text(encoding="utf-8")).get(key[5:]) if p.is_file() else None
        except ValueError:
            return None
    rows = [r for r in _rows(Path(root) / "ops/reach/metrics.jsonl") if r.get(key) is not None]
    return rows[-1][key] if rows else None


def merges(root, days) -> list[str]:
    try:
        r = subprocess.run(["git", "-C", str(root), "log", f"--since={days}.days", "--first-parent", "--format=%s", "main"],
                           capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            r = subprocess.run(["git", "-C", str(root), "log", f"--since={days}.days", "--first-parent", "--format=%s"],
                               capture_output=True, text=True, timeout=30)
        return [l for l in r.stdout.splitlines() if l]
    except (OSError, subprocess.SubprocessError) as e:
        print(f"improve: git log failed: {e}", file=sys.stderr)
        return []


def tiers(root, cfg) -> list[dict]:
    out = []
    for t in cfg["tiers"]:
        hits = [s for s in merges(root, t["window_days"]) if re.search(t["evidence"], s) and "[skip ci]" not in s]
        out.append({"id": t["id"], "window_days": t["window_days"], "merges": len(hits), "alive": bool(hits)})
    return out


def _item(iid, title, owner, trigger, probe, prediction, body, labels, prio="p1"):
    return {"id": iid, "title": f"{iid}: {title}",
            "body": f"**Owner:** {owner}\n**Trigger:** {trigger}\n**Done check:** {probe}\n**Prediction:** {prediction}\n**Status:** open\n\n{body}\n\n**Closing probe:** {probe}\n",
            "labels": [prio, "agent-ready", f"role:{owner}"] + labels, "milestone": "Now", "workstream": "Growth"}


def _existing(root) -> dict:
    out = {}
    for p in (Path(root) / "docs/issues").glob("Q-IMPROVE-*.json"):
        try:
            j = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            continue
        out[j["id"]] = "open" if "**Status:** open" in j.get("body", "") else "closed"
    return out


# DECISION-METRIC: work-queue-priority (which reach, impact, plus and stall items enter the queue each pass; each is a row in ops/improve/ledger.jsonl and settled on its metric)
def plan(root=REPO, now=None) -> dict:
    root, now = Path(root), now or datetime.now(timezone.utc)
    cfg, have = load(root), _existing(root)
    sig, tr = signals(root, cfg, now), tiers(root, cfg)
    open_n = sum(1 for v in have.values() if v == "open")
    room = max(0, cfg["max_open_from_loop"] - open_n)
    files: list[dict] = []

    def add(it):
        # A stalled manager or a dead signal is a defect, not new work: it is filed whatever the cap says.
        defect = "stall" in it["labels"] or "signal" in it["labels"]
        if it["id"] not in have and (defect or sum(1 for f in files if not ({"stall", "signal"} & set(f["labels"]))) < room):
            files.append(it)

    # The plus budget is protected: its slot is taken before anything else can fill the room.
    fresh = [b for b in cfg["bank"] if f"Q-IMPROVE-{b['id']}" not in have]
    plus = [b for b in fresh if b["kind"] == "plus"][: cfg["plus_per_cycle"]]
    rest = [b for b in fresh if b["kind"] not in ("plus", "frontend", "backend")]

    def bank(b):
        base = metric_now(root, b["metric"])
        op = "<" if b.get("better") == "down" else ">"
        gate = "\n\n" + FRONTEND_GATE if b["kind"] == "frontend" else ""
        add(_item(f"Q-IMPROVE-{b['id']}", b["title"], OWNER[b["kind"]], "improve --run", b["probe"],
                  f"{b['metric']} {op} {base if base is not None else 0} within {cfg['settle_days'] * 24} h",
                  f"Kind: {b['kind']}. Baseline {b['metric']} = {base}. Settled {cfg['settle_days']} days after it closes: kept if {b['metric']} moved the right way, else replaced.{gate}",
                  ["growth", "improve", b["kind"]] + (["plus"] if b["kind"] == "plus" else [])))
    for b in plus:
        bank(b)
    # Both lanes every pass: one front-end and one back-end item are filed before the general bank.
    lanes = []
    for k in ("frontend", "backend"):
        nxt = next((b for b in fresh if b["kind"] == k), None)
        if nxt:
            lanes.append(nxt); bank(nxt)
    # Managers next: a stalled tier is the most urgent thing this loop can find.
    for t in tr:
        if not t["alive"]:
            add(_item(f"Q-IMPROVE-STALL-{t['id']}", f"{t['id']} manager landed no improvement in {t['window_days']} days", f"{t['id']}-manager",
                      "improve --run", f"cmd:python3 -m foundation improve --probe tier:{t['id']}", f"{t['id']}_merges >= 1 within {t['window_days'] * 24} h",
                      f"No merge on main matched this tier's evidence pattern in {t['window_days']} days. Take the highest-value item for this tier from the queue and ship it; if the queue holds none, file one from doctrine/improve.json.",
                      ["growth", "improve", "stall"], "p0"))
    for s in sig:
        if s["state"] != "ok" and s["id"] != "market":
            add(_item(f"Q-IMPROVE-SIGNAL-{s['id']}", f"{s['id']} signal is {s['state']}", "product-manager", "improve --run",
                      f"cmd:python3 -m foundation improve --probe signal:{s['id']}", f"signal_{s['id']}_ok == 1 within 72 h",
                      f"{s['path']} is {s['state']}. A signal nobody reads is a blind spot, not a quiet week. Restore the producer or give it a second route.",
                      ["growth", "improve", "signal"]))
    mk = next((s for s in sig if s["id"] == "market"), None)
    if mk and (mk["age_h"] is None or mk["age_h"] > cfg["market_max_age_days"] * 24):
        add(_item("Q-IMPROVE-MARKET", "market research pass is overdue", "product-manager", "improve --run",
                  "cmd:python3 -m foundation improve --probe signal:market", "signal_market_ok == 1 within 168 h",
                  "Run `python3 -m foundation rnd --run --apply` and `python3 -m foundation scout --run --apply`; every finding becomes a Q-RND, Q-EXP or Q-ADOPT item.",
                  ["growth", "improve", "market"]))
    # Reach and impact work every pass, whatever the signals say.
    for b in rest[: max(cfg["min_items_per_cycle"] - len(plus) - len(lanes), 1)]:
        bank(b)
    bank_left = len(fresh) - len([f for f in files if f["id"][10:] in {b["id"] for b in cfg["bank"]}])
    if bank_left <= 0 and len(files) < cfg["min_items_per_cycle"]:
        add(_item(f"Q-IMPROVE-BANK-{now:%Y%m%d}", "the improvement bank is empty; refill it", "portfolio-manager", "improve --run",
                  f"grep:doctrine/improve.json::bank-{now:%Y%m%d}", "bank_entries >= 3 within 72 h",
                  "Add at least three new reach, impact or plus entries to doctrine/improve.json (ids prefixed bank-YYYYMMDD), each with a probe that fails until the work exists. Draw from ops/rnd, ops/insight and the unknowns ledger.",
                  ["growth", "improve", "plus"]))
    return {"at": now.isoformat(), "signals": sig, "tiers": tr, "open": open_n, "filed": [f["id"] for f in files], "items": files,
            "settle": settle(root, cfg, now, have)}


def settle(root, cfg, now, have) -> list[dict]:
    rows = _rows(Path(root) / LEDGER)
    done = {r["id"] for r in rows if r.get("event") == "settled"}
    out = []
    for r in rows:
        if r.get("event") != "filed" or r["id"] in done or have.get(r["id"]) != "closed" or not r.get("metric"):
            continue
        at = _iso(r["at"])
        if at is None or now - at < timedelta(days=cfg["settle_days"]):
            continue
        cur, base = metric_now(root, r["metric"]), r.get("baseline")
        if cur is None or base is None:
            verdict = "unmeasured"
        else:
            better = cur < base if r.get("better") == "down" else cur > base
            verdict = "kept" if better else "replace"
        out.append({"id": r["id"], "metric": r["metric"], "baseline": base, "now": cur, "verdict": verdict})
    return out


def apply(root, p) -> None:
    root = Path(root)
    (root / "ops/improve").mkdir(parents=True, exist_ok=True)
    with (root / LEDGER).open("a", encoding="utf-8") as f:
        for it in p["items"]:
            path = root / "docs/issues" / f"{it['id']}.json"
            path.write_text(json.dumps(it, indent=2) + "\n", encoding="utf-8")
            m = re.search(r"\*\*Prediction:\*\* ([\w:]+) ([<>]) (\S+)", it["body"])
            f.write(json.dumps({"at": p["at"], "event": "filed", "id": it["id"], "metric": m.group(1) if m else None,
                                "baseline": float(m.group(3)) if m else None, "better": "down" if m and m.group(2) == "<" else "up"}) + "\n")
        for s in p["settle"]:
            f.write(json.dumps({"at": p["at"], "event": "settled", **s}) + "\n")
            if s["verdict"] == "replace":
                rid = f"{s['id']}-R"
                it = _item(rid, f"{s['id']} did not move {s['metric']}; revert or replace it", "product-manager", "improve --run",
                           f"cmd:python3 -m foundation improve --probe kept:{s['id']}", f"{s['metric']} > {s['baseline']} within 168 h",
                           f"{s['metric']} was {s['baseline']} at filing and {s['now']} a week after close. Revert the change if it costs anything to keep; otherwise ship the next idea for this metric.",
                           ["growth", "improve", "replace"])
                (root / "docs/issues" / f"{rid}.json").write_text(json.dumps(it, indent=2) + "\n", encoding="utf-8")
    slim = {k: v for k, v in p.items() if k != "items"}
    (root / STATUS).write_text(json.dumps(slim, indent=2) + "\n", encoding="utf-8")


def probe(root, spec) -> bool:
    kind, _, key = spec.partition(":")
    cfg, now = load(root), datetime.now(timezone.utc)
    if kind == "tier":
        return any(t["alive"] for t in tiers(root, cfg) if t["id"] == key)
    if kind == "signal":
        return any(s["state"] == "ok" for s in signals(root, cfg, now) if s["id"] == key)
    if kind == "kept":
        r = [r for r in _rows(Path(root) / LEDGER) if r.get("event") == "filed" and r["id"] == key]
        cur = metric_now(root, r[-1]["metric"]) if r and r[-1].get("metric") else None
        if not r or cur is None or r[-1].get("baseline") is None:
            return False
        return cur < r[-1]["baseline"] if r[-1].get("better") == "down" else cur > r[-1]["baseline"]
    return False


def check(root=REPO) -> list[str]:
    bad, cfg = [], load(root)
    if not 0 < cfg["plus_share"] <= 1 or cfg["plus_per_cycle"] < 1:
        bad.append("plus budget must be protected: plus_share in (0,1] and plus_per_cycle >= 1")
    if cfg["min_items_per_cycle"] < 1:
        bad.append("min_items_per_cycle must be at least 1: the loop always has work")
    for k in ("frontend", "backend"):
        if not any(b["kind"] == k for b in cfg["bank"]):
            bad.append(f"the bank needs at least one {k} entry: both lanes are automated (FRONTEND-AUTO-1)")
    if {t["id"] for t in cfg["tiers"]} != {"portfolio", "program", "project", "product"}:
        bad.append("every manager tier needs a window: portfolio, program, project, product")
    ids = [b["id"] for b in cfg["bank"]]
    if len(ids) != len(set(ids)):
        bad.append("bank ids repeat")
    for b in cfg["bank"]:
        if b["kind"] not in OWNER or not b.get("probe") or not b.get("metric"):
            bad.append(f"bank {b['id']}: needs kind, metric and probe")
    return bad


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="improve")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--report", action="store_true"); g.add_argument("--run", action="store_true")
    g.add_argument("--check", action="store_true"); g.add_argument("--probe")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args(argv)
    if a.check:
        bad = check(REPO)
        print("\n".join(bad) or "improve: ok")
        return 1 if bad else 0
    if a.probe:
        ok = probe(REPO, a.probe)
        print(f"{a.probe}: {'pass' if ok else 'fail'}")
        return 0 if ok else 1
    p = plan(REPO)
    if a.run and a.apply:
        apply(REPO, p)
    print(json.dumps({k: v for k, v in p.items() if k != "items"}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
