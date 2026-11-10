#!/usr/bin/env python3
"""Pre-flight check for the provisional filing package. Exit 0 = ready to upload, 1 = blocking failure.

Checks: claim numbering and dependency, figure references and files, forbidden prior-disclosure wording,
leftover drafting placeholders, PDFs match the markdown source, no specification text or claim material in external/,
cover sheet data present. Run from anywhere: python3 ip/provisional/tools/preflight.py
"""
import json, re, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
ROOT = HERE.parent.parent
SPEC = HERE / "provisional-specification.md"
fails, warns, oks = [], [], []

def ok(m): oks.append(m)
def fail(m): fails.append(m)
def warn(m): warns.append(m)

text = SPEC.read_text(encoding="utf-8")

# 1. Claims
m = re.search(r"^# CLAIM-STYLE SUMMARIES\s*$(.*?)^# (?:CLAIM-TO-SECTION|ABSTRACT)", text, re.S | re.M)
if not m:
    fail("claims section not found")
    claims = []
else:
    claims = re.findall(r"^(\d+)\. (.*)$", m.group(1), re.M)
nums = [int(n) for n, _ in claims]
if nums == list(range(1, len(nums) + 1)) and nums:
    ok(f"claims numbered 1..{len(nums)} consecutively")
else:
    fail(f"claim numbering broken: {nums[:5]}... count {len(nums)}")
bad = []
for n, body in claims:
    for ref in re.findall(r"\bclaims? (\d+)", body):
        if int(ref) >= int(n):
            bad.append((n, ref))
if bad:
    fail(f"claims referring forward or to themselves: {bad[:5]}")
else:
    ok("every claim reference points to an earlier claim")
indep = [n for n, b in claims if not re.search(r"\bclaims? \d+", b)]
ok(f"{len(indep)} independent claims")
# claim-to-section table must list every claim
# The table lives in CLAIM-STRATEGY.md (moved out of the filed text to meet the page limit).
strategy = (HERE / "CLAIM-STRATEGY.md").read_text(encoding="utf-8") if (HERE / "CLAIM-STRATEGY.md").exists() else ""
t = re.search(r"^#+ (?:Appendix: claim-to-section cross-reference|CLAIM-TO-SECTION CROSS-REFERENCE)(.*?)(?:\Z|^#+ ABSTRACT)", strategy + "\n" + text, re.S | re.M)
if t:
    covered = set()
    for row in t.group(1).splitlines():
        cells = row.split("|")
        if len(cells) < 3 or not re.search(r"\d", cells[1]):
            continue
        first = re.sub(r"\([^)]*\)", "", cells[1])
        for a, b in re.findall(r"(\d+)\s*(?:to|-|–)\s*(\d+)", first):
            covered.update(range(int(a), int(b) + 1))
        covered.update(int(x) for x in re.findall(r"(?<![\d.])\d+(?![\d.])", first))
    missing = [i for i in nums if i not in covered]
    if missing:
        warn(f"claims not visibly mapped in the cross-reference table: {missing[:10]}")
    else:
        ok("claim-to-section table covers every claim")
else:
    warn("claim-to-section cross-reference table not found in CLAIM-STRATEGY.md")

# 2. Figures
brief = re.search(r"^# BRIEF DESCRIPTION OF THE DRAWINGS(.*?)^# DETAILED", text, re.S | re.M).group(1)
described = {int(x) for x in re.findall(r"FIG\. (\d+) (?:is|are|shows)", brief)}
files = {int(re.match(r"fig(\d+)-", p.name).group(1)) for p in (HERE / "figures").glob("fig*.svg")}
if described and described == files == set(range(1, max(files) + 1)):
    ok(f"FIGS. 1..{max(files)}: described and drawn, none missing")
else:
    fail(f"figure mismatch: described-only {sorted(described - files)}, drawn-only {sorted(files - described)}")
body = text.split("# DETAILED DESCRIPTION", 1)[1]
cited = set()
for a, b in re.findall(r"FIGS\. (\d+) (?:to|through|-) (\d+)", body):
    cited.update(range(int(a), int(b) + 1))
cited.update(int(x) for x in re.findall(r"FIG\. (\d+)", body))
cited.update(int(x) for x in re.findall(r"FIGS\. (\d+) and (\d+)", body) for x in x)
if cited - files:
    fail(f"text cites figures that do not exist: {sorted(cited - files)}")
else:
    ok("every figure cited in the text exists")
if files - cited:
    warn(f"figures never cited in the detailed description: {sorted(files - cited)}")
else:
    ok("every figure is cited in the detailed description")
# Every reference numeral drawn in a figure must be mentioned in the description (37 CFR 1.84(p)(5)).
in_range = set()
for a, b in re.findall(r"\b(\d{3,4}) (?:to|through) (\d{3,4})\b", body):
    in_range.update(str(x) for x in range(int(a), int(b) + 1))
