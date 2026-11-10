#!/usr/bin/env python3
"""Build the Dutch-application document set in ip/europe/filing-nl/ from ip/provisional (the technical text is unchanged).
Needs pandoc, node + Playwright, pypdf, reportlab. Run: python3 ip/europe/tools/build_nl.py"""
import json, re, subprocess, sys, io
from pathlib import Path
HERE = Path(__file__).resolve().parent.parent          # ip/europe
PROV = HERE.parent / "provisional"
OUT = HERE / "filing-nl"; OUT.mkdir(exist_ok=True)
TMP = Path("/tmp/nlbuild"); TMP.mkdir(exist_ok=True)

def run(*a): subprocess.run(a, check=True)

# 1. drawings without text labels
run(sys.executable, str(HERE / "tools/transform_figures.py"), str(PROV / "figures"), str(HERE / "drawings"))
legend = json.load(open(HERE / "drawings/legend.json"))

# 2. description markdown
s = (PROV / "provisional-specification.md").read_text(encoding="utf-8")
s = re.sub(r"\A---.*?---\s*", "", s, flags=re.S)
s = re.sub(r"^Docket number.*\n", "", s, flags=re.M)
s = s.replace("# CLAIM-STYLE SUMMARIES", "# NUMBERED STATEMENTS OF ASPECTS")
s = s.replace("Claims are not required in a provisional application. The following numbered statements describe aspects for which protection may be sought in a later application;",
              "The claims of this application follow the description. The following numbered statements describe aspects for which protection may be sought;")
s = re.sub(r"^# ABSTRACT.*\Z", "", s, flags=re.S | re.M).rstrip() + "\n"
refs = ["# LIST OF REFERENCE SIGNS", ""]
for n in sorted(legend, key=int):
    refs.append(f"**FIG. {n}**"); refs.append("")
    for r, t in legend[n]:
        refs.append(f"{r}: {t}  "); 
    refs.append("")
s += "\n" + "\n".join(refs)
(OUT / "beschrijving.md").write_text(s, encoding="utf-8")
claims = (HERE / "conclusies-nl.md").read_text(encoding="utf-8")

CSS = """<style>body{font-family:'Times New Roman',Times,serif;font-size:11pt;line-height:1.35}
h1{font-size:13pt;text-transform:uppercase;margin-top:1.2em}h2{font-size:12pt}p{margin:0.5em 0;text-align:left}
.pb{break-before:page}*{max-width:100%;overflow-wrap:anywhere;box-sizing:border-box}pre,code{white-space:pre-wrap}table{table-layout:fixed;width:100%;border-collapse:collapse}td,th{border:1px solid #444;padding:2px;vertical-align:top;font-size:9pt}</style>"""
def md_html(md): return subprocess.run(["pandoc", "-f", "markdown-yaml_metadata_block", "-t", "html"], input=md, capture_output=True, text=True, check=True).stdout
html = CSS + "<h1 style='text-align:center'>SYSTEMS AND METHODS FOR OPERATING AN ORGANIZATION THROUGH A HIERARCHY OF VIRTUAL MANAGER AGENTS WITH CLOSED FEEDBACK LOOPS, SCORED PREDICTIONS, EARNED AUTONOMY, AND EVIDENCE-DRIVEN ADDITIVE IMPROVEMENT</h1>" \
       + md_html(s.replace("# TITLE OF THE INVENTION\n", "# TITLE OF THE INVENTION\n", 1)) + "<div class='pb'></div>" + md_html(claims)
(TMP / "desc.html").write_text("<!doctype html><html><meta charset='utf-8'><body>" + html + "</body></html>", encoding="utf-8")
run("node", str(HERE / "tools/pdf_nl.js"), str(TMP / "desc.html"), str(TMP / "desc.pdf"))

# abstract
ab = (HERE / "samenvatting.md").read_text(encoding="utf-8")
(TMP / "abs.html").write_text("<html><meta charset='utf-8'><body>" + CSS + md_html(ab) + "</body></html>", encoding="utf-8")
run("node", str(HERE / "tools/pdf_nl.js"), str(TMP / "abs.html"), str(TMP / "abs.pdf"))

# drawings: one figure per page, landscape for wide ones
import glob
parts = ["<html><meta charset='utf-8'><style>@page{size:A4;margin:2cm 2cm 2cm 2.5cm}@page land{size:A4 landscape;margin:2cm 2cm 2cm 2.5cm}"
         "div{break-after:page;display:flex;justify-content:center;align-items:flex-start}div.l{page:land}svg{display:block}</style><body>"]
for f in sorted(glob.glob(str(HERE / "drawings/fig*.svg"))):
    svg = open(f, encoding="utf-8").read()
    w, h = map(float, re.search(r'width="(\d+)" height="(\d+)"', svg).groups())
    land = w > h * 1.15
    aw, ah = (24.0, 16.0) if land else (16.0, 24.0)   # usable area in cm, with room for the sheet number
    k = min(aw / w, ah / h)
    svg = re.sub(r'width="\d+" height="\d+"', f'width="{w*k:.2f}cm" height="{h*k:.2f}cm"', svg, count=1)
    parts.append(f"<div class='{'l' if land else 'p'}'>{svg}</div>")
(TMP / "dr.html").write_text("".join(parts) + "</body></html>", encoding="utf-8")
run("node", str(HERE / "tools/pdf_nl.js"), str(TMP / "dr.html"), str(TMP / "dr.pdf"), "css")

# 3. stamp page numbers (description + claims continuous from 1; drawings sheet n/N)
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
def stamp(src, dst, label):
    r = PdfReader(str(src)); w = PdfWriter(); n = len(r.pages)
    for i, pg in enumerate(r.pages):
        W, H = float(pg.mediabox.width), float(pg.mediabox.height)
        buf = io.BytesIO(); c = canvas.Canvas(buf, pagesize=(W, H)); c.setFont("Times-Roman", 10)
        c.drawCentredString(W / 2, 2.2 * 28.35, label(i + 1, n)); c.save(); buf.seek(0)
        pg.merge_page(PdfReader(buf).pages[0]); w.add_page(pg)
    w.write(str(dst)); return n
nd = stamp(TMP / "desc.pdf", OUT / "beschrijving-en-conclusies.pdf", lambda i, n: str(i))
na = stamp(TMP / "abs.pdf", OUT / "samenvatting.pdf", lambda i, n: "")
nr = stamp(TMP / "dr.pdf", OUT / "tekeningen.pdf", lambda i, n: f"{i}/{n}")
# split description and claims (page numbers stay continuous) for portals that want them as separate attachments
rd = PdfReader(str(OUT / "beschrijving-en-conclusies.pdf"))
k = next(i for i, pg in enumerate(rd.pages) if (pg.extract_text() or "").lstrip().startswith("CONCLUSIES"))
for name, rng in (("beschrijving.pdf", range(0, k)), ("conclusies.pdf", range(k, len(rd.pages)))):
    w = PdfWriter()
    for i in rng: w.add_page(rd.pages[i])
    w.write(str(OUT / name))
(OUT / "PAGE-COUNTS.txt").write_text(f"description pages 1-{k}\nclaims pages {k+1}-{len(rd.pages)}\nabstract 1\ndrawings {nr}\n")
import hashlib
(OUT / "SOURCE.sha256").write_text(hashlib.sha256((PROV / "provisional-specification.md").read_bytes()).hexdigest() + "  provisional-specification.md\n")
print(f"description+claims {nd} pages, abstract {na}, drawings {nr}")
