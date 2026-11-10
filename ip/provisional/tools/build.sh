#!/usr/bin/env bash
# Rebuild provisional-specification.pdf and drawings.pdf. Needs pandoc, python3, node and Playwright with Chromium.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 figures/figs.py figures
for f in figures/src/figs_*.py; do python3 "$f" || true; done
pandoc provisional-specification.md -s --css tools/style.css --embed-resources -o /tmp/spec.html
python3 - <<'PY'
import glob
parts=['<html><head><style>@page{size:letter;margin:0.6in}body{margin:0}div{display:flex;justify-content:center;break-inside:avoid;margin-bottom:0.25in}svg{max-width:7in;max-height:4.6in;height:auto}</style></head><body>']
for f in sorted(glob.glob('figures/*.svg')): parts.append('<div>'+open(f).read()+'</div>')
open('/tmp/drawings.html','w').write(''.join(parts)+'</body></html>')
PY
node tools/pdf.js /tmp/spec.html provisional-specification.pdf /tmp/drawings.html drawings.pdf