unmentioned = []
for svg in sorted((HERE / "figures").glob("fig*.svg")):
    n = int(re.match(r"fig(\d+)-", svg.name).group(1))
    for num in sorted(set(re.findall(r">(%d\d\d)<" % n, svg.read_text(encoding="utf-8")))):
        if not re.search(r"\b%s\b" % num, body) and num not in in_range:
            unmentioned.append(num)
if unmentioned:
    fail(f"reference numerals drawn but never mentioned in the description: {unmentioned[:12]}")
else:
    ok("every reference numeral in the drawings is mentioned in the description")

# 3. Forbidden wording (specification, abstract, and every document in this folder and the confidentiality docs)
forbid = [
    r"already (been )?(publicly )?(disclosed|public)",
    r"(?<!not )(?<!never )has been publicly disclosed",
    r"(?<!not )(?<!never )is publicly disclosed",
    r"(?<!not )(?<!never )was publicly disclosed",
    r"prior(ly)? disclos(ed|ure) (has|have) (occurred|happened)",
    r"no licen[cs]e",
    r"(?<!un)licen[cs]e[- ]free",
    r"has been public since",
    r"public since 2026",
    r"holds individual components",
]
scan = [SPEC] + [p for p in HERE.glob("*.md")] + [ROOT / "docs/CONFIDENTIALITY.md", ROOT / "docs/PROJECT-MEMORY.md"]
hits = []
for p in scan:
    if not p.exists():
        continue
    for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        if re.search(r"never state|asks? the (patent )?attorney|not a finding|asserts no prior", line, re.I):
            continue
        for pat in forbid:
            if re.search(pat, line, re.I):
                hits.append(f"{p.relative_to(ROOT)}:{i}: {line.strip()[:110]}")
if hits:
    fail("forbidden prior-disclosure wording:\n    " + "\n    ".join(hits))
else:
    ok("no 'already disclosed' / 'no licence' wording")

# 4. Placeholders
ph = re.findall(r"\[(?:Inventor name|TBD|TODO|XXX|insert[^\]]*)\]|\bTODO\b|\bTBD\b|DRAFT FOR REVIEW", text)
if ph:
    fail(f"placeholders left in the specification: {sorted(set(ph))}")
else:
    ok("no placeholders or draft banner in the specification")
words = len(re.search(r"^# ABSTRACT\s*$(.*)", text, re.S | re.M).group(1).split())
if words <= 150:
    ok(f"abstract {words} words (limit 150)")
else:
    fail(f"abstract is {words} words, limit 150")

# 5. PDFs match the source
def pdf_text(p):
    return subprocess.run(["pdftotext", "-layout", str(p), "-"], capture_output=True, text=True).stdout
def pdf_pages(p):
    out = subprocess.run(["pdfinfo", str(p)], capture_output=True, text=True).stdout
    return int(re.search(r"Pages:\s+(\d+)", out).group(1))
sp = HERE / "provisional-specification.pdf"
dp = HERE / "drawings.pdf"
if not sp.exists() or not dp.exists():
    fail("spec or drawings PDF missing; run tools/build.sh")
else:
    t = re.sub(r"\s+", " ", pdf_text(sp))
    lastpara = re.findall(r"\[(\d{4}[a-z]?)\]", text)[-1]
    flat_title = "SYSTEMS AND METHODS FOR OPERATING AN ORGANIZATION"
    last_claim_start = re.sub(r"\s+", " ", claims[-1][1])[:60] if claims else ""
    bad = [x for x in (f"[{lastpara}]", flat_title, last_claim_start) if x not in t]
    if bad:
        fail(f"spec PDF is stale or incomplete (missing {bad}); run tools/build.sh")
    else:
        ok(f"spec PDF current: {pdf_pages(sp)} pages, last paragraph [{lastpara}] and claim {len(claims)} present")
    # Page limit (owner directive 2026-11-10): the USPTO size fee (37 CFR 1.16(s)) counts the
    # specification and the drawings together, so the combined sheet count must stay at or under 100.
    PAGE_LIMIT = 100
    total_pages = pdf_pages(sp) + pdf_pages(dp)
    if total_pages <= PAGE_LIMIT:
        ok(f"page limit: specification {pdf_pages(sp)} + drawings {pdf_pages(dp)} = {total_pages} sheets (limit {PAGE_LIMIT})")
    else:
        fail(f"page limit: specification {pdf_pages(sp)} + drawings {pdf_pages(dp)} = {total_pages} sheets, limit {PAGE_LIMIT}; condense the specification (see CUTS.md)")
    for banned in ("DRAFT FOR REVIEW", "[Inventor name]"):
        if banned in t:
            fail(f"spec PDF still contains '{banned}'")
    if pdf_pages(dp) >= max(files) / 2:
        ok(f"drawings PDF: {pdf_pages(dp)} pages for {len(files)} figures")
    else:
        fail("drawings PDF has too few pages for the figures; run tools/build.sh")
    for p in (sp, dp):
        if p.stat().st_size > 25 * 1024 * 1024:
            fail(f"{p.name} exceeds 25 MB (Patent Center limit is 25 MB per file)")
    ok("both PDFs under the 25 MB Patent Center limit") if all(p.stat().st_size < 25 * 1024 * 1024 for p in (sp, dp)) else None

