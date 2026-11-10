#!/usr/bin/env python3
"""Turn the provisional's labelled SVGs into text-free drawings: only reference numerals and 'FIG. n' remain.
OCNL: text labels in drawings are generally not allowed. Labels move to a LIST OF REFERENCE SIGNS in the description.
Writes drawings/*.svg and drawings/legend.json. Usage: transform_figures.py <figures_dir> <out_dir>"""
import re, sys, json, glob, html, os
SRC, OUT = Path = None, None
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
TXT = re.compile(r'<text ([^>]*)>(.*?)</text>')
legend = {}
for f in sorted(glob.glob(os.path.join(src, 'fig*.svg'))):
    name = os.path.basename(f)
    n = int(re.match(r'fig(\d+)', name).group(1))
    s = open(f, encoding='utf-8').read()
    items = [(m.start(), m.end(), m.group(1), html.unescape(m.group(2))) for m in TXT.finditer(s)]
    used = {t.strip() for *_, t in items if re.fullmatch(r'\d+[a-z]?', t.strip())}
    nxt = [n * 100 + 51]
    def new_ref():
        while str(nxt[0]) in used: nxt[0] += 1
        r = str(nxt[0]); used.add(r); nxt[0] += 1
        return r
    entries, pending, repl = [], [], {}
    def attr(a, k):
        m = re.search(k + r'="([^"]*)"', a); return m.group(1) if m else None
    for i, (st, en, a, t) in enumerate(items):
        ts = t.strip()
        if ts.startswith('FIG.'):
            repl[i] = f'<text {a} font-size="20">{html.escape(re.match(r"FIG\. \d+", ts).group(0))}</text>'
        elif re.fullmatch(r'\d+[a-z]?', ts):
            if pending:
                entries.append((ts, ' '.join(p[1] for p in pending)))
            pending = []
            a2 = re.sub(r'font-size="[^"]*"', 'font-size="15"', a)
            repl[i] = f'<text {a2}>{ts}</text>'
        elif 'italic' in a:  # edge label: give it its own numeral
            r = new_ref(); entries.append((r, ts))
            a2 = re.sub(r'font-size="[^"]*"', 'font-size="15"', a)
            a2 = a2.replace('font-style="italic"', 'font-weight="bold"')
            repl[i] = f'<text {a2}>{r}</text>'
        else:
            pending.append((i, ts)); repl[i] = ''
            nxt_is_label = i + 1 < len(items) and not (re.fullmatch(r'\d+[a-z]?', items[i+1][3].strip()) )
            # group of labels never followed by a numeral: give the group a numeral at its first line
            j = i + 1
            if j >= len(items) or (not re.fullmatch(r'\d+[a-z]?', items[j][3].strip()) and
                                   abs(float(attr(items[j][2], 'x') or 0) - float(attr(a, 'x') or 0)) > 1):
                # group ends here without a numeral
                if pending and not (j < len(items) and re.fullmatch(r'\d+[a-z]?', items[j][3].strip())):
                    first = pending[0][0]; fa = items[first][2]
                    r = new_ref(); entries.append((r, ' '.join(p[1] for p in pending)))
                    x = attr(fa, 'x'); y = attr(items[first][2], 'y')
                    mid = float(y) + 14 * (len(pending) - 1) / 2 - 4
                    repl[first] = f'<text x="{x}" y="{mid:.1f}" text-anchor="middle" font-size="15" font-weight="bold">{r}</text>'
                    pending = []
    res, pos = [], 0
    for i, (st, en, a, t) in enumerate(items):
        res.append(s[pos:st]); res.append(repl.get(i, s[st:en])); pos = en
    res.append(s[pos:])
    svg = ''.join(res)
    open(os.path.join(out, name), 'w', encoding='utf-8').write(svg)
    legend[n] = entries
json.dump({str(k): v for k, v in legend.items()}, open(os.path.join(out, 'legend.json'), 'w'), indent=1, ensure_ascii=False)
print(f'{len(legend)} figures, {sum(len(v) for v in legend.values())} reference signs')
