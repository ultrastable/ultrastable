"""COST-GUARD-1: read D1 rows read and Workers AI neurons from Cloudflare analytics, compare with the budgets in doctrine/cost.json, record the result.

  python3 -m foundation cost --check    the declaration is well formed
  python3 -m foundation cost --probe    read the last full day (needs CLOUDFLARE_API_TOKEN), append to ops/cost.jsonl
  python3 -m foundation cost --guard    --probe, then print breaches; with --apply write one queue item per breach to docs/issues/
"""
from __future__ import annotations
import json, os, sys, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/cost.json"
QUERY = """query($a:String!,$s:Date!,$e:Date!){viewer{accounts(filter:{accountTag:$a}){
 d1AnalyticsAdaptiveGroups(limit:100,filter:{date_geq:$s,date_leq:$e}){dimensions{databaseId} sum{rowsRead readQueries}}
 aiInferenceAdaptiveGroups(limit:50,filter:{date_geq:$s,date_leq:$e}){dimensions{modelId} sum{totalNeurons}}}}}"""


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def check(cfg: dict | None = None) -> list[str]:
    c = cfg or load()
    errs = []
    for k in ("standing_goal", "budgets", "findings", "account_id", "closing_probe"):
        if k not in c:
            errs.append("missing " + k)
    for f in c.get("findings", []):
        if not f.get("remedy") or not f.get("status"):
            errs.append(f"finding {f.get('id')} lacks remedy or status")
    return errs


def evaluate(cfg: dict, d1: dict, ai: dict) -> list[dict]:
    """d1: {database_id: {rows_read, read_queries}}; ai: {model: neurons}. Returns breaches."""
    b, out = cfg["budgets"], []
    for db, v in d1.items():
        cap = b["d1_rows_read_per_day"]["per_database"].get(db, b["d1_rows_read_per_day"]["default"])
        if v["rows_read"] > cap:
            out.append({"metric": "d1_rows_read", "id": db, "value": v["rows_read"], "budget": cap})
        rpq = v["rows_read"] / v["read_queries"] if v["read_queries"] else 0
        if v["rows_read"] > cap and rpq > b["d1_rows_per_read_query_max"]:
            out.append({"metric": "d1_rows_per_read_query", "id": db, "value": round(rpq), "budget": b["d1_rows_per_read_query_max"]})
    total = sum(ai.values())
    if total > b["ai_neurons_per_day"]:
        out.append({"metric": "ai_neurons", "id": "total", "value": round(total), "budget": b["ai_neurons_per_day"]})
    for m, n in ai.items():
        if total and n / total > b["ai_neurons_per_model_share_max"] and total > b["ai_neurons_per_day"]:
            out.append({"metric": "ai_model_share", "id": m, "value": round(n / total, 2), "budget": b["ai_neurons_per_model_share_max"]})
    return out


def fetch(cfg: dict, token: str, day: str) -> tuple[dict, dict]:
    body = {"query": QUERY, "variables": {"a": cfg["account_id"], "s": day, "e": day}}
    req = urllib.request.Request("https://api.cloudflare.com/client/v4/graphql", data=json.dumps(body).encode(), method="POST",
                                 headers={"authorization": "Bearer " + token, "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    if data.get("errors"):
        raise RuntimeError("graphql: " + json.dumps(data["errors"]))
    acc = data["data"]["viewer"]["accounts"][0]
    d1 = {g["dimensions"]["databaseId"]: {"rows_read": g["sum"]["rowsRead"], "read_queries": g["sum"]["readQueries"]} for g in acc["d1AnalyticsAdaptiveGroups"]}
    ai = {g["dimensions"]["modelId"]: g["sum"]["totalNeurons"] for g in acc["aiInferenceAdaptiveGroups"]}
    return d1, ai


def guard(apply=False, root=REPO) -> list[dict]:
    cfg = load(root)
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token:
        raise RuntimeError("CLOUDFLARE_API_TOKEN is not bound; cost probe cannot read analytics")
    day = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    d1, ai = fetch(cfg, token, day)
    breaches = evaluate(cfg, d1, ai)
    rec = {"day": day, "d1_rows_read": {k: v["rows_read"] for k, v in d1.items()}, "ai_neurons": round(sum(ai.values())), "breaches": breaches}
    with (Path(root) / "ops" / "cost.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")
    if apply:
        for br in breaches:
            iid = "Q-COST-BREACH-%s-%s" % (br["metric"], str(br["id"])[:8])
            p = Path(root) / "docs" / "issues" / (iid + ".json")
            if not p.exists():
                p.write_text(json.dumps({"id": iid, "title": f"{iid}: {br['metric']} {br['value']} over budget {br['budget']}",
                    "body": f"**Owner:** executor\n**Trigger:** cost guard breach on {day}\n**Done check:** probe:python3 -m foundation cost --guard\n**Status:** open\n\nSee doctrine/cost.json findings.\n\nsize: M\n\n**Closing probe:** python3 -m foundation cost --guard",
                    "labels": ["p1", "agent-ready"], "milestone": "Now", "workstream": "cost"}, indent=2) + "\n", encoding="utf-8")
    return breaches


def main(argv=None) -> int:
    a = argv if argv is not None else sys.argv[1:]
    if "--check" in a:
        e = check()
        print("\n".join(e) or "cost declaration ok")
        return 1 if e else 0
    if "--probe" in a or "--guard" in a:
        br = guard(apply="--apply" in a)
        print(json.dumps(br, indent=2) if br else "no breaches")
        return 1 if br and "--guard" in a else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
