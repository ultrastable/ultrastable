"""Guard and calendar helpers for automated social posting. Stdlib only."""
import hashlib, json, re, pathlib, datetime as dt

ROOT = pathlib.Path(__file__).resolve().parent.parent
S = ROOT / "social"


def load(name):
    return json.loads((S / name).read_text())


def norm(t):
    return re.sub(r"\s+", " ", t.replace("’", "'").replace("“", '"').replace("”", '"')).strip()


def post_id(text):
    return hashlib.sha256(norm(text).encode()).hexdigest()[:12]


def guard(text, source, channels=None, root=ROOT):
    """Return list of violations; empty list means the post may auto-publish."""
    g = load("guard.json")
    acc = load("accounts.json")["channels"]
    bad = []
    if source not in g["sources"]:
        bad.append(f"source not allowlisted: {source}")
    else:
        src = norm((root / source).read_text()).replace("**", "").replace("*", "")
        if norm(text).replace("**", "").replace("*", "") not in src:
            bad.append("text is not a verbatim excerpt of its source")
    low = text.lower()
    for p in g["blocked_patterns"]:
        if re.search(p, low):
            bad.append(f"blocked pattern: {p}")
    d = low
    for ok in g["digits_allowed"]:
        d = d.replace(ok, "")
    if re.search(r"\d", d):
        bad.append("contains digits")
    for p in g.get("standalone_exclude", []):
        if re.search(p, low):
            bad.append(f"not standalone-safe: {p}")
    if not any(k in low for k in g["required_any"]):
        bad.append("lacks a required on-topic term")
    for c in channels or acc:
        if len(text) > acc[c]["limit"]:
            bad.append(f"too long for {c}")
    return bad


def week_key(d):
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"
