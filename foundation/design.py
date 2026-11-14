"""DESIGN-LANGUAGE-1: one design language for every portfolio and product, enforced as code.

  python3 -m foundation design --check                 prove every theme (contrast both modes, token contract, allowed variation, hue range)
  python3 -m foundation design --lint [--write-baseline]   lint the product surfaces against the invariants (shrink-only baseline)
  python3 -m foundation design --css <product>         emit the --ds-* CSS for a product (light, dark by media query)
  python3 -m foundation design --tokens <product>      emit W3C design-tokens JSON ($value/$type)
  python3 -m foundation design --library | --select "<idea words>" [--tenant ID] [--taken a,b]   the curated personalities; the automatic pick for a deployment
  python3 -m foundation design --derive <hex> [--portfolio ultrastable] [--display F] [--density D]
                                                      a tenant's whole theme from ONE accent colour, auto-corrected until every pair passes
  python3 -m foundation design experiments --check     validate doctrine/design-experiments.json
  python3 -m foundation design experiments --assign <id> <visitor>   sticky arm for a visitor
  python3 -m foundation design experiments --evaluate <id> A_n A_conv B_n B_conv   verdict from counts

Layers (doctrine/design.json): core (never varies) > portfolio (family look) > product (accent hue, display face, density) > experiment (a bounded variant).
The portfolio fixes neutrals, status colours, type and spacing scales, shape and tap size. A product may vary only `product_may_vary`. A tenant system picks one
accent seed and inherits the rest, so nobody configures a design. Tokens are the same --ds-* contract the fleet's DESIGN-SYSTEM-1 uses, so components are shared.
"""
from __future__ import annotations
import colorsys, hashlib, json, math, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/design.json"
EXPERIMENTS = "doctrine/design-experiments.json"
MODES = ("light", "dark")
HEX = re.compile(r"#[0-9a-fA-F]{6}\b")


def load(root=REPO, rel=PATH) -> dict:
    p = Path(root) / rel
    return json.loads((p if p.is_file() else REPO / rel).read_text(encoding="utf-8"))


# ---- colour maths ----
def _rgb(h: str):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]


def _hex(rgb) -> str:
    return "#" + "".join(f"{max(0, min(255, round(c * 255))):02X}" for c in rgb)


def lum(h: str) -> float:
    c = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in _rgb(h)]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def contrast(a: str, b: str) -> float:
    x, y = lum(a), lum(b)
    return (max(x, y) + 0.05) / (min(x, y) + 0.05)


def hsl(h: str):
    r, g, b = _rgb(h)
    hh, l, s = colorsys.rgb_to_hls(r, g, b)
    return hh * 360, s, l


def from_hsl(h: float, s: float, l: float) -> str:
    return _hex(colorsys.hls_to_rgb((h % 360) / 360, max(0, min(1, l)), max(0, min(1, s))))


def hue_distance(a: str, b: str) -> float:
    d = abs(hsl(a)[0] - hsl(b)[0]) % 360
    return min(d, 360 - d)


# ---- themes ----
def derive_theme(accent_seed: str, portfolio: str = "ultrastable", display: str | None = None, density: str | None = None, cfg=None) -> dict:
    """Full light and dark tokens from one accent seed. Neutrals and status colours come from the portfolio; the accent is moved in lightness only until its pairs pass."""
    cfg = cfg or load()
    pf = cfg["portfolios"][portfolio]
    return derive_from(accent_seed, pf["neutrals"], pf["fonts"], pf["radius_px"], density or pf["density"], display or pf["fonts"]["display"], portfolio)


