#!/usr/bin/env python3
"""Draws every brand image as SVG from brand/brand.json and the palette in BRAND.md. Stdlib only, deterministic.

Usage: python3 brand/tools/generate.py   (then `node brand/tools/render.js` for the PNGs)
Outputs under brand/generated/: banner.svg, org-banner.svg, loop.svg, architecture.svg, self-reference.svg, repo-map.svg,
cards/<repo>.svg (1280x640 social cards). The logo files in brand/logo/ stay the hand-set mark; this script reuses its geometry.
"""
import json, pathlib, html

ROOT = pathlib.Path(__file__).resolve().parents[2]
import os
OUT = pathlib.Path(os.environ["ULTRASTABLE_BRAND_OUT"]) if os.environ.get("ULTRASTABLE_BRAND_OUT") else ROOT / "brand" / "generated"
C = dict(signal="#FF5B1F", sun="#FFC857", moss="#12342A", night="#0B1A15", cream="#F6F1E7", mist="#C9D4CC", line="#2C5A4A")
SERIF = "Fraunces,Georgia,'Times New Roman',serif"
SANS = "'IBM Plex Sans',system-ui,Arial,sans-serif"
MARK = '<path d="M30 12 L54 56 H6 Z" fill="#FF5B1F" stroke="#FF5B1F" stroke-width="4" stroke-linejoin="round"/><circle cx="50" cy="14" r="6" fill="#FFC857"/>'
e = html.escape


def svg(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{e(title)}">'
            f'<title>{e(title)}</title><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{C["moss"]}"/>'
            f'<stop offset="1" stop-color="{C["night"]}"/></linearGradient><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
            f'<path d="M0 0 L10 5 L0 10 z" fill="{C["sun"]}"/></marker></defs><rect width="{w}" height="{h}" fill="url(#g)"/>{body}</svg>\n')


def t(x, y, s, size, fill, font=SANS, weight=400, anchor="start", ls=0):
    return f'<text x="{x}" y="{y}" font-family="{font}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" letter-spacing="{ls}">{e(s)}</text>'


def mark(x, y, s):
    return f'<g transform="translate({x} {y}) scale({s})">{MARK}</g>'


def box(x, y, w, h, label, sub="", hot=False):
    f = C["signal"] if hot else C["moss"]
    tc = C["night"] if hot else C["cream"]
    sc = C["night"] if hot else C["mist"]
    s = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{f}" stroke="{C["signal"] if not hot else C["sun"]}" stroke-width="2"/>'
    s += t(x + w / 2, y + (h / 2 - 2 if sub else h / 2 + 7), label, 22, tc, SERIF, 700, "middle")
    if sub:
        s += t(x + w / 2, y + h / 2 + 22, sub, 14, sc, SANS, 400, "middle")
    return s


