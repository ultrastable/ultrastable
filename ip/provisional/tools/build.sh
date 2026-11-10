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
