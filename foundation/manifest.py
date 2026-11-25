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
    "owner": {"name": "Owner", "jurisdiction": "", "contact_binding": "OWNER_CONTACT", "contact_binding_backup": "OWNER_CONTACT_BACKUP"},
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
    if not m.get("slug") and m.get("name"):  # zero-fuss: the owner gives a name, never a slug
        m["slug"] = re.sub(r"[^a-z0-9]+", "-", str(m["name"]).lower()).strip("-")[:39]
    m["brand"].setdefault("public_name", "")
    if not m["brand"]["public_name"]:
        m["brand"]["public_name"] = m.get("name", "")
    m["repos"]["canonical"] = m["repos"]["canonical"] or m["repos"]["org"] or m.get("slug", "")
    return m


SCHEMA = Path(__file__).resolve().parents[1] / "seed/schemas/instance.schema.json"


def _schema_errors(m: dict) -> list[str]:
    """OPEN-STANDARDS-1: the structure of a manifest is a JSON Schema 2020-12 (seed/schemas/instance.schema.json), validated by
    the shared engine seed/scripts/stdkit.py; only rules that span fields or scan text stay in code below."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("seed_stdkit", SCHEMA.parents[1] / "scripts/stdkit.py")
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod.validate(json.loads(SCHEMA.read_text(encoding="utf-8")), m)


def validate(raw: dict) -> list[str]:
    p, m = [], resolve(raw)
    if not raw.get("name"):
        p.append("name is required")
    p += [e for e in _schema_errors(m) if not e.startswith("$: missing name") and "'name' is a required" not in e]
    text = json.dumps(raw)
    if SECRET.search(text):
        p.append("manifest contains a secret-shaped string; reference secrets by binding name only")
    if EMAIL.search(text):
        p.append("manifest contains an e-mail address; use owner.contact_binding (a secret-store name)")
    bb = m["owner"].get("contact_binding_backup", "")
    if bb and bb == m["owner"]["contact_binding"]:
        p.append("owner.contact_binding_backup must be a second UPPER_SNAKE binding name, different from contact_binding (MAIL-PATHS-1: one sign-in address is a single point of failure; use an address at a different provider)")
    if m["disclosure"]["gate"] == "filed" and not m["ip"]["priority_filed"] and m["disclosure"]["public_allowed"]:
        p.append("disclosure.public_allowed cannot be true while the filing gate is closed")
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