def arrow(x1, y1, x2, y2):
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{C["sun"]}" stroke-width="2.5" marker-end="url(#a)"/>'


def banner(cfg, tagline, org=False):
    sub = "Runs on itself. Source-available. Free for non-commercial use." if not org else "Seven repositories. One system. Everything in code."
    b = mark(72, 76, 2.0) + t(216, 150, "ultrastable", 76, C["cream"], SERIF, 700, ls=-2)
    b += t(218, 204, tagline, 30, C["mist"], SERIF) + t(218, 250, sub, 20, C["sun"])
    return svg(1280, 320, b, "ultrastable: " + tagline)


def card(r, tagline):
    b = mark(72, 64, 1.6) + t(190, 130, "ultrastable", 44, C["cream"], SERIF, 700, ls=-1)
    b += t(72, 300, "ultrastable/" + r["name"], 84, C["cream"], SERIF, 700, ls=-2)
    b += f'<rect x="72" y="326" width="120" height="6" fill="{C["signal"]}"/>'
    words, lines, cur = r["line"].split(), [], ""
    for w in words:
        if len(cur) + len(w) > 52:
            lines.append(cur); cur = w
        else:
            cur = (cur + " " + w).strip()
    lines.append(cur)
    for i, l in enumerate(lines[:3]):
        b += t(72, 392 + i * 40, l, 30, C["mist"], SERIF)
    b += t(72, 580, tagline, 24, C["sun"]) + t(1208, 580, "ultrastable.io", 24, C["cream"], SANS, 400, "end")
    return svg(1280, 640, b, f"ultrastable/{r['name']}: {r['line']}")


def loop():
    steps = [("Predict", "log a checkable bet"), ("Execute", "agent does the work"), ("Verify", "independent check"), ("Score", "prediction vs outcome"), ("Plus", "protected improvement")]
    b = t(600, 56, "The loop every manager runs", 34, C["cream"], SERIF, 700, "middle")
    x0, w, gap = 40, 190, 38
    for i, (a, s) in enumerate(steps):
        x = x0 + i * (w + gap)
        b += box(x, 120, w, 90, a, s, hot=(a == "Plus"))
        if i < len(steps) - 1:
            b += arrow(x + w + 4, 165, x + w + gap - 4, 165)
    b += f'<path d="M1105 215 C1105 330 95 330 135 215" fill="none" stroke="{C["sun"]}" stroke-width="2.5" stroke-dasharray="7 6" marker-end="url(#a)"/>'
    b += t(600, 318, "Trust ledger: verified results widen autonomy, misses narrow it", 20, C["mist"], SANS, 400, "middle")
    b += box(330, 350, 540, 56, "Interrupt gate", "only irreversible and identity-bound steps stop for a person")
    return svg(1200, 430, b, "Predict, execute, verify, score, plus; trust ledger; interrupt gate")


def architecture():
    b = t(600, 52, "One idea to an organization that improves itself", 32, C["cream"], SERIF, 700, "middle")
    b += box(40, 110, 220, 90, "Idea", "IDEA.md, one file")
    b += box(320, 110, 220, 90, "Seed", "bootstrap", hot=True)
    b += box(600, 110, 250, 90, "Virtual managers", "portfolio, project, product")
    b += box(910, 110, 250, 90, "Virtual staff", "build, review, operate")
    b += arrow(264, 155, 316, 155) + arrow(544, 155, 596, 155) + arrow(854, 155, 906, 155)
    b += box(320, 270, 840, 80, "Platform core", "tick, trust ledger, scorer, plussing queue, gate")
    b += arrow(725, 204, 725, 266)
    b += box(320, 400, 400, 70, "Cloudflare adapter", "works today")
    b += box(760, 400, 400, 70, "Google Cloud adapter", "skeleton built")
    b += arrow(520, 354, 520, 396) + arrow(960, 354, 960, 396)
    return svg(1200, 500, b, "Architecture: idea, seed, managers, staff, platform core, cloud adapters")


def selfref():
    import math
    b = t(600, 52, "Ultrastable runs on itself", 34, C["cream"], SERIF, 700, "middle")
    b += mark(535, 190, 1.9)
    items = ["roadmap", "issues", "managers", "trust ledger", "plussing budget", "specs", "release", "reporting"]
    for i, it in enumerate(items):
        a = -math.pi / 2 + i * 2 * math.pi / len(items)
        x, y = 600 + 430 * math.cos(a), 250 + 140 * math.sin(a)
        b += box(int(x - 85), int(y - 24), 170, 48, it)
    b += t(600, 450, "The code it gives everyone else also runs it", 22, C["mist"], SANS, 400, "middle")
    b += t(600, 490, "python3 -m foundation selfhost --verify", 20, C["sun"], "ui-monospace,Menlo,monospace", 400, "middle")
    return svg(1200, 520, b, "Ultrastable runs on itself: roadmap, issues, managers, trust ledger, plussing, specs, release, reporting")


def repo_map(cfg):
    b = t(600, 52, "Seven repositories, one system", 34, C["cream"], SERIF, 700, "middle")
    rs = cfg["repos"]
    b += box(450, 90, 300, 80, "ultrastable", rs[0]["role"], hot=True)
    for i, r in enumerate(rs[1:]):
        x = 30 + i * 190
        b += box(x, 290, 175, 80, r["name"], r["role"]) + arrow(600, 174, x + 87, 286)
    b += t(600, 430, "Every README links to every other repo", 20, C["mist"], SANS, 400, "middle")
    return svg(1200, 460, b, "Repository map")


def main():
    cfg = json.loads((ROOT / "brand/brand.json").read_text())
    tag = json.loads((ROOT / "doctrine/positioning.json").read_text())["tagline"]
    (OUT / "cards").mkdir(parents=True, exist_ok=True)
    files = {"banner.svg": banner(cfg, tag), "org-banner.svg": banner(cfg, tag, True), "loop.svg": loop(), "architecture.svg": architecture(),
             "self-reference.svg": selfref(), "repo-map.svg": repo_map(cfg)}
    for r in cfg["repos"]:
        files[f"cards/{r['name']}.svg"] = card(r, tag)
    for n, s in files.items():
        (OUT / n).write_text(s, encoding="utf-8")
    print(f"wrote {len(files)} svgs to {OUT}")


if __name__ == "__main__":
    main()
