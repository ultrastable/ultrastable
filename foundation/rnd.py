"""RND-1: the product manager's research, development and competitive-analysis loop, as code. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation rnd --check              declaration valid, every capability names a component and a probe, state parses
  python3 -m foundation rnd --run [--apply]      refresh every competitor profile that is due, diff it against its last refresh, diff the market against what this
                                                 repository proves, file gap items, propose experiments, triage open scout findings into executor tasks, score
                                                 shipped and stalled work, re-weight scout sources and recompute item priorities; --apply writes
  python3 -m foundation rnd --report             profiles, market coverage and priorities
  python3 -m foundation rnd --proved CAPABILITY  exit 0 once this repository's proof of the capability exists (done check of the gap and experiment items)
  python3 -m foundation rnd --holds SPEC         exit 0 when a file: or grep: proof holds (done check of an adopted task)
  python3 -m foundation rnd --metrics            competitor_coverage_gaps, adoption_shipped and the other numbers the loop's items predict

Data: doctrine/competitors.json (capability taxonomy, competitors, cadence), ops/rnd/profiles/<id>.json (capabilities each competitor evidences, with the sentence),
ops/rnd/log.jsonl (one row per pass), ops/rnd/experiments.jsonl, ops/rnd/outcomes.jsonl, ops/rnd/priorities.json (read by foundation/growth.py prefer),
ops/rnd/triage.json (decisions on scout findings, as data with a reason). Feedback: a shipped adoption raises its source's weight and its priority, a declined or
stalled one lowers both, so the next pass reads and builds toward what paid off. Fetching is injected; tests use recorded pages.
"""
from __future__ import annotations
import datetime as dt, hashlib, json, re, sys
from pathlib import Path
from . import scout

REPO = Path(__file__).resolve().parents[1]
PATH, STATE = "doctrine/competitors.json", "ops/rnd"


PROVED, HOLDS = "cmd:python3 -m foundation rnd --proved ", "cmd:python3 -m foundation rnd --holds "
SCOPE = "**Out of scope:** rebuilding a competitor's product, claims about a competitor beyond what its own page states, and any change without a test."


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def _read(root, name, default):
    p = Path(root) / STATE / name
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() and p.read_text(encoding="utf-8").strip() else default


def _rows(root, name) -> list[dict]:
    p = Path(root) / STATE / name
    out = []
    for line in (p.read_text(encoding="utf-8").splitlines() if p.is_file() else []):
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out


def _append(root, name, row) -> None:
    base = Path(root) / STATE; base.mkdir(parents=True, exist_ok=True)
    with open(base / name, "a", encoding="utf-8") as f:
        f.write(json.dumps(row) + "\n")


def _ts(now) -> str:
    return now.strftime("%Y-%m-%dT%H:%M:%SZ")


def probe_ok(root, spec: str) -> bool:
    root = Path(root)
    if spec.startswith(PROVED):  # the done check this loop writes on its own items, answered here without a subprocess
        c = next((x for x in load(root)["capabilities"] if x["id"] == spec[len(PROVED):].strip()), None)
        return bool(c) and probe_ok(root, c["ours"])
    if spec.startswith(HOLDS):
        return probe_ok(root, spec[len(HOLDS):].strip().strip("'\""))
    if spec.startswith("file:"):
        return (root / spec[5:]).is_file()
    if spec.startswith("grep:"):
        f, _, rx = spec[5:].partition("::")
        p = root / f
        return p.is_file() and re.search(rx, p.read_text(encoding="utf-8")) is not None
    return False


def page_text(kind: str, text: str) -> str:
    if kind == "atom":
        return " ".join(e["title"] + ". " + e["summary"] for e in scout.parse("atom", text))
    return re.sub(r"\s+", " ", re.sub(r"<(script|style)[^>]*>.*?</\1>|<[^>]+>", " ", text, flags=re.S | re.I))


def detect(text: str, caps: list[dict]) -> dict:
    """capability id -> the sentence that evidences it."""
    out = {}
    for c in caps:
        m = re.search(c["rx"], text, re.I)
        if m:
            a = max(0, m.start() - 70)
            out[c["id"]] = text[a:m.end() + 70].strip()
    return out


