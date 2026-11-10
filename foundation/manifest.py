"""Instance manifest: the single file that turns the foundation into one specific autonomous system.
Ultrastable is the foundation for any autonomous system; a business, research programme, open-source project or community differs only here.
"""
from __future__ import annotations
import copy, json, re
from pathlib import Path

KINDS = {"business", "research", "open-source", "community", "internal", "other"}
RUNTIMES = {"cloudflare", "gcp", "self-hosted"}
SECRET = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36,}|AKIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9_-]{20,}")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")

DEFAULTS = {
    "kind": "other",
    "owner": {"name": "Owner", "jurisdiction": "", "contact_binding": "OWNER_CONTACT"},
    "brand": {"public_name": "", "tagline": "", "separate_from": [], "voice": "plain, calm, claims labeled RUNNING, BUILT or PLANNED"},
    "idea": "",
    "goals": [],
    "positioning": "",
    "funding": {"routes": [], "individual_eligible_only": True},
    "social": {"channels": [], "mode": "dry-run"},
    "runtime": {"provider": "cloudflare"},
    "repos": {"org": "", "names": ["site", "docs", "platform", "business"], "canonical": ""},
    "disclosure": {"public_allowed": False, "gate": "none", "safe_now_only": True},
    "ip": {"has_invention": False, "priority_filed": False, "has_practitioner": False},
    "budget": {"usd_per_month": 0, "actions_minutes_monthly": 2000},
    "facts": {},
}


def deep_merge(base, over):
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        out[k] = deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else copy.deepcopy(v)
    return out


def resolve(raw: dict) -> dict:
    m = deep_merge(DEFAULTS, raw)
    m["brand"].setdefault("public_name", "")
    if not m["brand"]["public_name"]:
        m["brand"]["public_name"] = m.get("name", "")
    m["repos"]["canonical"] = m["repos"]["canonical"] or m["repos"]["org"] or m.get("slug", "")
    return m


def validate(raw: dict) -> list[str]:
    p, m = [], resolve(raw)
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,38}", str(raw.get("slug", ""))):
        p.append("slug must be 2-39 chars of a-z, 0-9, hyphen")
    if not raw.get("name"):
        p.append("name is required")
    if m["kind"] not in KINDS:
        p.append(f"kind must be one of {sorted(KINDS)}")
    if m["runtime"]["provider"] not in RUNTIMES:
        p.append(f"runtime.provider must be one of {sorted(RUNTIMES)}")
    if not m["goals"]:
        p.append("at least one goal (a first outcome) is required")
    j = m["owner"]["jurisdiction"]
    if j and not re.fullmatch(r"[A-Z]{2}", j):
        p.append("owner.jurisdiction must be an ISO 3166-1 alpha-2 code, or empty when unknown")
    text = json.dumps(raw)
    if SECRET.search(text):
        p.append("manifest contains a secret-shaped string; reference secrets by binding name only")
    if EMAIL.search(text):
        p.append("manifest contains an e-mail address; use owner.contact_binding (a secret-store name)")
    if not re.fullmatch(r"[A-Z][A-Z0-9_]+", m["owner"]["contact_binding"]):
        p.append("owner.contact_binding must be an UPPER_SNAKE binding name")
    if m["disclosure"]["gate"] not in ("none", "filed"):
        p.append("disclosure.gate must be 'none' or 'filed'")
    if m["disclosure"]["gate"] == "filed" and not m["ip"]["priority_filed"] and m["disclosure"]["public_allowed"]:
        p.append("disclosure.public_allowed cannot be true while the filing gate is closed")
    if m["budget"]["actions_minutes_monthly"] <= 0:
        p.append("budget.actions_minutes_monthly must be positive")
    return p


def load(path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def facts_for(m: dict) -> dict:
    """Facts for the bootstrap case library, derived from the manifest; explicit `facts` win."""
    j = m["owner"]["jurisdiction"]
    f = {"budget_usd_per_month": m["budget"]["usd_per_month"],
         "priority_filed": m["ip"]["priority_filed"] or not m["ip"]["has_invention"],
         "has_us_practitioner": m["ip"]["has_practitioner"],
         "public_disclosure_allowed": m["disclosure"]["public_allowed"],
         "has_institution": m["kind"] == "research" and bool(m["facts"].get("has_institution"))}
    if j:
        f["us_domiciled"] = j == "US"
    f.update(m["facts"])
    return f
