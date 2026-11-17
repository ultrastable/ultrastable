# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""UIUX-1: the UI/UX manager as a closed loop. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation uiux [--check | --tick [--apply [--pr]] | --status | --paths | --funnels | --experiments [--apply] | --data [--apply] | --probe SLUG]

SENSE      the browser audit (scripts/uiux_audit.mjs: accessibility, user/system boundary, page structure, copy, performance, visual fingerprint, and every
           user path from doctrine/stakeholders.json walked as a real click-through flow) writes ops/uiux/audit.json; this module adds the checks that need no
           browser (design lint, brand lint, claims drift) and reads first-party, cookieless path analytics (hits in D1) as per-path funnels.
DIAGNOSE   a blocking finding, a happy path that no longer walks, or a funnel whose completion fell below drop_ratio of its own trailing median.
ACT        one `Q-UIUX-*` item per kind and rule (agent-ready, with a closing probe) that the executor's self-coding agent works into a PR; a running A/B experiment
           that reached its pre-registered sample is decided by design.evaluate and a kept arm becomes the served default (site/uiux-data.js, generated).
VERIFY     the item's probe re-runs the audit for the pages it names; the next audit run either still reports the finding (the item stays open) or not (it closes).
WRITE-BACK ops/uiux/status.json carries the two essential variables (ui_findings, happy_paths) the slow loop in foundation/ultrastability.py reads; every
           reading, filing and verdict is a row in ops/uiux/ledger.jsonl.
Doctrine and thresholds: doctrine/uiux.json. Tests: tests/foundation/test_uiux.py. Workflow: .github/workflows/uiux.yml (weekly) and the product manager pass (daily).
"""
from __future__ import annotations
import json, math, os, re, subprocess, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/uiux.json"
DAY = 86400


def load(root=REPO) -> dict:
    p = Path(root) / PATH
    return json.loads((p if p.is_file() else REPO / PATH).read_text(encoding="utf-8"))


def _read(root, rel, default):
    p = Path(root) / rel
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else default


def _write(root, rel, doc):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ts(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-")


# ---- user paths: the stakeholder doctrine is the single source ----

def user_paths(root=REPO, c=None) -> list[dict]:
    """Every user path: each audience's entry page and its ordered steps, plus the declared extra paths. Same derivation as scripts/uiux_audit.mjs."""
    c = c or load(root)
    sh = json.loads((Path(root) / "doctrine/stakeholders.json").read_text(encoding="utf-8"))
    out = []
    for a in sh["audiences"]:
        hrefs = [s["href"] for s in a["path"]] + [a["cta"]["href"]]
        steps = [h for i, h in enumerate(hrefs) if h.startswith("/") and h not in hrefs[:i]]
        out.append({"id": "audience-" + a["id"], "audience": a["id"], "entry": "/for/" + a["id"], "steps": steps, "stories": len(a.get("stories", []))})
    for p in c["paths"]["extra"]:
        out.append({"id": p["id"], "audience": p["audience"], "entry": p["entry"], "steps": p["steps"], "stories": 0})
    return out


# ---- funnels from first-party hits ----