def derive_from(accent_seed: str, neutrals: dict, fonts: dict, radius_px: dict, density: str, display: str, label: str) -> dict:
    h, s, _ = hsl(accent_seed)
    out = {"portfolio": label, "accent_seed": accent_seed.upper(), "display": display, "density": density, "fonts": fonts, "radius_px": radius_px, "tokens": {}}
    for mode in MODES:
        t = dict(neutrals[mode])
        if mode == "light":
            on = "#FFFFFF"
            l = 0.62
            while l > 0.05:
                acc = from_hsl(h, s, l)
                if all(contrast(acc, t[k]) >= 4.5 for k in ("surface", "bg", "surface2")) and contrast(on, acc) >= 4.5:
                    break
                l -= 0.01
            hov = acc
            hl = l
            while hl > 0.03 and (contrast(hov, t["surface"]) < 4.5 or hov == acc or contrast(on, hov) < 4.5):
                hl -= 0.01
                hov = from_hsl(h, s, hl)
                if l - hl > 0.08:
                    break
            soft, softink = from_hsl(h, min(s, 0.9), 0.92), from_hsl(h, s * 0.8, 0.22)
        else:
            on = t["bg"]
            l = 0.45
            while l < 0.95:
                acc = from_hsl(h, s, l)
                if all(contrast(acc, t[k]) >= 4.5 for k in ("surface", "bg", "surface2")) and contrast(on, acc) >= 4.5:
                    break
                l += 0.01
            hl, hov = l, acc
            while hl < 0.97 and hov == acc:
                hl += 0.03
                hov = from_hsl(h, s, hl)
            soft, softink = from_hsl(h, s * 0.5, 0.18), from_hsl(h, s * 0.6, 0.86)
        t.update(accent=acc, accentHover=hov, onAccent=on, accentSoft=soft, accentSoftInk=softink, focus=acc)
        out["tokens"][mode] = t
    return out


def prove(theme: dict, cfg=None) -> list[str]:
    """Every contrast pair in both modes, and the token contract. Returns the failures."""
    cfg = cfg or load()
    bad = []
    for mode in MODES:
        t = theme["tokens"][mode]
        miss = [k for k in cfg["token_contract"] if k not in t]
        if miss:
            bad.append(f"{mode}: missing tokens {miss}")
            continue
        for fg, bg, need in cfg["contrast_pairs"]:
            r = contrast(t[fg], t[bg])
            if r + 1e-9 < need:
                bad.append(f"{mode}: {fg} on {bg} is {r:.2f}, needs {need}")
    return bad


def personality_theme(pid: str, cfg=None) -> dict:
    cfg = cfg or load()
    lib = cfg["library"]
    p = lib["personalities"][pid]
    neutrals = {m: {**lib["neutral_sets"][p["neutrals"]][m], **lib["status"][m]} for m in MODES}
    fonts = {"display": lib["stacks"][p["display"]], "body": lib["stacks"][p["body"]], "mono": lib["stacks"]["technical"]}
    return derive_from(p["seed"], neutrals, fonts, p["radius_px"], p["density"], fonts["display"], "personality:" + pid)


def select(text: str, tenant_id: str, taken=(), cfg=None) -> dict:
    """Pick a personality for a deployment from its own words. Deterministic, spreads deployments, never asks a person."""
    cfg = cfg or load()
    pers = cfg["library"]["personalities"]
    low = (text or "").lower()
    score = {k: sum(1 for w in v["keywords"] if w in low) for k, v in pers.items()}
    free = [k for k in pers if k not in set(taken)] or list(pers)
    best = max(score[k] for k in free)
    pool = sorted(k for k in free if score[k] == best)
    if best == 0 and len(pool) > 1 and "signal" in pool:
        pool.remove("signal")  # signal is the platform's own look; a deployment gets it only by naming that work
    pick = pool[int(hashlib.sha256(tenant_id.encode()).hexdigest(), 16) % len(pool)]
    return {"personality": pick, "score": best, "reason": "matched %d keyword(s)" % best if best else "no signal in the words; spread by tenant id", "taken_avoided": sorted(set(taken) & set(pers))}


