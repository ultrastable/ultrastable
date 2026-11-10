"""IP filing-route planner keyed on the owner's jurisdiction. Ultrastable is the foundation for any autonomous system, including its IP.

Generalises the US-provisional / Dutch-filing case: check the applicant's domicile first, never assume a self-filing route
from memory, and end in at most ONE identity-bound card (sign and pay). Output is a working plan for attorney review.
"""
from __future__ import annotations
import json
from pathlib import Path

DATA = Path(__file__).parent / "data" / "jurisdictions.json"


def plan(manifest: dict, table: dict | None = None, portal_ok: bool = True) -> dict:
    t = table or json.loads(DATA.read_text(encoding="utf-8"))
    ip, j = manifest["ip"], manifest["owner"]["jurisdiction"]
    base = {"jurisdiction": j or "unknown", "disclaimer": "Working plan for attorney review, not legal advice. Verify every rule at its source before use."}
    if not ip["has_invention"]:
        return {**base, "status": "not-needed", "routes": [], "card": None, "gate": "public copy unrestricted by filing"}
    if ip["priority_filed"]:
        return {**base, "status": "filed", "routes": ["record the receipt in ip/evidence-log.md", "diarise the 12-month priority deadline"], "card": None, "gate": "open"}
    routes, notes = [], []
    row = t["countries"].get(j)
    if not j:
        routes.append("Record the owner's domicile as a dated fact (identity-bound basics are asked once, with a default) before choosing a route")
        routes.append("Meanwhile prepare the jurisdiction-neutral filing set: specification, drawings, claims in English")
    elif j == "US":
        routes.append(f"{row['office']}: {row['self_file']}")
    else:
        notes.append(t["us_rule"]["text"])
        routes.append("US provisional only through a registered practitioner (rule above); keep it as an optional later step")
        if row and row.get("source"):
            routes.append(f"{row['office']}: {row['self_file']}")
            routes += [f"Fallback: {a}" for a in row.get("alt", [])]
        elif j in t["epc_states_self_file_epo"]:
            routes.append("EPO direct filing, self-represented, English: " + t["defaults"]["ep_direct_self_filing"] + " (verify)")
            routes.append(f"Research the national office of {j}: rules, fees, language, representation, from its own pages, in a dated memo")
        else:
            routes.append(f"Research route for {j}: read the national office's representation, fee and language rules from primary sources into a dated memo; no route is chosen from memory")
            routes.append("PCT through the receiving office is the generic fallback; confirm eligibility at the source")
    if not portal_ok:
        routes.insert(0, "Portal down: run the daily probe, read the office status page, prepare the paper or in-person set and the support e-mail with the exact error text")
    routes.append("Keep every public output SAFE NOW only until a filing receipt is recorded")
    return {**base, "status": "plan", "routes": routes, "notes": notes, "gate": "closed until receipt recorded",
            "card": {"id": "FILE-PRIORITY", "line": "IDENTITY-BOUND: sign and pay the priority application",
                     "why": "a signature and a payment in the owner's name", "default_in_effect": "nothing public beyond SAFE NOW; packet prepared and preflight green",
                     "closing_probe": "filing receipt recorded in ip/evidence-log.md and the gate opens"}}