def due(profile: dict | None, comp: dict, cfg: dict, now) -> bool:
    if not profile or not profile.get("refreshed_at"):
        return True
    age = now - dt.datetime.strptime(profile["refreshed_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    return age >= dt.timedelta(days=comp.get("cadence_days", cfg["cadence_days"]) - 1)


def refresh(root, cfg, fetch, now, apply) -> dict:
    """Refresh every due competitor profile. Returns {id: {changed, appeared, lost, errors, skipped}}."""
    res = {}
    # TAXONOMY-NEW-1: a capability is news only if the loop could already see it. One added to the taxonomy today matches pages that have said it for
    # months; reading that as "the competitor added it" filed three experiments on 2026-11-26, two of them shipped the moment they were filed.
    known = set()
    for old in profiles(root).values():
        known |= set(old.get("taxonomy") or old.get("capabilities", {}))
    for comp in cfg["competitors"]:
        p = Path(root) / STATE / "profiles" / (comp["id"] + ".json")
        old = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else None
        if not due(old, comp, cfg, now):
            res[comp["id"]] = {"skipped": True}; continue
        text, errors = "", {}
        for s in comp["sources"]:
            try:
                text += " " + page_text(s["kind"], fetch(s["url"]))
            except Exception as e:  # a dead source is recorded, never swallowed
                errors[s["url"]] = f"{type(e).__name__}: {e}"[:140]
        if not text.strip():
            res[comp["id"]] = {"errors": errors, "changed": False, "appeared": [], "lost": []}; continue
        caps = detect(text, cfg["capabilities"])
        before = set((old or {}).get("capabilities", {}))
        new = {"id": comp["id"], "name": comp["name"], "refreshed_at": _ts(now), "sha": hashlib.sha1(text.encode()).hexdigest()[:12], "capabilities": caps, "errors": errors,
               "taxonomy": sorted(c["id"] for c in cfg["capabilities"]), "sources_read": [s["url"] for s in comp["sources"] if s["url"] not in errors]}
        # a source that could not be read is unmeasured: a capability only it evidenced is carried forward, never reported as lost
        if old and errors:
            for k, v in old.get("capabilities", {}).items():
                new["capabilities"].setdefault(k, v)
        caps = new["capabilities"]
        res[comp["id"]] = {"changed": bool(old) and old.get("sha") != new["sha"], "appeared": sorted(c for c in set(caps) - before if c in known) if old else [], "lost": sorted(before - set(caps)) if old else [], "errors": errors}
        if apply:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(new, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    return res


def profiles(root) -> dict:
    d = Path(root) / STATE / "profiles"
    return {f.stem: json.loads(f.read_text(encoding="utf-8")) for f in sorted(d.glob("*.json"))} if d.is_dir() else {}


def coverage(root, cfg, profs) -> list[dict]:
    """Per capability: which competitors evidence it, and whether this repository proves it."""
    out = []
    for c in cfg["capabilities"]:
        who = sorted(k for k, p in profs.items() if c["id"] in p.get("capabilities", {}))
        out.append({"id": c["id"], "component": c["component"], "gap": c.get("gap"), "competitors": who, "ours": probe_ok(root, c["ours"]), "ours_probe": c["ours"]})
    return out


def _issue(root, iid, title, body, labels, workstream="Growth") -> bool:
    p = Path(root) / "docs/issues" / f"{iid}.json"
    if p.exists():
        return False
    p.write_text(json.dumps({"id": iid, "title": f"{iid}: {title}", "body": body, "labels": labels, "milestone": "Next", "workstream": workstream}, indent=2) + "\n", encoding="utf-8")
    return True


def file_gaps(root, cfg, cov, apply) -> list[str]:
    """A capability at least min_competitors evidence and this repository lacks becomes a queue item, unless an existing Q-GAP item already carries it."""
    out = []
    for c in cov:
        if c["ours"] or len(c["competitors"]) < cfg["min_competitors"]:
            continue
        if c["gap"] and (Path(root) / "docs/issues" / f"Q-GAP-{c['gap']}.json").exists():
            out.append("Q-GAP-" + c["gap"]); continue  # carried by the existing item; priorities() raises it
        iid = "Q-RND-GAP-" + c["id"]
        open_gaps = sum(1 for x in cov if not x["ours"] and len(x["competitors"]) >= cfg["min_competitors"])
        body = (f"**Owner:** product-manager\n**Trigger:** every rnd pass\n**Done check:** {PROVED}{c['id']}\n**Prediction:** competitor_coverage_gaps <= {open_gaps - 1} within 336 h\n**Status:** open\n\n"
                f"R&D finding: {len(c['competitors'])} competitors ({', '.join(c['competitors'])}) evidence the capability `{c['id']}` ({next(x['what'] for x in cfg['capabilities'] if x['id'] == c['id'])}) on their own pages (sentence and source per competitor in ops/rnd/profiles/) and this repository has no proof of it. "
                f"Build it with a test; the done check passes once the proof `{c['ours_probe']}` exists.\n\n{SCOPE}\n\n**Closing probe:** {PROVED}{c['id']}")
        if apply:
            _issue(root, iid, f"close the competitive gap: {c['id']}", body, ["role:product-manager", "growth", "rnd"])
        out.append(iid)
    return out


def propose_experiments(root, cfg, findings, apply, now) -> list[str]:
    """One experiment per finding, up to the per-run cap: a hypothesis, a metric from doctrine/growth.json, a prediction and a closing probe."""
    seen = {r["id"] for r in _rows(root, "experiments.jsonl")}
    out = []
    for f in findings:
        eid = "Q-EXP-" + hashlib.sha1(f["key"].encode()).hexdigest()[:8]
        if eid in seen or len(out) >= cfg["max_experiments_per_run"]:
            continue
        metric = cfg["metric_for"].get(f["capability"], cfg["metric_for"]["default"])
        base = next((m.get("baseline") for m in json.loads((Path(root) / "doctrine/growth.json").read_text(encoding="utf-8"))["metrics"] if m["id"] == metric), None)
        row = {"at": _ts(now), "id": eid, "finding": f["key"], "hypothesis": f["hypothesis"], "metric": metric, "prediction": f"{metric} >= {base if isinstance(base, (int, float)) else 0} within 336 h", "probe": f["probe"]}
        out.append(eid)
        if apply:
            _append(root, "experiments.jsonl", row)
            body = (f"**Owner:** product-manager\n**Trigger:** every rnd pass\n**Done check:** {PROVED}{f['capability']}\n**Prediction:** {row['prediction']}\n**Status:** open\n\n"
                    f"Experiment from R&D finding `{f['key']}`.\nHypothesis: {f['hypothesis']}\nMetric: {metric}. Ship the smallest change the proof `{f['probe']}` shows, then compare the metric against its baseline in doctrine/growth.json; a miss reverts the change and lowers the finding's priority."
                    f"\n\n{SCOPE}\n\n**Closing probe:** {PROVED}{f['capability']}")
            _issue(root, eid, f["title"], body, ["role:product-manager", "growth", "rnd", "experiment"])
    return out


def _open_scout(root) -> list[dict]:
    done = {r["id"] for r in scout._rows(root, "adopted.jsonl")}
    out = []
    for f in sorted((Path(root) / "docs/issues").glob("Q-SCOUT-*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        if d["id"] not in done:
            out.append(d)
    return out


def finding_text(body: str) -> str:
    """The finding's own words: the release note between the item's header and its `Decide:` instruction. The header and the instruction are the same in
    every item (they say `outcome`, `gap`, `adopted`), so counting them matched a WAF advisory to the executor-merged-pr gap on 2026-11-26 (TRIAGE-TEXT-1)."""
    m = re.search(r"Scout finding from [^\n]*\n(.*?)(?:\n\nThis is a new version of a standard|\n\nDecide:|\Z)", body, re.S)
    return m.group(1) if m else body


def triage(root, cfg, now, apply) -> list[dict]:
    """Decide every open scout finding. A decision in ops/rnd/triage.json wins; without one a finding matching a gap with at least 3 shared tokens is adopted (linked to
    that gap's item), any other is declined with its reason. Adopting files an executor task (Q-ADOPT-*) unless a gap item already carries the work."""
    decisions, market, scfg = _read(root, "triage.json", {}), json.loads((Path(root) / "doctrine/market.json").read_text(encoding="utf-8")), scout.load(root)
    out = []
    for it in _open_scout(root):
        d = decisions.get(it["id"])
        if not d:
            m = re.search(r"matched ([^\n]*)", it["body"]); gaps = [x[4:] for x in (m.group(1).split(", ") if m else []) if x.startswith("gap:")]
            g = next((g for g in market["gaps"] if g["id"] in gaps), None)
            shared = len(scout.tokens(finding_text(it["body"])) & scout.tokens(g["title"] + " " + g.get("why", ""))) if g else 0
            d = ({"outcome": "adopted", "reason": f"matches open gap {g['id']} ({shared} shared terms)", "task": "Q-GAP-" + g["id"]} if g and shared >= 3 else
                 {"outcome": "declined", "reason": "no open gap shares three or more terms with this release note"})
        row = {"id": it["id"], **d}
        if apply:
            scout.adopt(root, it["id"], d["outcome"], d["reason"], now)
            if d["outcome"] == "adopted" and d.get("probe") and d.get("task", "").startswith("Q-ADOPT-"):
                _issue(root, d["task"], d["title"], f"**Owner:** product-manager\n**Trigger:** every rnd pass\n**Done check:** {HOLDS}'{d['probe']}'\n**Prediction:** adoption_shipped >= 1 within 336 h\n**Status:** open\n\n{d['body']}\n\nAdopted from {it['id']}: {d['reason']}\n\n{SCOPE}\n\n**Closing probe:** {HOLDS}'{d['probe']}'", ["role:product-manager", "growth", "rnd", "adopted"])
        out.append(row)
    return out


def _task_probe(root, tid) -> str | None:
    p = Path(root) / "docs/issues" / f"{tid}.json"
    if not p.is_file():
        return None
    m = re.search(r"\*\*Done check:\*\*\s*(\S.*)", json.loads(p.read_text(encoding="utf-8"))["body"])
    return m.group(1).strip() if m else None


def outcomes(root, cfg, now, apply) -> list[dict]:
    """Score adopted tasks, gap items and experiments once each: shipped when the done check passes, stalled when it still fails after stall_days."""
    done = {r["id"]: r for r in _rows(root, "outcomes.jsonl")}
    out = []
    for f in sorted((Path(root) / "docs/issues").glob("Q-*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        if not re.match(r"Q-(ADOPT|EXP|RND-GAP)-", f.stem) or f.stem in done:
            continue
        probe = _task_probe(root, f.stem)
        if not probe:
            continue
        if probe_ok(root, probe):
            res = "shipped"
        else:
            age = now - dt.datetime.fromtimestamp(f.stat().st_mtime, dt.timezone.utc)
            if age < dt.timedelta(days=cfg["stall_days"]):
                continue
            res = "stalled"
        row = {"at": _ts(now), "id": f.stem, "outcome": res}
        out.append(row)
        if apply:
            _append(root, "outcomes.jsonl", row)
    return out


def source_of(root, tid) -> str:
    """The scout source an adopted task descends from, read from the adoption reason in its body."""
    p = Path(root) / "docs/issues" / f"{tid}.json"
    m = re.search(r"Adopted from (Q-SCOUT-[^\s:]+)", json.loads(p.read_text(encoding="utf-8"))["body"]) if p.is_file() else None
    return scout.src_of(m.group(1), scout.load(root)) if m else ""


def feedback(root, results, now, apply) -> list[dict]:
    """A shipped or stalled outcome re-weights the scout source it descends from (shipped counts as adopted again, stalled as declined)."""
    out = []
    for r in results:
        s = source_of(root, r["id"])
        if s:
            out.append({"source": s, "id": r["id"], "outcome": r["outcome"]})
            if apply:
                scout.adopt(root, f"Q-SCOUT-{s}-{r['id'][-8:]}", "adopted" if r["outcome"] == "shipped" else "declined", f"{r['id']} {r['outcome']}", now)
    return out


def priorities(root, cfg, cov) -> dict:
    """Item id -> priority multiplier: 1 plus half a point per competitor evidencing the capability, plus a point once shipped work descends from the same source."""
    pr = {}
    for c in cov:
        if not c["ours"] and c["competitors"]:
            iid = ("Q-GAP-" + c["gap"]) if c["gap"] and (Path(root) / "docs/issues" / f"Q-GAP-{c['gap']}.json").exists() else "Q-RND-GAP-" + c["id"]
            pr[iid] = round(1 + 0.5 * len(c["competitors"]), 2)
    w = _read(root, "../scout/weights.json", {})
    for f in (Path(root) / "docs/issues").glob("Q-SCOUT-*.json"):
        s = scout.src_of(f.stem, scout.load(root))
        if s in w:
            pr[f.stem] = round(w[s]["weight"], 2)
    return pr


def boost(issues: list[dict], root=REPO) -> list[dict]:
    """Executor hook: stable-sort takeable issues by their R&D priority (default 1)."""
    p = _read(root, "priorities.json", {})
    att = _read(root, "../temporal/attention.json", {})  # TEMPORAL-1: weight by the advocate role that owns the item: neglected areas rise, hot ones fall
    def key(i):
        t = i.get("title", "")
        iid = t.split(":", 1)[0]
        own = re.search(r"\*\*Owner:\*\*\s*([\w-]+)", i.get("body", "") or "")
        return -p.get(iid, 1.0) * att.get(own.group(1) if own else "", 1.0)
    return sorted(issues, key=key)


def run(root=REPO, fetch=scout.http, now=None, apply=False) -> dict:
    cfg, now = load(root), now or dt.datetime.now(dt.timezone.utc)
    ref = refresh(root, cfg, fetch, now, apply)
    cov = coverage(root, cfg, profiles(root) if apply else profiles(root))
    findings = []
    for cid, r in ref.items():
        for cap in r.get("appeared", []):
            c = next(x for x in cfg["capabilities"] if x["id"] == cap)
            if probe_ok(root, c["ours"]):
                continue  # already proven here: there is nothing to ship, so no experiment is filed
            if c.get("gap") and (Path(root) / "docs/issues" / f"Q-GAP-{c['gap']}.json").exists():
                continue  # the gap's own item carries the work and priorities() raises it; a second item for the same proof is a duplicate
            findings.append({"key": f"{cid}:{cap}", "capability": cap, "title": f"respond to {cid} adding {cap}", "hypothesis": f"{cid} now evidences '{c['what']}'; shipping our proof of it keeps the product at parity", "probe": c["ours"]})
    for c in cov:
        if not c["ours"] and len(c["competitors"]) >= cfg["min_competitors"]:
            findings.append({"key": "gap:" + c["id"], "capability": c["id"], "title": f"close the {c['id']} gap with a measured change", "hypothesis": f"{len(c['competitors'])} competitors evidence '{next(x['what'] for x in cfg['capabilities'] if x['id'] == c['id'])}'; building it should move the metric", "probe": c["ours_probe"]})
    gaps = file_gaps(root, cfg, cov, apply)
    exps = propose_experiments(root, cfg, findings, apply, now)
    tri = triage(root, cfg, now, apply)
    outc = outcomes(root, cfg, now, apply)
    fb = feedback(root, outc, now, apply)
    if apply:
        scfg = scout.load(root)
        w = scout._j(root, "weights.json", {})
        w = scout.reweight(root, scfg, w, {}, count_quiet=False)  # outcomes only; the scout pass already counted this week
        (Path(root) / "ops/scout/weights.json").write_text(json.dumps(w, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    pr = priorities(root, cfg, cov)
    row = {"at": _ts(now), "refreshed": [k for k, v in ref.items() if not v.get("skipped")], "errors": {k: v["errors"] for k, v in ref.items() if v.get("errors")},
           "appeared": {k: v["appeared"] for k, v in ref.items() if v.get("appeared")}, "gaps": gaps, "experiments": exps,
           "triaged": [{"id": t["id"], "outcome": t["outcome"]} for t in tri], "outcomes": outc, "feedback": fb, "priorities": len(pr)}
    if apply:
        base = Path(root) / STATE; base.mkdir(parents=True, exist_ok=True)
        (base / "priorities.json").write_text(json.dumps(pr, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        _append(root, "log.jsonl", row)
    return row


def metrics(root=REPO) -> dict:
    """The numbers this loop's own items predict, measured from its data: `competitor_coverage_gaps` (capabilities at least min_competitors evidence
    that this repository does not prove), `adoption_shipped` (adopted tasks whose proof exists), and how much of the register is profiled or unread."""
    cfg, profs, log = load(root), profiles(root), _rows(root, "log.jsonl")
    cov = coverage(root, cfg, profs)
    return {"competitor_coverage_gaps": sum(1 for c in cov if not c["ours"] and len(c["competitors"]) >= cfg["min_competitors"]),
            "capabilities": len(cov), "competitors": len(cfg["competitors"]), "competitors_profiled": sum(1 for c in cfg["competitors"] if c["id"] in profs),
            "competitor_sources_unreachable": sum(len(v) for v in ((log[-1].get("errors") or {}).values() if log else [])),
            "adoption_shipped": sum(1 for r in _rows(root, "outcomes.jsonl") if r.get("outcome") == "shipped" and r.get("id", "").startswith("Q-ADOPT-")),
            "rnd_last_pass": log[-1]["at"] if log else None}


def report(root=REPO) -> dict:
    cfg = load(root)
    return {"coverage": coverage(root, cfg, profiles(root)), "priorities": _read(root, "priorities.json", {}), "passes": len(_rows(root, "log.jsonl")), "metrics": metrics(root)}


def plug_in_problems(c: dict, root=REPO) -> list[str]:
    """BORROW-1: a competitor's best step is plugged in as a worker, never rebuilt; every row says who covers it meanwhile."""
    p = c.get("plug_in")
    if not p: return []
    bad, cid = [], c["id"]
    if p.get("role") not in ("reviewer", "executor", "builder", "observer"): bad.append(f"{cid}: plug_in role {p.get('role')} unknown")
    if p.get("status") not in ("staged", "live", "declined"): bad.append(f"{cid}: plug_in status {p.get('status')} unknown")
    if not p.get("default"): bad.append(f"{cid}: plug_in has no default in effect")
    if not str(p.get("source", "")).startswith("https://"): bad.append(f"{cid}: plug_in cost needs an https source")
    probe = str(p.get("probe", ""))
    if not probe.startswith(("file:", "grep:")): bad.append(f"{cid}: plug_in probe must be file: or grep:")
    if p.get("status") == "declined" and not p.get("reason"): bad.append(f"{cid}: declined plug_in needs a reason")
    if p.get("status") == "live" and not _probe_ok(root, probe): bad.append(f"{cid}: plug_in says live but {probe} fails")
    return bad


def _probe_ok(root, spec: str) -> bool:
    if spec.startswith("file:"): return (Path(root) / spec[5:]).exists()
    path, _, rx = spec[5:].partition("::")
    f = Path(root) / path
    return f.exists() and re.search(rx, f.read_text(encoding="utf-8", errors="replace")) is not None


def check(root=REPO) -> list[str]:
    cfg, bad = load(root), []
    mk = json.loads((Path(root) / "doctrine/market.json").read_text(encoding="utf-8"))
    comps, gaps, ids = {c["id"] for c in mk["components"]}, {g["id"] for g in mk["gaps"]}, set()
    for c in cfg["capabilities"]:
        if c["id"] in ids: bad.append("duplicate capability " + c["id"])
        ids.add(c["id"])
        if c["component"] not in comps: bad.append(f"{c['id']}: component {c['component']} is not in doctrine/market.json")
        if c.get("gap") and c["gap"] not in gaps: bad.append(f"{c['id']}: gap {c['gap']} is not in doctrine/market.json")
        if not c["ours"].startswith(("file:", "grep:")): bad.append(f"{c['id']}: ours must be a file: or grep: probe")
        try: re.compile(c["rx"])
        except re.error as e: bad.append(f"{c['id']}: rx does not compile ({e})")
    for k in cfg["metric_for"].values():
        if k not in {m["id"] for m in json.loads((Path(root) / "doctrine/growth.json").read_text(encoding="utf-8"))["metrics"]}: bad.append("metric_for names an unknown growth metric " + k)
    for c in cfg["competitors"]:
        for s in c["sources"]:
            if not s["url"].startswith("https://") or s["kind"] not in ("page", "atom"): bad.append(f"{c['id']}: bad source {s}")
        bad += plug_in_problems(c, root)
    for n in ("triage.json", "priorities.json"):
        try: _read(root, n, {})
        except ValueError: bad.append(f"ops/rnd/{n} does not parse")
    return bad


def main(argv: list[str]) -> int:
    a = list(argv)
    if "--run" in a:
        print(json.dumps(run(apply="--apply" in a), indent=1)); return 0
    if "--report" in a:
        print(json.dumps(report(), indent=1)); return 0
    for flag, pre in (("--proved", PROVED), ("--holds", HOLDS)):  # SPEC-GATE-1: the done check and closing probe this loop writes on the items it files
        if flag in a:
            arg = a[a.index(flag) + 1]; ok = probe_ok(REPO, pre + arg)
            print(f"{arg}: {'proved' if ok else 'not proved'}"); return 0 if ok else 1
    if "--metrics" in a:
        print(json.dumps(metrics(), indent=1)); return 0
    bad = check(); print("\n".join(bad) or "rnd ok"); return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
