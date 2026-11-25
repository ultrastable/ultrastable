# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""RULES-1 (Rowan, 2026-11-18): every standing rule is enforced by deployed code, never by words. Ultrastable is the foundation for any autonomous system.

One registry (doctrine/rules.json) maps each rule to the CI checks that fail a change and the runtime probes the tick runs on main.
  python3 -m foundation rules --check            registry complete: each rule has a CI check present in a workflow, a runtime probe that resolves, no unfiled gap
  python3 -m foundation rules --run [--apply] [--due]   run every runtime probe; a violation files Q-RULE-<rule>-<probe> (done check = the probe) and runs the declared fix once
  python3 -m foundation rules --probe NAME       builtin probes: no-secrets, no-qnfo-pages, qnfo-live, license-notice, merged-green, pages-live, spinoff-live (exit 0 ok, 1 violated, 2 unmeasured)
  python3 -m foundation rules --status | --panel | --baseline
Unmeasured is never healthy: a probe that cannot read its source reports unmeasured and the rule shows it.
Consumers: .github/workflows/checks.yml, scripts/lane.sh (--run --apply --due), scripts/dashboard_snapshot.py (panel), tests/foundation/test_rules.py."""
from __future__ import annotations
import datetime as dt, fnmatch, json, re, shlex, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REG, BASE, STATUS, LEDGER = "doctrine/rules.json", "doctrine/rules-baseline.json", "ops/rules/status.json", "ops/rules/ledger.jsonl"
REQUIRED = ["closed-loops", "autonomy-first", "front-end-matches-back-end", "no-merge-over-red", "free-tier", "no-qnfo-on-pages", "license-notice", "no-secrets-in-logs"]
BUILTIN = {"no-secrets", "no-qnfo-pages", "qnfo-live", "license-notice", "merged-green", "pages-live", "spinoff-live"}


def jl(root, rel, default=None):
    try:
        return json.loads((Path(root) / rel).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _globbed(root, pats):
    return {p for g in pats for p in Path(root).glob(g) if p.is_file()}


def _files(root):
    r = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        return [str(p.relative_to(root)) for p in Path(root).rglob("*") if p.is_file() and ".git" not in p.parts]
    return r.stdout.splitlines()


def _exempt(rel, globs):
    return any(fnmatch.fnmatch(rel, g) or Path(rel).match(g) for g in globs)


def _cmd_resolves(root, cmd):
    a = shlex.split(cmd)
    if a[:3] == ["python3", "-m", "foundation"]:
        return (Path(root) / "foundation" / (a[3] + ".py")).is_file() or a[3] in ("directive", "loops", "queue", "kernel")
    for t in a[1:]:
        if t.endswith((".py", ".mjs", ".js", ".sh")):
            return (Path(root) / t).is_file()
    return False


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    d = jl(root, REG)
    if not d:
        return [f"{REG}: unreadable"]
    wf = "".join((root / w).read_text(encoding="utf-8") for w in d["workflows"] if (root / w).is_file())
    ids = [r["id"] for r in d["rules"]]
    bad += [f"rule {i} duplicated" for i in set(ids) if ids.count(i) > 1]
    bad += [f"required rule {i} missing from the registry" for i in REQUIRED if i not in ids]
    for r in d["rules"]:
        if not r.get("statement") or not r.get("source"):
            bad.append(f"{r['id']}: needs a statement and a source")
        if not r.get("ci"):
            bad.append(f"{r['id']}: no CI check enforces this rule")
        if not r.get("runtime"):
            bad.append(f"{r['id']}: no runtime probe enforces this rule")
        for c in r.get("ci", []):
            if c["cmd"] not in wf:
                bad.append(f"{r['id']}: CI check `{c['cmd']}` is not run by {', '.join(d['workflows'])}")
            elif not _cmd_resolves(root, c["cmd"]):
                bad.append(f"{r['id']}: CI check `{c['cmd']}` does not resolve")
        for p in r.get("runtime", []):
            if not p.get("id") or not _cmd_resolves(root, p["cmd"]):
                bad.append(f"{r['id']}: runtime probe {p.get('id')} `{p.get('cmd')}` does not resolve")
            if p["cmd"].startswith("python3 -m foundation rules --probe "):
                n = p["cmd"].rsplit(" ", 1)[1]
                if n not in BUILTIN:
                    bad.append(f"{r['id']}: unknown builtin probe {n}")
            if p.get("fix") and not _cmd_resolves(root, p["fix"]):
                bad.append(f"{r['id']}: fix `{p['fix']}` does not resolve")
        for g in r.get("gaps", []):
            if not (root / "docs/issues" / f"{g['item']}.json").is_file():
                bad.append(f"{r['id']}: gap '{g['what']}' has no filed item {g['item']} (owner, trigger, probe)")
    for r in d["rules"]:
        for c in r.get("ci", []):
            if c["cmd"].startswith("python3 -m foundation rules --probe ") and c["cmd"] not in wf:
                bad.append(f"{r['id']}: builtin CI probe not wired")
    return bad


# ---- builtin probes: return (status, detail); status ok | violated | unmeasured
def p_no_secrets(root, d):
    pats = [re.compile(p) for p in d["secret_patterns"]]
    hits = []
    for rel in _files(root):
        if _exempt(rel, d["secret_exempt_globs"]):
            continue
        try:
            t = (Path(root) / rel).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for n, ln in enumerate(t.splitlines(), 1):
            if any(p.search(ln) for p in pats):
                hits.append(f"{rel}:{n}")
    return ("violated", "secret-shaped value at " + ", ".join(hits[:5])) if hits else ("ok", "no secret-shaped value in tracked files")


def qnfo_counts(root, d):
    out = {}
    for p in sorted(_globbed(root, d["qnfo_scan_globs"])):
        rel = p.relative_to(root).as_posix()
        if _exempt(rel, d["qnfo_exempt_globs"]):
            continue
        n = len(re.findall(r"qnfo", p.read_text(encoding="utf-8", errors="replace"), re.I))
        if n:
            out[rel] = n
    return out


def p_no_qnfo(root, d):
    base = (jl(root, BASE, {}) or {}).get("qnfo", {})
    over = {k: (v, base.get(k, 0)) for k, v in qnfo_counts(root, d).items() if v > base.get(k, 0)}
    return ("violated", "QNFO grew on " + ", ".join(f"{k} {a}>{b}" for k, (a, b) in over.items())) if over else ("ok", "QNFO mentions on page sources at or below baseline")


def _fetch_text(url):
    import urllib.request
    with urllib.request.urlopen(url, timeout=15) as r:
        return r.read().decode("utf-8", errors="replace")


def p_qnfo_live(root, d, fetch=_fetch_text):
    """Rendered pages, not only sources: each page in qnfo_live_pages is fetched from the deployed site and the QNFO mentions it renders are
    compared with its baseline (rules-baseline.json qnfo.live, default 0, shrink-only). Data the sources do not carry (a feed, a ledger, a D1 row) is caught here.
    A page that cannot be fetched is unmeasured, never ok."""
    base = ((jl(root, BASE, {}) or {}).get("qnfo_live", {}))
    origin = d.get("qnfo_live_origin", "https://ultrastable.io")
    over, unreach = [], []
    for path in d.get("qnfo_live_pages", []):
        try:
            n = len(re.findall(r"qnfo", fetch(origin + path), re.I))
        except Exception as e:  # network, DNS, HTTP status: the page was not measured
            unreach.append(f"{path} ({type(e).__name__})")
            continue
        if n > base.get(path, 0):
            over.append(f"{path} {n}>{base.get(path, 0)}")
    if over:
        return "violated", "QNFO rendered on live pages: " + ", ".join(over)
    if unreach:
        return "unmeasured", "pages not fetched: " + ", ".join(unreach[:5])
    return "ok", f"{len(d.get('qnfo_live_pages', []))} rendered pages carry no QNFO beyond baseline"


def _gh(*a):
    r = subprocess.run(["gh", *a], capture_output=True, text=True, encoding="utf-8", timeout=60)
    return r.returncode, r.stdout + r.stderr


def p_license(root, d, run=_gh):
    pat, bad = re.compile(d["notice_pattern"]), []
    for repo in d["repos"]:
        c1, _ = run("api", f"repos/{d['org']}/{repo}/contents/LICENSE")
        c2, txt = run("api", "-H", "Accept: application/vnd.github.raw", f"repos/{d['org']}/{repo}/contents/README.md")
        if c1 and c2:
            return "unmeasured", f"{repo}: GitHub unreadable"
        if c1:
            bad.append(f"{repo}: no LICENSE"); continue
        if c2:
            bad.append(f"{repo}: no README"); continue
        if not pat.search(txt):
            bad.append(f"{repo}: README lacks the license notice")
    return ("violated", "; ".join(bad)) if bad else ("ok", f"LICENSE and README notice in {len(d['repos'])} repositories")


def p_merged_green(root, d):
    from . import mergeaudit
    try:
        rows = mergeaudit.scan(root, apply=False)
    except Exception as e:  # unreadable is unmeasured, never green
        return "unmeasured", str(e)[:120]
    return ("violated", "merged without green checks: " + ", ".join("#%s" % r["pr"] for r in rows)) if rows else ("ok", "every recent merge had a green checks run")


def p_pages_live(root, d, now=None):
    """Slot for the page-freshness probe (thread 'Make every site page truly live'): it writes ops/pages-live.json {at, failing: [...]}."""
    s = jl(root, "ops/pages-live.json")
    if not s:  # each deployed site answers for itself: /api/freshness is 200 when every source is inside its cadence, 503 when stale
        import urllib.request, urllib.error
        urls = d.get("pages_live_urls") or ["https://ultrastable.io/api/freshness"]
        stale, unmeasured = [], []
        for u in urls:
            try:
                urllib.request.urlopen(u, timeout=15)
            except urllib.error.HTTPError as e:
                (stale if e.code == 503 else unmeasured).append(f"{u} ({e.code})")
            except (urllib.error.URLError, OSError) as e:
                unmeasured.append(f"{u} ({type(e).__name__})")
        if stale:
            return "violated", "a page source is stale: " + ", ".join(stale)
        if unmeasured:
            return "unmeasured", "not measured: " + ", ".join(unmeasured)
        return "ok", f"{len(urls)} /api/freshness route(s) answered 200"
    now = now or dt.datetime.now(dt.timezone.utc)
    if (now - dt.datetime.fromisoformat(s["at"].replace("Z", "+00:00"))).total_seconds() > 26 * 3600:
        return "unmeasured", "page-freshness result is older than 26 h"
    return ("violated", "pages not live: " + ", ".join(map(str, s["failing"][:5]))) if s.get("failing") else ("ok", "every checked page is live and fresh")


def p_spinoff_live(root, d, now=None):
    """SPINOFF-GOOD-1: every launched live-feed/live-lookup app answers /api/freshness 200 (503 = its public source failed). None launched yet is unmeasured, never ok."""
    import urllib.request, urllib.error
    apps = [a for a in (json.loads(p.read_text(encoding="utf-8")) for p in sorted((Path(root) / "instances/spinoffs").glob("*/app.json")))
            if a.get("live") and a.get("status") in ("live", "iterating", "promoted")]
    if not apps:
        return "unmeasured", "no live public-benefit app is launched yet"
    bad, unreach = [], []
    for a in apps:
        try:
            urllib.request.urlopen(f"https://{a['slug']}.ultrastable.app/api/freshness", timeout=15)
        except urllib.error.HTTPError as e:
            (bad if e.code == 503 else unreach).append(a["slug"])
        except (urllib.error.URLError, OSError):
            unreach.append(a["slug"])
    if bad:
        return "violated", "source not live: " + ", ".join(bad)
    return ("unmeasured", "unreachable: " + ", ".join(unreach)) if unreach else ("ok", f"{len(apps)} public-benefit apps live and fresh")


def builtin(name, root=REPO):
    d = jl(root, REG)
    return {"no-secrets": p_no_secrets, "no-qnfo-pages": p_no_qnfo, "qnfo-live": p_qnfo_live, "license-notice": p_license, "merged-green": p_merged_green, "pages-live": p_pages_live, "spinoff-live": p_spinoff_live}[name](root, d)


# ---- runtime tick
def _sh(cmd, root, timeout=300):
    r = subprocess.run(shlex.split(cmd), cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=timeout)
    return r.returncode, (r.stdout + r.stderr).strip().splitlines()[-1][:160] if (r.stdout + r.stderr).strip() else ""


def probe_once(p, root, sh=_sh):
    if p["cmd"].startswith("python3 -m foundation rules --probe "):
        st, detail = builtin(p["cmd"].rsplit(" ", 1)[1], root)
        return st, detail
    try:
        code, detail = sh(p["cmd"], root)
    except (subprocess.TimeoutExpired, OSError) as e:
        return "unmeasured", f"{type(e).__name__}"
    return ("ok" if code == 0 else "unmeasured" if (p.get("needs_network") and code == 2) else "violated"), detail


def item(rule, p, detail):
    iid = f"Q-RULE-{rule['id']}-{p['id']}"
    body = (f"**Owner:** staff\n**Trigger:** every lane pass (rules --run --due)\n**Done check:** cmd:{p['cmd']}\n"
            f"**Prediction:** rule_probe_failures <= 0 within 24 h\n**Out of scope:** weakening the rule or its probe to make it pass\n**Status:** open\n\n"
            f"RULES-1: the standing rule `{rule['id']}` is violated: {rule['statement']}\nProbe `{p['id']}` says: {detail}\n\n"
            f"Fix the cause in code so the probe passes; the tick re-runs it every pass. Never weaken the probe or the registry.")
    return {"id": iid, "title": f"{iid}: standing rule {rule['id']} violated ({p['id']})", "body": body, "labels": ["role:staff", "ci-failure"], "milestone": "Now", "workstream": "Reliability"}


def run(root=REPO, apply=False, due=False, now=None, sh=_sh) -> dict:
    root = Path(root); now = now or dt.datetime.now(dt.timezone.utc)
    d, old = jl(root, REG), jl(root, STATUS, {"probes": {}}) or {"probes": {}}
    if due and old.get("at") and (now - dt.datetime.fromisoformat(old["at"].replace("Z", "+00:00"))).total_seconds() < d["interval_h"] * 3600:
        return old
    probes, filed = {}, []
    for r in d["rules"]:
        for p in r["runtime"]:
            st, detail = probe_once(p, root, sh)
            fixed = False
            if st == "violated" and p.get("fix") and apply:
                sh(p["fix"], root)
                st2, detail2 = probe_once(p, root, sh)
                fixed, st, detail = st2 == "ok", st2, detail2
            f = root / "docs/issues" / f"Q-RULE-{r['id']}-{p['id']}.json"
            if st == "violated" and apply and not f.exists():
                f.write_text(json.dumps(item(r, p, detail), indent=2, ensure_ascii=False) + "\n", encoding="utf-8"); filed.append(f.stem)
            probes[f"{r['id']}/{p['id']}"] = {"status": st, "detail": detail, "fixed": fixed, "item": f.stem if st == "violated" else None}
    out = {"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "probes": probes, "filed": filed, "rules": summarize(root, d, probes)}
    if apply:
        (root / STATUS).parent.mkdir(parents=True, exist_ok=True)
        (root / STATUS).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        prev = {k: v["status"] for k, v in old.get("probes", {}).items()}
        ch = {k: v["status"] for k, v in probes.items() if prev.get(k) != v["status"]}
        if ch:
            with (root / LEDGER).open("a", encoding="utf-8") as fh:
                fh.write(json.dumps({"at": out["at"], "changed": ch}) + "\n")
    return out


def summarize(root, d, probes) -> dict:
    wf = "".join((Path(root) / w).read_text(encoding="utf-8") for w in d["workflows"] if (Path(root) / w).is_file())
    res = {}
    for r in d["rules"]:
        sts = [probes.get(f"{r['id']}/{p['id']}", {}).get("status", "unmeasured") for p in r["runtime"]]
        ci = all(c["cmd"] in wf for c in r["ci"]) and bool(r["ci"])
        s = "violated" if "violated" in sts else "unmeasured" if "unmeasured" in sts else "partial" if r.get("gaps") else "enforced"
        res[r["id"]] = {"status": s if ci else "no-ci", "ci": len(r["ci"]), "probes": len(sts), "gaps": [g["what"] for g in r.get("gaps", [])], "statement": r["statement"]}
    return res


def panel(root=REPO) -> dict:
    s = jl(root, STATUS)
    if not s:
        return {"id": "rules", "title": "Standing rules enforced in code", "rows": [["no run recorded yet", "python3 -m foundation rules --run --apply has not written ops/rules/status.json", "warn"]]}
    rows = []
    for k, v in s["rules"].items():
        rows.append([k, f"{v['status']}; {v['ci']} CI check(s), {v['probes']} runtime probe(s)" + ("; gap: " + "; ".join(v["gaps"]) if v["gaps"] else ""), "ok" if v["status"] == "enforced" else "warn"])
    rows.append(["last run", s["at"] + (f"; filed {', '.join(s['filed'])}" if s["filed"] else ""), "info"])
    return {"id": "rules", "title": "Standing rules enforced in code (RULES-1, from ops/rules/status.json)", "rows": rows}


def main(argv) -> int:
    if argv[:1] == ["--check"]:
        bad = check()
        print("rules ok" if not bad else "\n".join(bad)); return 1 if bad else 0
    if argv[:1] == ["--probe"]:
        st, detail = builtin(argv[1]); print(f"{st}: {detail}"); return {"ok": 0, "violated": 1}.get(st, 2)
    if argv[:1] == ["--baseline"]:
        d = jl(REPO, REG); cur = qnfo_counts(REPO, d); b = jl(REPO, BASE)
        b["qnfo"] = {k: min(v, b["qnfo"].get(k, v)) for k, v in cur.items()}
        (REPO / BASE).write_text(json.dumps(b, indent=1) + "\n", encoding="utf-8"); print(f"baseline {len(b['qnfo'])} page source(s)"); return 0
    if argv[:1] == ["--panel"]:
        print(json.dumps(panel(), indent=1)); return 0
    if argv[:1] == ["--status"]:
        s = jl(REPO, STATUS, {}); print(json.dumps(s.get("rules", {}), indent=1)); return 0
    if argv[:1] == ["--run"]:
        o = run(REPO, apply="--apply" in argv, due="--due" in argv)
        print(json.dumps({k: v["status"] for k, v in o["rules"].items()}, indent=1) if "rules" in o else "{}"); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