# 6. Confidentiality of external/
ext = ROOT / "external"
leaks = []
words_spec = re.findall(r"\w+", text.lower())
shingles = {" ".join(words_spec[i:i + 10]) for i in range(0, len(words_spec) - 10, 3)}
markers = [r"provisional[- ]specification", r"CLAIM-STRATEGY", r"FILING-CHECKLIST", r"invention disclosure", r"\bThe method of claim\b",
           r"\[0\d{3}\]", r"ip/provisional", r"NDA ONLY", r"drawings\.pdf"]
if ext.exists():
    for p in ext.rglob("*"):
        if p.is_file():
            if re.search(r"provisional|claim-strategy|filing-checklist", p.name, re.I):
                leaks.append(f"{p.relative_to(ROOT)}: filename")
            if p.suffix.lower() in (".md", ".txt", ".html", ".json"):
                s = p.read_text(encoding="utf-8", errors="replace")
                for pat in markers:
                    if re.search(pat, s, re.I) and p.name != "README.md":
                        leaks.append(f"{p.relative_to(ROOT)}: matches /{pat}/")
                w = re.findall(r"\w+", s.lower())
                sh = {" ".join(w[i:i + 10]) for i in range(0, max(0, len(w) - 10))}
                if sh & shingles:
                    leaks.append(f"{p.relative_to(ROOT)}: shares a 10-word run with the specification")
    if leaks:
        fail("confidential material in external/:\n    " + "\n    ".join(sorted(set(leaks))))
    else:
        ok("external/ holds no specification text, claim text or patent file names")
else:
    warn("external/ not found")

# 7. Cover sheet data
ads = HERE / "filing" / "ads-data.json"
if not ads.exists():
    fail("filing/ads-data.json missing")
else:
    d = json.loads(ads.read_text())
    ok(f"cover sheet data present ({len(d.get('owner_fields_remaining', []))} fields only the inventor can enter)")
    if d["application"]["title"].upper() != re.search(r"# TITLE OF THE INVENTION\s+(.*)", text).group(1).strip().upper():
        fail("cover sheet title differs from the specification title")
    else:
        ok("cover sheet title matches the specification title")
    if d["application"]["claims_summary_count"] != len(claims) or d["application"]["figure_count"] != len(files):
        fail("cover sheet claim or figure count differs from the specification")
    else:
        ok("cover sheet counts match (claims, figures)")

# 8. Europe package (priority filing from the Netherlands)
EU = HERE.parent / "europe"
need = ["README.md", "DECISION-MEMO.md", "SELF-FILING-WALKTHROUGH.md", "FEE-TABLE.md", "FORM-VALUES.md", "OWNER-CARD.md"]
missing = [n for n in need if not (EU / n).exists()]
if missing:
    fail(f"ip/europe missing: {', '.join(missing)}")
else:
    ok("ip/europe package present")
    eu_text = " ".join((EU / n).read_text(encoding="utf-8") for n in need)
    if not re.search(r"not legal advice", eu_text, re.I):
        fail("ip/europe lacks the not-legal-advice marker")
    claim_run = {" ".join(w[i:i + 10]) for w in [re.findall(r"\w+", eu_text.lower())] for i in range(0, max(0, len(w) - 10))}
    spec_w = re.findall(r"\w+", text.lower())
    spec_sh = {" ".join(spec_w[i:i + 10]) for i in range(0, max(0, len(spec_w) - 10))}
    if claim_run & spec_sh:
        fail("ip/europe repeats a 10-word run from the specification")
    else:
        ok("ip/europe repeats no specification text")
    if re.search(r"already (been )?(publicly )?disclosed|QNFO[^.]{0,40}no licen[cs]e", eu_text, re.I):
        fail("ip/europe asserts prior disclosure or no licence")
    else:
        ok("ip/europe asserts nothing about prior disclosure")

for m in oks: print("PASS ", m)
for m in warns: print("WARN ", m)
for m in fails: print("FAIL ", m)
print(f"\n{len(oks)} passed, {len(warns)} warnings, {len(fails)} failures")
sys.exit(1 if fails else 0)
