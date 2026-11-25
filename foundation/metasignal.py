"""META-SIGNAL-1: the meta content of every utterance and every microphone event feeds process improvement (owner, 2026-11-14).

  python3 -m foundation metasignal --check                 detector config is valid and every detector matches its own sample
  python3 -m foundation metasignal --scan FILE [--source S] extract signals from a transcript (one utterance per line)
  python3 -m foundation metasignal --ingest FILE [--apply]  scan, append to docs/meta/signals.jsonl, file roadmap issues docs/issues/META-<n>.json

Data: doctrine/meta-loop.json. Deterministic, no model call. Raw audio is never stored; only transcript text, mic event codes and signals.
"""
from __future__ import annotations
import argparse, datetime as dt, hashlib, json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CFG = "doctrine/meta-loop.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / CFG).read_text(encoding="utf-8"))


def detect(text: str, cfg: dict | None = None) -> list[dict]:
    """Signals found in one utterance: [{kind, weight, match}]."""
    cfg = cfg or load()
    out = []
    for d in cfg["detectors"]:
        for p in d["patterns"]:
            m = re.search(p, text, re.I)
            if m:
                out.append({"kind": d["kind"], "weight": d["weight"], "match": m.group(0)})
                break
    return out


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def scan(text: str, source: str = "chat", cfg: dict | None = None, now: str | None = None) -> list[dict]:
    cfg, now = cfg or load(), now or _now()
    rows = []
    for n, line in enumerate((l.strip() for l in text.splitlines()), 1):
        for s in (detect(line, cfg) if line else []):
            rows.append({"at": now, "source": source, "line": n, "excerpt": line[:200],
                         "id": hashlib.sha1(f"{source}|{n}|{s['kind']}|{line}".encode()).hexdigest()[:10], **s})
    return rows


def mic_event(code: str, cfg: dict | None = None, at: str | None = None, surface: str = "site") -> list[dict]:
    """A microphone event code (no audio) as a signal row; unknown codes are ignored."""
    cfg = cfg or load()
    c = cfg["mic_events"]["codes"].get(code)
    if not c:
        return []
    at = at or _now()
    return [{"at": at, "source": "mic-event", "line": 0, "excerpt": f"{surface}:{code}", "kind": c["kind"], "weight": c["weight"], "match": code,
             "id": hashlib.sha1(f"{surface}|{code}|{at}".encode()).hexdigest()[:10]}]


def _issue(kind: str, rows: list[dict], cfg: dict, n: int) -> dict:
    roadmap = next((d["roadmap"] for d in cfg["detectors"] if d["kind"] == kind), None) or \
        next(c["roadmap"] for c in cfg["mic_events"]["codes"].values() if c["kind"] == kind)
    ev = "; ".join(f"\"{r['excerpt'][:90]}\"" for r in rows[:3])
    p = cfg["issue_prefix"]
    return {"id": f"{p}{n}", "title": f"{p}{n}: {kind} signal x{len(rows)} in owner utterances and voice surfaces",
            "body": f"**Owner:** Product manager\n**Trigger:** META-SIGNAL-1 ingest\n**Done check:** python3 -m foundation metasignal --check\n**Status:** open\n\n"
                    f"Meta signal `{kind}` seen {len(rows)} time(s). Evidence: {ev}. Action: {roadmap} Closing probe: the same detector finds no new `{kind}` signal in 14 days.",
            "labels": ["role:product", "ws:meta-loop"], "milestone": "Next", "workstream": "Product"}


def _due(kind: str, rs: list[dict], cfg: dict) -> bool:
    if kind.startswith("mic-"):
        return len(rs) >= cfg["mic_events"]["thresholds"]["file_issue_when_count_at_least"]
    return sum(r["weight"] for r in rs) >= cfg["thresholds"]["file_issue_when_weight_at_least"]


def ingest(root: Path, rows: list[dict], cfg: dict, apply: bool = False) -> dict:
    root = Path(root)
    sink, issues = root / cfg["sink"], root / "docs/issues"
    seen = {json.loads(l)["id"] for l in sink.read_text(encoding="utf-8").splitlines() if l.strip()} if sink.exists() else set()
    fresh = [r for r in rows if r["id"] not in seen]
    by_kind: dict[str, list[dict]] = {}
    for r in fresh:
        by_kind.setdefault(r["kind"], []).append(r)
    nums = [int(m.group(1)) for p in issues.glob(f"{cfg['issue_prefix']}*.json") if (m := re.search(r"(\d+)$", p.stem))]
    n, filed = max(nums, default=0), []
    for kind, rs in by_kind.items():
        if _due(kind, rs, cfg):
            n += 1
            filed.append(_issue(kind, rs, cfg, n))
    if apply:
        sink.parent.mkdir(parents=True, exist_ok=True)
        issues.mkdir(parents=True, exist_ok=True)
        with sink.open("a", encoding="utf-8") as f:
            f.writelines(json.dumps(r) + "\n" for r in fresh)
        for i in filed:
            (issues / f"{i['id']}.json").write_text(json.dumps(i, indent=2) + "\n", encoding="utf-8")
    return {"signals": len(fresh), "duplicates": len(rows) - len(fresh), "issues": [i["id"] for i in filed]}


SAMPLES = {"frustration": "I'm not going to keep telling you", "repeat-directive": "I already said never stop", "correction": "that's not what I asked",
           "idea": "what if we recorded everything", "confusion": "I don't understand this step", "stall": "it is stuck", "delight": "that is perfect",
           "owner-found-first": "this should have been detected automatically"}


def check(root=REPO) -> list[str]:
    cfg, errs = load(root), []
    for d in cfg["detectors"]:
        k = d["kind"]
        if k not in SAMPLES:
            errs.append(f"no sample for detector {k}")
        elif k not in {s["kind"] for s in detect(SAMPLES[k], cfg)}:
            errs.append(f"detector {k} misses its own sample")
        for p in d["patterns"]:
            try:
                re.compile(p)
            except re.error as e:
                errs.append(f"bad pattern {p}: {e}")
    for code in cfg["mic_events"]["codes"]:
        if not mic_event(code, cfg, "2026-11-14T00:00:00+00:00"):
            errs.append(f"mic code {code} yields no signal")
    return errs


def main(argv=None) -> int:
    a = argparse.ArgumentParser(prog="metasignal")
    a.add_argument("--check", action="store_true")
    a.add_argument("--scan")
    a.add_argument("--ingest")
    a.add_argument("--source", default="chat")
    a.add_argument("--apply", action="store_true")
    o = a.parse_args(argv)
    if o.scan or o.ingest:
        rows = scan(Path(o.scan or o.ingest).read_text(encoding="utf-8"), o.source)
        print(json.dumps(ingest(REPO, rows, load(), o.apply) if o.ingest else rows, indent=1))
        return 0
    errs = check()
    print("metasignal: " + ("OK" if not errs else "; ".join(errs)))
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
