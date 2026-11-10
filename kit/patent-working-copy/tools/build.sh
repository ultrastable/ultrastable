#!/usr/bin/env bash
# Rebuild provisional-specification.pdf and drawings.pdf. Needs pandoc, python3, node and Playwright with Chromium.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 figures/figs.py figures
pandoc provisional-specification.md -s --css tools/style.css --embed-resources -o /tmp/spec.html
python3 - <<'PY'
import glob
parts=['<html><head><style>@page{size:letter;margin:0.6in}body{margin:0}div{page-break-after:always;display:flex;justify-content:center}svg{max-width:7.2in;max-height:9.5in;height:auto}</style></head><body>']
for f in sorted(glob.glob('figures/*.svg')): parts.append('<div>'+open(f).read()+'</div>')
open('/tmp/drawings.html','w').write(''.join(parts)+'</body></html>')
PY
node tools/pdf.js /tmp/spec.html provisional-specification.pdf /tmp/drawings.html drawings.pdf
# Page limit (owner directive 2026-11-10; USPTO application size fee, 37 CFR 1.16(s)): specification plus drawings <= 100 sheets.
spec_pages=$(pdfinfo provisional-specification.pdf | awk '/^Pages:/{print $2}')
draw_pages=$(pdfinfo drawings.pdf | awk '/^Pages:/{print $2}')
total=$((spec_pages + draw_pages))
echo "pages: specification $spec_pages + drawings $draw_pages = $total sheets (limit 100)"
if [ "$total" -gt 100 ]; then echo "FAIL: over the 100-sheet limit; condense the specification (see CUTS.md)" >&2; exit 1; fi