def library_check(cfg) -> list[str]:
    lib, bad = cfg["library"], []
    P = lib["personalities"]
    if len(P) < 6:
        bad.append("library: fewer than six personalities is a menu of one")
    for pid, p in P.items():
        for k, v in (("neutrals", lib["neutral_sets"]), ("display", lib["stacks"]), ("body", lib["stacks"])):
            if p[k] not in v:
                bad.append(f"personality {pid}: unknown {k} {p[k]}")
        if p["density"] not in cfg["density"]:
            bad.append(f"personality {pid}: unknown density")
        r = p["radius_px"]
        if not (r["s"] <= r["m"] <= r["l"]):
            bad.append(f"personality {pid}: radius must not shrink from s to l")
        if not p["keywords"] or not p["mood"]:
            bad.append(f"personality {pid}: needs a mood and keywords so selection can find it")
        if not bad or not any(b.startswith(f"personality {pid}") for b in bad):
            for f in prove(personality_theme(pid, cfg), cfg):
                bad.append(f"personality {pid}: {f}")
    ids = sorted(P)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            pa, pb = P[a], P[b]
            if (pa["neutrals"], pa["display"]) == (pb["neutrals"], pb["display"]) and hue_distance(pa["seed"], pb["seed"]) < lib["distinct_min_hue_deg"]:
                bad.append(f"personalities {a} and {b} look alike (same neutrals, same display face, hues within {lib['distinct_min_hue_deg']} degrees)")
    return bad


def product_theme(pid: str, cfg=None) -> dict:
    cfg = cfg or load()
    p = cfg["products"][pid]
    return derive_theme(p["accent_seed"], p["portfolio"], p.get("display"), p.get("density"), cfg)


def css(theme: dict, cfg=None) -> str:
    cfg = cfg or load()
    names = {"surface2": "surface-2", "ink2": "ink-2", "lineStrong": "line-strong", "accentHover": "accent-hover", "onAccent": "on-accent",
             "accentSoft": "accent-soft", "accentSoftInk": "accent-soft-ink", "goodSoft": "good-soft", "warnSoft": "warn-soft", "badSoft": "bad-soft"}
    def block(t):
        return ";".join(f"--ds-{names.get(k, k)}:{t[k]}" for k in cfg["token_contract"] if k in t)
    sp = cfg["density"][theme["density"]]
    r = theme["radius_px"]
    shape = f"--ds-r-s:{r['s']}px;--ds-r-m:{r['m']}px;--ds-r-l:{r['l']}px;--ds-density:{sp};--ds-font-display:{theme['display']};--ds-font:{theme['fonts']['body']};--ds-mono:{theme['fonts']['mono']}"
    return (f"/* DESIGN-LANGUAGE-1 v{cfg['version']} {theme['portfolio']} accent {theme['accent_seed']} */\n"
            f":root{{color-scheme:light dark;{block(theme['tokens']['light'])};{shape}}}\n"
            f"@media (prefers-color-scheme:dark){{:root{{{block(theme['tokens']['dark'])}}}}}\n")


def tokens(theme: dict, cfg=None) -> dict:
    cfg = cfg or load()
    return {"$description": f"{theme['portfolio']} theme, accent seed {theme['accent_seed']}",
            **{m: {k: {"$value": theme["tokens"][m][k], "$type": "color"} for k in cfg["token_contract"] if k in theme["tokens"][m]} for m in MODES},
            "radius": {k: {"$value": f"{v}px", "$type": "dimension"} for k, v in theme["radius_px"].items()}}


