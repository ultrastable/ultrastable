#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# SMOKE-LIVE-1: every public claim, checked against PRODUCTION. Read-only except the optional --cap probe. Exit 1 on any failure.
# Each check is (id, claim, function returning (ok, evidence)). A check that cannot run is UNTESTED, never PASS.
import csv, io, json, os, re, sys, urllib.request, urllib.error, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
from smoke_probe import get

IO, ORG = "https://ultrastable.io", "https://ultrastable.org"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = []

def check(cid, claim):
    def deco(fn):
        try:
            ok, ev = fn()
        except Exception as e:  # a crashing check is a failing check
            ok, ev = False, "check crashed: " + repr(e)
        R.append({"id": cid, "claim": claim, "result": "PASS" if ok else ("UNTESTED" if ok is None else "FAIL"), "evidence": str(ev)[:300]})
        return fn
    return deco

def page(u):
    r = get(u); return r, r["body"]

@check("org-catalogue-count", "/catalogue lists ~789 problems")
def _():
    r, b = page(ORG + "/catalogue.csv")
    rows = list(csv.reader(io.StringIO(b))) if r["status"] == 200 else []
    n = max(len(rows) - 1, 0)
    return r["status"] == 200 and 700 <= n <= 900, f"HTTP {r['status']}, {n} rows in catalogue.csv (read cap {r['bytes']}B)"

@check("org-numbers-rounded", "numbers are rounded for reading (no float noise)")
def _():
    r, b = page(ORG + "/catalogue"); bad = re.findall(r"\d+\.\d{5,}", b)
    r2, b2 = page(ORG + "/catalogue.csv"); bad2 = [x for x in re.findall(r"\d+\.\d{6,}", b2) if len(x.replace(".", "").lstrip("0")) > 6]
    return r["status"] == 200 and not bad and not bad2, f"page noise {bad[:3]}, csv noise {bad2[:3]}"

@check("org-direction-labels", "catalogue entries carry a direction label")
def _():
    r, b = page(ORG + "/catalogue")
    hit = [p for p in ("lower figure is better", "higher figure is better", "better direction unclear", "Getting worse", "Improving") if p in b]
    return r["status"] == 200 and len(hit) >= 2, f"labels found on page: {hit}"

@check("org-ask", "/ask returns a cited answer")
def _():
    r = get(ORG + "/api/ask?q=" + urllib.parse.quote("what works against malaria") + "&lang=en"); s, b = r["status"], r["body"]
    cited = bool(re.search(r"/(solutions|problems|catalogue)/", b))
    return s == 200 and cited, f"HTTP {s}; cited={cited}; {' '.join(b[:160].split())}"

@check("org-languages", "/es/ /fr/ /pt/ /ar/ are real translations with hreflang")
def _():
    base = get(ORG + "/")["body"]; out = []; ok = True
    for l in ("es", "fr", "pt", "ar"):
        r = get(f"{ORG}/{l}/"); b = r["body"]
        m = re.search(r"<html[^>]*lang=\"([^\"]+)\"", b); got = m.group(1) if m else "?"
        same = b == base
        out.append(f"{l}:{r['status']} lang={got} identical_to_en={same}")
        ok = ok and r["status"] == 200 and got.startswith(l) and not same
    hl = len(re.findall(r'hreflang="', base))
    try:
        m = json.loads(get("https://raw.githubusercontent.com/ultrastable/practical-solutions/main/ledger/i18n/manifest.json")["body"])
        cov = {k: (v.get("coverage"), v.get("live")) for k, v in m["langs"].items()}
    except Exception as e: cov = repr(e)
    return ok and hl >= 4, "; ".join(out) + f"; hreflang tags on / = {hl}; translated coverage (live needs 0.5) = {cov}"

@check("io-progress", "/progress, digests and Atom feed work and are fresh")
def _():
    ev = []; ok = True
    for p in ("/progress", "/digest/daily", "/digest/weekly", "/digest/monthly"):
        r = get(IO + p); ev.append(f"{p}:{r['status']}"); ok = ok and r["status"] == 200
    a = get(IO + "/progress.atom"); ok = ok and a["status"] == 200 and "<entry>" in a["body"]; ev.append(f"atom:{a['status']} entries={a['body'].count('<entry>')}")
    j = get(IO + "/progress.json")
    try: d = json.loads(j["body"]); st = [s.get("state") for s in d.get("systems", [])]; ok = ok and bool(st); ev.append("states=" + ",".join(map(str, st)))
    except Exception as e: ok = False; ev.append("json bad " + repr(e))
    return ok, "; ".join(ev)