def funnel(rows: list[dict], entry: str, steps: list[str], now: float, window_days: int) -> dict:
    """Share of one day's visitors who reached `entry` and then each later step in order. A visitor id rotates daily, so a path is measured inside a day."""
    chain = [entry] + list(steps)
    seen: dict = {}
    for r in rows:
        if r.get("bot") or r.get("name", "pageview") != "pageview" or not (now - window_days * DAY <= r["at"] <= now):
            continue
        seen.setdefault((r["vid"], int(r["at"] // DAY)), []).append((r["at"], r["path"]))
    reached = [0] * len(chain)
    for evs in seen.values():
        i = 0
        for _, p in sorted(evs):
            if i < len(chain) and p == chain[i]:
                reached[i] += 1
                i += 1
    return {"entries": reached[0], "reached": reached, "completion": round(reached[-1] / reached[0], 4) if reached[0] else None}


def judge_drop(history: list[dict], now_day: dict, p: dict) -> dict | None:
    """A drop is the latest completion under drop_ratio of the median of earlier days, with enough entries on both sides to mean it."""
    prior = [h["completion"] for h in history if h.get("completion") is not None and h.get("entries", 0) >= p["min_entries"]]
    if now_day.get("completion") is None or now_day.get("entries", 0) < p["min_entries"] or len(prior) < p["baseline_min_days"]:
        return None
    med = sorted(prior)[len(prior) // 2]
    return {"median": med, "now": now_day["completion"]} if med > 0 and now_day["completion"] < p["drop_ratio"] * med else None


# ---- sources of hits ----

class RowsSource:
    def __init__(self, rows):
        self.rows = rows

    def visits(self, since: float) -> tuple[list[dict], bool]:
        return [r for r in self.rows if r["at"] >= since], False


class D1Source:
    """Aggregated reads of the hits table over the Cloudflare API (the same account and database insight.py reads). Capped: truncation is reported, never silent."""
    CAP = 20000

    def __init__(self, token: str, acct: str, db: str):
        self.token, self.acct, self.db = token, acct, db

    def _q(self, sql: str) -> list[dict]:
        from . import clock
        return clock._cf(f"d1/database/{self.db}/query", {"sql": sql}, self.token, self.acct)["result"][0]["results"]

    def visits(self, since: float) -> tuple[list[dict], bool]:
        at = int(since * 1000)  # hits.at is epoch milliseconds
        out, cut = [], False
        for where in ("name='pageview'", "name LIKE 'exp:%'"):
            r = self._q(f"SELECT vid, at, path, name FROM hits WHERE bot=0 AND at>={at} AND {where} ORDER BY at LIMIT {self.CAP + 1}")
            cut = cut or len(r) > self.CAP
            out += [{"vid": x["vid"], "at": x["at"] / 1000.0, "path": x["path"], "name": x["name"], "bot": 0} for x in r[: self.CAP]]
        return out, cut


def source_from_env(root=REPO, env=None):
    env = os.environ if env is None else env
    if env.get("CLOUDFLARE_API_TOKEN"):
        from . import insight
        s = insight.load(root)["source"]
        return D1Source(env["CLOUDFLARE_API_TOKEN"], s["account"], s["db"])
    return None


# ---- experiments on path steps ----

def tally(rows: list[dict], exp: dict) -> dict:
    """Per arm: visitors exposed, those who then reached convert_on the same day (conversion), and those who saw only the exposed page (bounce)."""
    out = {}
    pv: dict = {}
    for r in rows:
        if r.get("name", "pageview") == "pageview" and not r.get("bot"):
            pv.setdefault(r["vid"], []).append((r["at"], r["path"]))
    expo: dict = {}
    for r in rows:
        m = re.fullmatch(r"exp:" + re.escape(exp["id"]) + r":([a-z0-9-]+)", r.get("name", ""))
        if m and not r.get("bot"):
            expo.setdefault((r["vid"], m.group(1)), r["at"])
    for a in exp["arms"]:
        vids = {v: t for (v, arm), t in expo.items() if arm == a["id"]}
        conv = sum(1 for v, t in vids.items() if any(p == exp["convert_on"] and at >= t for at, p in pv.get(v, [])))
        bounce = sum(1 for v in vids if len({p for _, p in pv.get(v, [])}) <= 1 and len(pv.get(v, [])) <= 1)
        out[a["id"]] = {"n": len(vids), "conv": conv, "bounce": bounce}
    return out


def decide(exp: dict, t: dict, now: float, c: dict, pol: dict) -> dict:
    from . import design
    ids = [a["id"] for a in exp["arms"]]
    a, b = t[ids[0]], t[ids[1]]
    tol = c["experiments"]["guard_tolerance"]
    guards = [g for g in exp.get("guard_metrics", []) if g not in c["experiments"]["measurable_guards"]]
    guards_ok = not (a["n"] and b["n"] and "bounce_rate" in exp.get("guard_metrics", []) and b["bounce"] / b["n"] - a["bounce"] / a["n"] > tol)
    days = int((now - _ts(exp["started"] + "T00:00:00Z")) // DAY) if exp.get("started") else 0
    v = design.evaluate(a["n"], a["conv"], b["n"], b["conv"], pol, guards_ok, days)
    v.update({"arms": t, "guards_ok": guards_ok, "unmeasured_guards": guards, "days": days})
    return v


def served(root=REPO) -> dict:
    """What site/worker.js serves: running experiments that declare a slot, and the promoted defaults."""
    c = load(root)
    ex = _read(root, "doctrine/design-experiments.json", {"experiments": []})["experiments"]
    run = [{"id": e["id"], "path": e["path"], "slot": e["slot"], "convert_on": e["convert_on"], "arms": [{"id": a["id"], "overrides": a.get("overrides", {})} for a in e["arms"]]}
           for e in ex if e.get("status") == "running" and e.get("slot")]
    return {"running": run, "defaults": c["experiments"]["defaults"]}


def render(root=REPO) -> str:
    return ("// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n// GENERATED by python3 -m foundation uiux --data --apply from doctrine/uiux.json and doctrine/design-experiments.json. Do not edit; --check fails when stale.\n"
            "export default " + json.dumps(served(root), indent=1, sort_keys=True) + ";\n")


def settle_experiments(root, rows, now, apply=False) -> list[dict]:
    c = load(root)
    path = Path(root) / "doctrine/design-experiments.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    pol, out = doc["policy"], []
    for e in doc["experiments"]:
        if e.get("status") != "running" or not e.get("slot"):
            continue
        t = tally(rows, e)
        v = decide(e, t, now, c, pol)
        row = {"id": e["id"], **{k: v[k] for k in v if k != "arms"}, "arms": v["arms"]}
        out.append(row)
        if v["verdict"] == "continue":
            continue
        if apply:
            e["status"], e["verdict"], e["settled_at"] = v["verdict"], {k: v.get(k) for k in ("z", "p", "lift", "reason", "guards_ok", "days")}, _iso(now)
            if v["verdict"] == "kept":
                win = e["arms"][1].get("overrides", {})
                cfg = json.loads((Path(root) / PATH).read_text(encoding="utf-8"))
                cfg["experiments"]["defaults"][e["slot"]] = win
                (Path(root) / PATH).write_text(json.dumps(cfg, indent=1) + "\n", encoding="utf-8")
            path.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
            (Path(root) / c["served"]).write_text(render(root), encoding="utf-8")
            _append(root, c, {"at": _iso(now), "ev": "verdict", "id": e["id"], "verdict": v["verdict"], "p": v.get("p"), "lift": v.get("lift"), "arms": v["arms"]})
    return out


# ---- findings ----

def read_report(root=REPO, c=None) -> dict | None:
    """The offline audit (every user page and path, in process) with the findings of the latest live audit of the real hosts and tenant apps added when it is as fresh."""
    c = c or load(root)
    rep = _read(root, c["audit_report"], None)
    live = _read(root, c["audit_report"].replace("audit.json", "audit-live.json"), None)
    if rep and live and abs(_ts(live["at"]) - _ts(rep["at"])) <= c["fresh_days"] * DAY:
        rep = {**rep, "findings": rep["findings"] + [{**f, "live": True} for f in live["findings"]], "live_hosts": live.get("hosts", [])}
    return rep


def static_findings(root=REPO) -> tuple[list[dict], list[str]]:
    """Checks that need no browser. A check that cannot run is listed as unmeasured, never as passing."""
    f, unmeasured = [], []
    try:
        from . import design
        new, _stale = design.lint_gate(root)
        f += [{"kind": "design", "path": "*", "viewport": "-", "rule": "design-lint", "detail": n[:200]} for n in new]
    except (OSError, ValueError, KeyError) as e:
        unmeasured.append("design: " + type(e).__name__)
    try:
        from . import brandcheck
        f += [{"kind": "brand", "path": "*", "viewport": "-", "rule": "brand-lint", "detail": b[:200]} for b in brandcheck.check(root)]
    except (OSError, ValueError, KeyError) as e:
        unmeasured.append("brand: " + type(e).__name__)
    try:
        from . import claims
        f += [{"kind": "claims", "path": d.get("surface", "*"), "viewport": "-", "rule": "claim-drift", "detail": (d.get("id", "") + " " + d.get("detail", ""))[:200]} for d in claims.evaluate(root)[2] if str(d.get("surface", "")).startswith(("site/", "seed/site/"))]  # page copy only; README drift stays with the claims loop
    except (OSError, ValueError, KeyError) as e:
        unmeasured.append("claims: " + type(e).__name__)
    return f, unmeasured


def blocking(c, f) -> bool:
    return c["audits"].get(f["kind"]) == "blocking"


def funnels_run(root, c, rows, now, apply=False) -> tuple[dict, list[dict]]:
    p = c["paths"]
    st = _read(root, c["funnels"], {"paths": {}})
    out, found = {}, []
    day = _iso(now)[:10]
    for up in user_paths(root, c):
        f = funnel(rows, up["entry"], up["steps"], now, p["window_days"])
        h = st["paths"].setdefault(up["id"], {"history": []})
        drop = judge_drop([x for x in h["history"] if x["day"] != day], f, p)
        out[up["id"]] = {**f, "drop": drop}
        if drop:
            found.append({"kind": "path-drop", "path": up["entry"], "viewport": "-", "rule": up["id"], "detail": f"completion {drop['now']} vs median {drop['median']} over earlier days"})
        if apply and f["entries"]:
            h["history"] = [x for x in h["history"] if x["day"] != day][-60:] + [{"day": day, "entries": f["entries"], "completion": f["completion"]}]
    if apply:
        st["at"] = _iso(now)
        _write(root, c["funnels"], st)
    return out, found


def _append(root, c, row: dict) -> None:
    p = Path(root) / c["ledger"]
    p.parent.mkdir(parents=True, exist_ok=True)
    n = len(p.read_text(encoding="utf-8").splitlines()) if p.is_file() else 0
    with p.open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps({**row, "seq": n}, sort_keys=True) + "\n")


def _open_slugs(root) -> set[str]:
    from . import queue as qmod
    return {it["id"] for it in qmod.items(root) if it["id"].startswith("Q-UIUX-") and it["status"] == "open"}


def file_items(root, c, findings: list[dict], apply=False) -> list[str]:
    """One item per kind and rule, listing the pages it hits; an open item for the same slug is never duplicated."""
    it, open_ids, filed = c["item"], _open_slugs(root), []
    groups: dict = {}
    for f in findings:
        groups.setdefault((f["kind"], f["rule"]), []).append(f)
    for (kind, rule), fs in sorted(groups.items(), key=lambda kv: (not blocking(c, kv[1][0]), kv[0])):
        if len(filed) >= it["max_new_per_run"]:
            break
        slug = _slug(f"{kind}-{rule}")[:60]
        if any(i == f"Q-UIUX-{slug}" or i.startswith(f"Q-UIUX-{slug}-") for i in open_ids):
            continue
        n = sum(1 for p in (Path(root) / "docs/issues").glob(f"Q-UIUX-{slug}*.json"))
        iid = f"Q-UIUX-{slug}" + (f"-{n + 1}" if n else "")
        pages = sorted({f"{x['path']} ({x['viewport']})" for x in fs})[: it["max_pages_listed"]]
        body = (f"**Owner:** {it['owner']}\n**Trigger:** the UI/UX audit found `{rule}` ({kind}) on {len(fs)} page view(s)\n**Done check:** cmd:python3 -m foundation uiux --probe {slug}\n**Status:** open\n\n"
                f"UIUX-1 finding. {fs[0]['detail']}\n\nPages: {', '.join(pages)}\n\nFix the page or the shared component that renders it (site/ and the design tokens), keep the single-primary-action, 44px tap, "
                f"AA contrast and plain-language rules, and never relax doctrine/uiux.json to clear the finding. Re-run `node scripts/uiux_audit.mjs --only <path>` to confirm.\n\n"
                f"size: S\n\n**Closing probe:** `python3 -m foundation uiux --probe {slug}` exits 0 (the finding no longer reproduces).\n")
        if apply:
            (Path(root) / "docs/issues").mkdir(parents=True, exist_ok=True)
            (Path(root) / "docs/issues" / (iid + ".json")).write_text(json.dumps({"id": iid, "title": f"{iid}: front-end {kind}: {rule}", "body": body, "labels": it["labels"], "milestone": "Now", "workstream": it["workstream"]}, indent=2) + "\n", encoding="utf-8")
        filed.append(iid)
    return filed


def status_doc(c, report, extra, paths, exps, unmeasured, now) -> dict:
    """The two essential variables. A variable with no fresh browser audit is None (unmeasured), never in bounds."""
    findings = (report or {}).get("findings", []) + extra
    fresh = bool(report) and now - _ts(report["at"]) <= c["fresh_days"] * DAY
    walks = (report or {}).get("paths", [])
    return {"at": _iso(now), "audit_at": (report or {}).get("at"), "audit_fresh": fresh, "audit_mode": (report or {}).get("mode"), "pages": (report or {}).get("pages", 0),
            "findings_total": len(findings), "findings_blocking": sum(1 for f in findings if blocking(c, f)) if fresh else None,
            "by_kind": {k: sum(1 for f in findings if f["kind"] == k) for k in sorted({f["kind"] for f in findings})},
            "happy_path_pass_share": round(sum(1 for w in walks if w["ok"]) / len(walks), 3) if fresh and walks else None,
            "paths": paths, "experiments": exps, "unmeasured": unmeasured}


def tick(root=REPO, apply=False, now=None, rows=None, report=None, source=None, static=True) -> dict:
    root = Path(root)
    c = load(root)
    now = now if now is not None else datetime.now(timezone.utc).timestamp()
    report = report if report is not None else read_report(root, c)
    extra, unmeasured = static_findings(root) if static else ([], [])
    cut = False
    if rows is None:
        src = source or source_from_env(root)
        if src is None:
            unmeasured.append("analytics: no CLOUDFLARE_API_TOKEN, funnels and experiments not read")
        else:
            try:
                rows, cut = src.visits(now - 35 * DAY)
            except Exception as e:  # an unreadable source is unmeasured, never a crash of the pass and never a pass
                unmeasured.append("analytics: " + type(e).__name__ + " " + str(e)[:120])
    funnels, found_drops, exps = {}, [], []
    if rows is not None:
        funnels, found_drops = funnels_run(root, c, rows, now, apply)
        exps = settle_experiments(root, rows, now, apply)
    if cut:
        unmeasured.append("analytics: result capped, counts are a lower bound")
    findings = (report or {}).get("findings", []) + extra + found_drops
    fresh = bool(report) and now - _ts(report["at"]) <= c["fresh_days"] * DAY
    if report is None:
        unmeasured.append("audit: no ops/uiux/audit.json yet (run scripts/uiux_audit.mjs --write)")
    elif not fresh:
        unmeasured.append("audit: report older than fresh_days")
    st = status_doc(c, report, extra + found_drops, funnels, exps, unmeasured, now)
    filed = file_items(root, c, [f for f in findings if blocking(c, f)] + [f for f in findings if not blocking(c, f) and f["kind"] != "visual-drift"], apply) if fresh or found_drops or extra else []
    out = {"status": st, "filed": filed}
    if apply:
        _write(root, c["status"], st)
        (Path(root) / c["served"]).write_text(render(root), encoding="utf-8")
        _append(root, c, {"at": _iso(now), "ev": "tick", "blocking": st["findings_blocking"], "total": st["findings_total"], "happy": st["happy_path_pass_share"], "filed": filed, "unmeasured": len(unmeasured)})
        if filed:
            from . import provenance
            provenance.record(root, {"class": "loop", "actor": "uiux-manager", "channel": "loop-run"}, "change", f"UI/UX audit filed {len(filed)} fix item(s): {', '.join(filed)}", ref=filed[0], affected=["front-end"],
                              effect={"status": "pending", "metric": "ui_findings", "note": "ui_findings <= 0 within 168 h"})
    return out


# ---- the closing probe: does this finding still reproduce? ----

def probe(slug: str, root=REPO) -> int:
    """0 when the finding group named by the item's slug no longer reproduces (re-measured now, never read from a stale report); 1 when it does; 2 when it cannot be measured here."""
    root = Path(root)
    c = load(root)
    kind = next((k for k in sorted(c["audits"], key=len, reverse=True) if slug.startswith(k + "-")), None)
    if kind is None:
        print("unknown slug", slug)
        return 2
    rule = slug[len(kind) + 1:]
    if kind in ("design", "brand", "claims"):
        f, un = static_findings(root)
        if un:
            print("unmeasured:", "; ".join(un))
            return 2
        hit = [x for x in f if x["kind"] == kind]
    elif kind == "path-drop":
        print("a path drop is settled by the next funnel run, not re-measured here")
        return 2
    else:
        rep = read_report(root, c) or {"findings": []}
        pages = sorted({x["path"] for x in rep["findings"] if x["kind"] == kind and _slug(x["rule"]) == rule and x["path"].startswith("/")})
        if not pages:
            print("no recorded pages for", slug, "- nothing reproduces")
            return 0
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "audit.json"
            r = subprocess.run(["node", "scripts/uiux_audit.mjs", "--only", ",".join(pages), "--out", str(out)], cwd=root, capture_output=True, text=True, timeout=600)
            if not out.is_file():
                print("unmeasured: the browser audit did not run:", (r.stderr or r.stdout)[-200:])
                return 2
            hit = [x for x in json.loads(out.read_text(encoding="utf-8"))["findings"] if x["kind"] == kind and _slug(x["rule"]) == rule]
    for x in hit[:5]:
        print(x["kind"], x["path"], x["rule"], x["detail"])
    return 1 if hit else 0


# ---- declaration check and variables for the slow loop ----

def status_reading(root, key: str, now=None):
    """Read by foundation/ultrastability.py: a value only from a fresh audit, else None (unmeasured)."""
    c = load(root)
    st = _read(root, c["status"], None)
    if not st or not st.get("audit_fresh"):
        return None
    if now is not None and now - _ts(st["audit_at"]) > c["fresh_days"] * DAY:
        return None
    return st.get(key)


def check(root=REPO) -> list[str]:
    root, errs = Path(root), []
    c = load(root)
    for k in ("ledger", "status", "audit_report", "baseline", "funnels", "served", "item_prefix", "audits", "boundary", "paths", "experiments", "item", "essential_variables"):
        if k not in c:
            errs.append("missing " + k)
    if errs:
        return errs
    for k, v in c["audits"].items():
        if k.startswith("_"):
            continue
        if v not in ("blocking", "warning"):
            errs.append(f"audit kind {k} has severity {v!r}")
    for rx in c["boundary"]["forbidden"] + c["copy"]["placeholders"]:
        try:
            re.compile(rx)
        except re.error as e:
            errs.append(f"bad pattern {rx!r}: {e}")
    for f in ("scripts/uiux_audit.mjs", ".github/workflows/uiux.yml", "agents/roles/uiux-manager.md", "tests/foundation/test_uiux.py"):
        if not (root / f).is_file():
            errs.append("missing " + f)
    up = user_paths(root, c)
    if not up or any(not p["steps"] for p in up):
        errs.append("a user path has no internal steps: " + ", ".join(p["id"] for p in up if not p["steps"]))
    for e in _read(root, "doctrine/design-experiments.json", {"experiments": []})["experiments"]:
        if e.get("slot"):
            for k in ("path", "convert_on", "started"):
                if k not in e:
                    errs.append(f"experiment {e['id']} declares a slot but no {k}")
            if len(e.get("arms", [])) != 2:
                errs.append(f"experiment {e['id']}: served experiments have exactly two arms (control and one variant)")
            if e.get("status") == "running" and e.get("metric") != "setup_click_rate" and not e.get("convert_on"):
                errs.append(f"experiment {e['id']}: no conversion path")
    from . import ultrastability
    ids = {v["id"] for v in ultrastability.load(root)["scopes"]["platform"]["variables"]}
    for v in c["essential_variables"]:
        if v not in ids:
            errs.append(f"essential variable {v} is not declared in doctrine/ultrastability.json")
    if (root / c["served"]).is_file() and (root / c["served"]).read_text(encoding="utf-8") != render(root):
        errs.append(f"{c['served']} is stale: run uiux --data --apply")
    return errs


def publish(root=REPO, filed=None) -> dict:
    """Open the pass's changes as a pull request through the executor's own path (draft, ready, checks dispatched; the lane merges on green)."""
    from . import executor
    st = subprocess.run(["git", "-C", str(root), "status", "--porcelain"], capture_output=True, text=True, encoding="utf-8").stdout.strip()
    if not st:
        return {"pr": None, "why": "nothing changed"}
    day = datetime.now(timezone.utc).strftime("%Y%m%d%H")
    n = len(filed or [])
    subprocess.run(["python3", "-m", "foundation", "writeback", "record", "--kind", "decision", "--title", f"UI/UX manager pass {day}: {n} fix item(s) filed", "--body",
                    "Audit status, funnels, experiment verdicts and fix items recorded in ops/uiux/ by foundation/uiux.py; tests pass.", "--owner", "uiux-manager", "--probe", "file:ops/uiux/status.json"],
                   cwd=str(root), capture_output=True, text=True, encoding="utf-8")
    return executor.publish_change(executor.REPO_SLUG, root, f"agent/uiux-{day}", f"UI/UX manager pass: {n} front-end fix item(s) filed", "Filed by the UI/UX manager loop (foundation/uiux.py); see ops/uiux/status.json.")


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--check" in a:
        e = check()
        print("\n".join(e) or "uiux ok: audits, paths, experiments and essential variables are declared and consumed")
        return 1 if e else 0
    if "--probe" in a and len(a) > a.index("--probe") + 1:
        return probe(a[a.index("--probe") + 1])
    if "--paths" in a:
        print(json.dumps(user_paths(), indent=1))
        return 0
    if "--data" in a:
        if "--apply" in a:
            c = load()
            (REPO / c["served"]).write_text(render(), encoding="utf-8")
            print("wrote", c["served"])
        else:
            print(render())
        return 0
    if "--experiments" in a:
        src = source_from_env()
        if src is None:
            print("unmeasured: no CLOUDFLARE_API_TOKEN")
            return 0
        rows, _ = src.visits(datetime.now(timezone.utc).timestamp() - 35 * DAY)
        print(json.dumps(settle_experiments(REPO, rows, datetime.now(timezone.utc).timestamp(), "--apply" in a), indent=1))
        return 0
    if "--tick" in a or "--status" in a or "--funnels" in a:
        r = tick(apply="--apply" in a and "--tick" in a)
        if "--pr" in a and "--apply" in a:
            r["publish"] = publish(REPO, r["filed"])
        print(json.dumps(r["status"]["paths"] if "--funnels" in a else r, indent=1))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