# ---- the check ----
def check(root=REPO) -> list[str]:
    cfg, bad = load(root), []
    allowed = set(cfg["product_may_vary"])
    for pid, pf in cfg["portfolios"].items():
        if pf["display_allowed"] and pf["fonts"]["display"] not in pf["display_allowed"]:
            bad.append(f"portfolio {pid}: its own display face is not in display_allowed")
        for mode in MODES:
            miss = [k for k in ("bg", "surface", "surface2", "ink", "ink2", "line", "lineStrong", "good", "goodSoft", "warn", "warnSoft", "bad", "badSoft") if k not in pf["neutrals"][mode]]
            if miss:
                bad.append(f"portfolio {pid} {mode}: neutrals missing {miss}")
        for f in prove(derive_theme(pf["seed"], pid, cfg=cfg), cfg):
            bad.append(f"portfolio {pid}: {f}")
    for pid, p in cfg["products"].items():
        pf = cfg["portfolios"].get(p["portfolio"])
        if not pf:
            bad.append(f"product {pid}: unknown portfolio {p['portfolio']}")
            continue
        extra = set(p) - allowed - {"portfolio", "role", "surfaces"}
        if extra:
            bad.append(f"product {pid}: varies {sorted(extra)}, which the product layer may not (allowed: {sorted(allowed)})")
        if hue_distance(p["accent_seed"], pf["seed"]) > pf["hue_range_deg"]:
            bad.append(f"product {pid}: accent {p['accent_seed']} is {hue_distance(p['accent_seed'], pf['seed']):.0f} degrees from the portfolio hue, range is {pf['hue_range_deg']}")
        if p.get("display") and p["display"] not in pf["display_allowed"]:
            bad.append(f"product {pid}: display face is not one the portfolio allows")
        if p.get("density", pf["density"]) not in cfg["density"]:
            bad.append(f"product {pid}: unknown density")
        for f in prove(product_theme(pid, cfg), cfg):
            bad.append(f"product {pid}: {f}")
        for s in p.get("surfaces", []):
            if not (Path(root) / s).is_file():
                bad.append(f"product {pid}: surface {s} does not exist")
    bad += library_check(cfg)
    if cfg["tenants"]["default_portfolio"] not in cfg["portfolios"]:
        bad.append("tenants.default_portfolio is not a portfolio")
    for pr in cfg["research"]["practices"]:
        if pr["status"] not in ("built", "candidate", "retired"):
            bad.append(f"research {pr['id']}: bad status")
        if pr["status"] == "built" and not pr.get("adopted_as"):
            bad.append(f"research {pr['id']}: built with nothing adopted")
    bad += experiments_check(root)
    return bad


# ---- lint of real surfaces ----
def allowed_hex(cfg) -> set[str]:
    s = {"#FFFFFF", "#000000"}
    for pid, pf in cfg["portfolios"].items():
        for mode in MODES:
            s |= {v.upper() for v in pf["neutrals"][mode].values()}
        s.add(pf["seed"].upper())
    for pid in cfg["library"]["personalities"]:
        th = personality_theme(pid, cfg)
        s.add(th["accent_seed"])
        for mode in MODES:
            s |= {v.upper() for v in th["tokens"][mode].values()}
    for pid in cfg["products"]:
        th = product_theme(pid, cfg)
        s.add(th["accent_seed"])
        for mode in MODES:
            s |= {v.upper() for v in th["tokens"][mode].values()}
    return s


def lint_text(text: str, cfg=None) -> list[str]:
    cfg = cfg or load()
    f = []
    small = sorted({float(m) for m in re.findall(r"font-size:\s*(\d+(?:\.\d+)?)px", text) if float(m) < cfg["invariants"]["min_text_px"]})
    for px in small:
        f.append(f"text-under-{cfg['invariants']['min_text_px']}px:{px:g}px")
    if len(re.findall(r'class="[^"]*\bbtn-primary\b', text)) > cfg["invariants"]["primary_actions_per_screen"] * 2:
        f.append("many-primary-buttons")
    ok = allowed_hex(cfg)
    for hx in sorted({h.upper() for h in HEX.findall(text)} - ok):
        f.append(f"off-theme-colour:{hx}")
    return f


def lint(root=REPO, cfg=None) -> list[str]:
    cfg = cfg or load(root)
    out = []
    for rel in cfg["surfaces_lint"]["files"]:
        p = Path(root) / rel
        if p.is_file():
            out += [f"{rel}|{x}" for x in lint_text(p.read_text(encoding="utf-8"), cfg)]
    return out


def lint_gate(root=REPO) -> tuple[list[str], list[str]]:
    """(new findings that fail the build, baseline entries that no longer occur and must be deleted)."""
    cfg = load(root)
    bp = Path(root) / cfg["surfaces_lint"]["baseline"]
    base = set(json.loads(bp.read_text(encoding="utf-8")).get("findings", [])) if bp.is_file() else set()
    now = set(lint(root, cfg))
    return sorted(now - base), sorted(base - now)