@check("org-changes", "Practical Solutions /changes and What is new")
def _():
    r, b = page(ORG + "/changes"); return r["status"] == 200 and ("filter" in b.lower() or "<form" in b), f"HTTP {r['status']}, filter control present={'<form' in b}"

@check("org-new", "Practical Solutions 'What is new'")
def _():
    r, b = page(ORG + "/"); return r["status"] == 200 and "new" in b.lower(), f"HTTP {r['status']}, mentions 'new': {'new' in b.lower()}"

def first_id(kind):
    r = get(f"{ORG}/{kind}.json")
    try:
        d = json.loads(r["body"]); items = d if isinstance(d, list) else d.get(kind) or d.get("items") or list(d.values())[0]
        return items[0]["id"]
    except Exception: return None

@check("org-citations", "BibTeX, RIS, CSL-JSON export")
def _():
    sid = first_id("solutions")
    if not sid: return False, "could not read /solutions.json to find an id"
    ev = []; ok = True
    for ext, needle in ((".bib", "@"), (".ris", "TY  -"), (".csl.json", "\"title\"")):
        r = get(f"{ORG}/solutions/{sid}{ext}"); ev.append(f"{ext}:{r['status']}"); ok = ok and r["status"] == 200 and needle in r["body"]
    return ok, f"{sid} " + " ".join(ev)

@check("org-oembed", "oEmbed for a solution URL")
def _():
    sid = first_id("solutions")
    r = get(f"{ORG}/oembed?url=" + urllib.parse.quote(f"{ORG}/solutions/{sid}")); return r["status"] == 200 and "html" in r["body"], f"HTTP {r['status']} {r['body'][:120]}"

@check("org-embed-page", "embeddable widget")
def _():
    sid = first_id("solutions")
    r = get(f"{ORG}/embed/solutions/{sid}"); return r["status"] == 200, f"/embed/solutions/{sid} HTTP {r['status']}"

@check("org-csv", "CSV downloads")
def _():
    ev = []; ok = True
    for p in ("/solutions.csv", "/problems.csv", "/catalogue.csv"):
        r = get(ORG + p); ev.append(f"{p}:{r['status']}/{r['bytes']}B"); ok = ok and r["status"] == 200 and r["bytes"] > 200
    return ok, " ".join(ev)

@check("org-openapi", "OpenAPI paths all answer")
def _():
    r = get(ORG + "/openapi.json"); d = json.loads(r["body"]); bad = []
    for p in d["paths"]:
        if "{" in p or p == "/oembed": continue
        s = get(ORG + p)["status"]
        if s >= 400: bad.append(f"{p}:{s}")
    return not bad, f"{len(d['paths'])} paths declared; failing: {bad}"

for cid, path, needle in (("org-evidence-map", "/evidence-map", "evidence"), ("org-ranking", "/ranking", "WELLBY"), ("org-graph", "/graph.json", "nodes")):
    def mk(path=path, needle=needle):
        def f():
            r, b = page(ORG + path); return r["status"] == 200 and needle.lower() in b.lower(), f"{path} HTTP {r['status']} contains {needle!r}: {needle.lower() in b.lower()}"
        return f
    check(cid, f"{path} works")(mk())

@check("org-trend-chart", "trend charts render on catalogue entries")
def _():
    r, b = page(ORG + "/catalogue"); m = re.search(r'href="(/catalogue/[^"]+)"', b)
    if not m: return False, "no entry link on /catalogue"
    r2, b2 = page(ORG + m.group(1)); return r2["status"] == 200 and "<svg" in b2, f"{m.group(1)} HTTP {r2['status']} svg={'<svg' in b2}"

for cid, path in (("io-pilot", "/pilot"), ("io-customer-zero", "/customer-zero"), ("io-demo", "/demo"), ("io-privacy", "/privacy"), ("org-privacy", None)):
    def mk(path=path, cid=cid):
        def f():
            u = (ORG + "/privacy") if cid == "org-privacy" else IO + path
            r = get(u); return r["status"] == 200 and r["bytes"] > 1000, f"{u} HTTP {r['status']} {r['bytes']}B"
        return f
    check(cid, (path or "/privacy") + " page" + (" on ultrastable.org" if cid == "org-privacy" else ""))(mk())