# ---- experiments ----
def _prediction_ok(p: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9_]+ (>=|<=|>|<|=) -?\d+(\.\d+)? within \d+ h", p or ""))


def experiments_check(root=REPO) -> list[str]:
    cfg = load(root)
    p = Path(root) / EXPERIMENTS
    if not p.is_file():
        return [f"{EXPERIMENTS} is missing"]
    ex, bad = json.loads(p.read_text(encoding="utf-8")), []
    pol = ex["policy"]
    seen = set()
    for e in ex["experiments"]:
        i = e.get("id", "?")
        if i in seen:
            bad.append(f"experiment {i}: duplicate id")
        seen.add(i)
        if e.get("surface") not in cfg["products"]:
            bad.append(f"experiment {i}: surface is not a product")
        for k in ("hypothesis", "metric", "guard_metrics", "arms", "prediction", "status"):
            if not e.get(k):
                bad.append(f"experiment {i}: no {k}")
        if not _prediction_ok(e.get("prediction", "")):
            bad.append(f"experiment {i}: prediction must read '<metric> <op> <number> within <N> h'")
        arms = e.get("arms", [])
        if len(arms) < 2 or arms[0].get("id") != "control":
            bad.append(f"experiment {i}: needs a control arm first and at least one variant")
        for a in arms[1:]:
            ov = set(a.get("overrides", {}))
            if not ov <= set(pol["axes_allowed"]):
                bad.append(f"experiment {i}: arm {a.get('id')} varies {sorted(ov - set(pol['axes_allowed']))}, not an allowed axis")
            if "personality" in a.get("overrides", {}) and a["overrides"]["personality"] not in cfg["library"]["personalities"]:
                bad.append(f"experiment {i}: arm {a.get('id')} names a personality that is not in the library")
            if "accent_seed" in a.get("overrides", {}) and e.get("surface") in cfg["products"]:
                pr = cfg["products"][e["surface"]]
                th = derive_theme(a["overrides"]["accent_seed"], pr["portfolio"], pr.get("display"), pr.get("density"), cfg)
                for f in prove(th, cfg):
                    bad.append(f"experiment {i}: arm {a.get('id')}: {f}")
                if hue_distance(a["overrides"]["accent_seed"], cfg["portfolios"][pr["portfolio"]]["seed"]) > cfg["portfolios"][pr["portfolio"]]["hue_range_deg"]:
                    bad.append(f"experiment {i}: arm {a.get('id')} leaves the portfolio hue range")
        if e.get("status") not in pol["statuses"]:
            bad.append(f"experiment {i}: unknown status")
    running = {}
    for e in ex["experiments"]:
        if e.get("status") == "running":
            running[e["surface"]] = running.get(e["surface"], 0) + 1
    for s, n in running.items():
        if n > pol["max_concurrent_per_surface"]:
            bad.append(f"surface {s}: {n} running experiments, limit {pol['max_concurrent_per_surface']}")
    for idea in ex["ideas"]:
        for k in ("id", "idea", "blast_box", "promote_when"):
            if not idea.get(k):
                bad.append(f"idea {idea.get('id', '?')}: no {k}")
    return bad


def assign(exp_id: str, visitor: str, arms: list[str]) -> str:
    """Sticky, deterministic, equal-split arm for a visitor: nobody flips arms between visits and nothing is stored."""
    h = int(hashlib.sha256(f"{exp_id}|{visitor}".encode()).hexdigest(), 16)
    return arms[h % len(arms)]