@check("ai-labels", "AI-generated content is labelled")
def _():
    r, b = page(ORG + "/ask"); return r["status"] == 200 and re.search(r"AI|machine|automat", b) is not None, f"/ask mentions AI/automatic label: {bool(re.search(r'AI|machine|automat', b))}"

@check("io-freshness", "deploy lag: /api/freshness ok")
def _():
    r, b = page(IO + "/api/freshness"); return r["status"] == 200 and '"ok":true' in b.replace(" ", ""), f"HTTP {r['status']} {b[:200]}"

@check("io-claims-live", "/api/claims serves the registry")
def _():
    r, b = page(IO + "/api/claims"); n = b.count('"claim"'); return r["status"] == 200 and n > 100, f"HTTP {r['status']} {n} claims"

@check("bluesky-feed", "Bluesky posts about problems/solutions are on the public feed within 14 days")
def _():
    r = get("https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=ultrastable.bsky.social&limit=10")
    if r["status"] != 200: return False, f"HTTP {r['status']} {r['body'][:120]}"
    d = json.loads(r["body"]); n = len(d.get("feed", [])); last = d["feed"][0]["post"]["record"].get("createdAt") if n else None
    import datetime
    fresh = bool(last) and (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(last.replace("Z", "+00:00"))).days <= 14
    return fresh, f"{n} posts on the handle, latest {last}"

def repo_json(p):
    with open(os.path.join(REPO, p), encoding="utf-8") as f: return json.load(f)

@check("backup-drill", "backup drill record shows a successful restore")
def _():
    d = repo_json("ops/backup/last-restore.json"); return bool(d.get("restore_ok")) and bool(d.get("stored_ok")), f"at={d.get('at')} restore_ok={d.get('restore_ok')} errors={d.get('errors')}"

@check("runway", "runway is measured and meets the 365-day target")
def _():
    p = os.path.join(REPO, "ops/runway.json")
    if not os.path.exists(p): return False, "ops/runway.json does not exist: runway was never measured"
    d = repo_json("ops/runway.json"); return d.get("days", 0) >= 365, f"days={d.get('days')} unmeasured={d.get('unmeasured')}"

@check("credwatch", "credential watch has current readings")
def _():
    p = os.path.join(REPO, "ops/credwatch.json")
    if not os.path.exists(p): return False, "ops/credwatch.json does not exist: no credential reading recorded"
    d = repo_json("ops/credwatch.json"); return True, json.dumps(d)[:200]

@check("meta-ingest-validation", "/api/meta/ingest rejects bad input")
def _():
    req = urllib.request.Request(IO + "/api/meta/ingest", data=b'{"source":"mic-event","code":"bogus"}', headers={"content-type": "application/json", "user-agent": "ultrastable-smoke/1"})
    try: urllib.request.urlopen(req, timeout=20); s = 200
    except urllib.error.HTTPError as e: s = e.code
    return s == 422, f"unknown code -> HTTP {s} (want 422)"

if "--cap" in sys.argv:
    @check("meta-ingest-cap", "/api/meta/ingest caps one client at 20 writes per hour")
    def _():
        codes = []
        for i in range(24):
            req = urllib.request.Request(IO + "/api/meta/ingest", data=b'{"source":"mic-event","code":"busy","surface":"smoke"}', headers={"content-type": "application/json", "user-agent": "ultrastable-smoke/1"})
            try: urllib.request.urlopen(req, timeout=20); codes.append(200)
            except urllib.error.HTTPError as e: codes.append(e.code)
        return 429 in codes, f"statuses: {codes}"

fails = [r for r in R if r["result"] == "FAIL"]
width = max(len(r["id"]) for r in R)
for r in R: print(f"{r['result']:<8} {r['id']:<{width}}  {r['evidence']}")
print(f"\nSUMMARY pass={sum(r['result']=='PASS' for r in R)} fail={len(fails)} untested={sum(r['result']=='UNTESTED' for r in R)}")
out = os.environ.get("SMOKE_OUT")
if out: open(out, "w", encoding="utf-8").write(json.dumps(R, indent=1))
sys.exit(1 if fails else 0)