def evaluate(n_a: int, c_a: int, n_b: int, c_b: int, pol=None, guards_ok: bool = True, days: int = 0) -> dict:
    """Two-proportion z test, decided only after the pre-registered sample (no peeking). The variant is kept only on a significant gain with every guard intact."""
    pol = pol or json.loads((REPO / EXPERIMENTS).read_text(encoding="utf-8"))["policy"]
    need = pol["min_sample_per_arm"]
    if min(n_a, n_b) < need:
        return {"verdict": "inconclusive" if days >= pol["max_days"] else "continue", "reason": f"sample {min(n_a, n_b)} of {need} per arm"}
    pa, pb = c_a / n_a, c_b / n_b
    p = (c_a + c_b) / (n_a + n_b)
    se = math.sqrt(p * (1 - p) * (1 / n_a + 1 / n_b)) or 1e-12
    z = (pb - pa) / se
    pv = math.erfc(abs(z) / math.sqrt(2))
    if pv < pol["alpha"] and pb > pa and guards_ok:
        v = "kept"
    elif pv < pol["alpha"] and pb < pa:
        v = "replaced"
    else:
        v = "replaced" if not guards_ok else "no-effect"
    return {"verdict": v, "z": round(z, 3), "p": round(pv, 4), "lift": round((pb - pa) / pa, 4) if pa else None}


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    cfg = load()
    if a[:1] == ["experiments"]:
        a = a[1:]
        if a[:1] == ["--check"]:
            bad = experiments_check()
            print("design experiments ok" if not bad else "\n".join(bad))
            return 1 if bad else 0
        if a[:1] == ["--assign"] and len(a) == 3:
            ex = json.loads((REPO / EXPERIMENTS).read_text(encoding="utf-8"))
            e = next(x for x in ex["experiments"] if x["id"] == a[1])
            print(assign(a[1], a[2], [x["id"] for x in e["arms"]]))
            return 0
        if a[:1] == ["--evaluate"] and len(a) == 6:
            print(json.dumps(evaluate(*map(int, a[2:6]))))
            return 0
        print(__doc__)
        return 2
    if a[:1] == ["--check"]:
        bad = check()
        print("design ok: %d portfolios, %d products, every pair proven in both modes" % (len(cfg["portfolios"]), len(cfg["products"])) if not bad else "\n".join(bad))
        return 1 if bad else 0
    if a[:1] == ["--lint"]:
        new, stale = lint_gate()
        if "--write-baseline" in a:
            bp = REPO / cfg["surfaces_lint"]["baseline"]
            bp.write_text(json.dumps({"_doc": "Shrink-only: known design debt, each with a Q-DESIGN item. A finding not listed here fails `design --lint`; a listed finding that no longer occurs must be deleted.", "findings": lint()}, indent=1) + "\n", encoding="utf-8")
            print("baseline written")
            return 0
        for n in new:
            print("NEW design finding:", n)
        for s in stale:
            print("STALE baseline entry (fixed, delete it):", s)
        if not new and not stale:
            print("design lint ok")
        return 1 if (new or stale) else 0
    if a[:1] == ["--library"]:
        for k, v in cfg["library"]["personalities"].items():
            print(f"{k:12} {v['mood']:34} seed {v['seed']}  {v['neutrals']}/{v['display']}/{v['density']}")
        return 0
    if a[:1] == ["--select"] and len(a) >= 2:
        kw = {a[i][2:]: a[i + 1] for i in range(2, len(a) - 1, 2)}
        r = select(a[1], kw.get("tenant", "tenant"), [x for x in kw.get("taken", "").split(",") if x], cfg)
        print(json.dumps(r))
        print(css(personality_theme(r["personality"], cfg), cfg))
        return 0
    if a[:1] == ["--css"] and len(a) == 2:
        print(css(product_theme(a[1], cfg), cfg))
        return 0
    if a[:1] == ["--tokens"] and len(a) == 2:
        print(json.dumps(tokens(product_theme(a[1], cfg), cfg), indent=1))
        return 0
    if a[:1] == ["--derive"] and len(a) >= 2:
        kw = {a[i][2:]: a[i + 1] for i in range(2, len(a) - 1, 2)}
        th = derive_theme(a[1], kw.get("portfolio", cfg["tenants"]["default_portfolio"]), kw.get("display"), kw.get("density"), cfg)
        bad = prove(th, cfg)
        print(css(th, cfg))
        for b in bad:
            print("FAIL", b, file=sys.stderr)
        return 1 if bad else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
