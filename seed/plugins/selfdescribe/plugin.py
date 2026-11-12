"""Self-description loop: how the system sees and describes itself, generated from this repo and nothing else.
Sources: plugins/SCOPE.json, ultrastable.json, autonomy/policy.json, agents/roles/*.md, the plugin
manifests and config, and owner-approved statements from the communications brief. Output: self/SELF.md
and self/self.json. `check` fails when the committed files differ from what the repo now says (drift),
so the description cannot go stale. The `public` list is the only text marketing may post, verbatim."""
import json
from pathlib import Path
from ..api import SCOPE

HERE = Path(__file__).resolve().parent.parent
ROOT = HERE.parent  # the seed root


def _j(p, d=None):
    p = Path(p)
    return json.loads(p.read_text()) if p.exists() else d


def first_line(p):
    for line in Path(p).read_text().splitlines():
        if line.startswith("**Owns:**"): return line.replace("**Owns:**", "").strip()
    return ""


def build(root=ROOT, brief=None):
    root = Path(root)
    cfg = _j(root / "ultrastable.json", {})
    pol = _j(root / "autonomy/policy.json", {})
    roles = [{"id": r["id"], "count": r["count"], "owns": first_line(root / r["instructions"]) if (root / r["instructions"]).exists() else ""} for r in cfg.get("roles", [])]
    plugins = [{"name": n, "role": s["role"], "can": s["classes"]} for n, s in sorted(SCOPE["plugins"].items())]
    brief = brief or _j(root / "comms/brief.json", {})
    statements = [s for s in brief.get("statements", []) if s.get("approved")]
    public = [SCOPE["core_mission"]]
    public += [f"The gate is narrow: {pol['interrupt_gate']['rule']}"] if pol.get("interrupt_gate") else []
    public += [s["text"] for s in statements]
    return {
        "i_am": SCOPE["core_mission"],
        "i_do": [f"{r['id']}: {r['owns']}".strip(": ") for r in roles],
        "reach": {p["name"]: p["can"] for p in plugins},
        "i_do_not": SCOPE["out_of_bounds"],
        "trust_rungs": pol.get("ladder", {}).get("rungs", SCOPE["rungs"]),
        "plugin_roles": SCOPE["roles"],
        "public": public,
    }


def render_md(d):
    L = ["# How this system describes itself", "", "Generated from the repository by `python3 -m plugins self --write`. Do not edit by hand.", "",
         "## What I am", d["i_am"], "", "## Who does the work"] + [f"- {x}" for x in d["i_do"]]
    L += ["", "## What each optional plugin may reach (all dry-run until enabled)"] + [f"- {k}: {', '.join(v)}" for k, v in d["reach"].items()]
    L += ["", "## What I will not do"] + [f"- {x}" for x in d["i_do_not"]]
    L += ["", "## Trust ladder", " > ".join(d["trust_rungs"]), "", "## Approved public statements (the only text marketing may post)"] + [f"- {x}" for x in d["public"]]
    return "\n".join(L) + "\n"


def write(root=ROOT):
    out = Path(root) / "self"; out.mkdir(exist_ok=True)
    d = build(root)
    (out / "self.json").write_text(json.dumps(d, indent=1) + "\n"); (out / "SELF.md").write_text(render_md(d))
    return d


def check(root=ROOT):
    d = build(root); p = Path(root) / "self"
    if not (p / "self.json").exists(): return ["self/self.json missing: run python3 -m plugins self --write"]
    return [] if json.loads((p / "self.json").read_text()) == d and (p / "SELF.md").read_text() == render_md(d) else ["self-description drifted from the repo: run python3 -m plugins self --write"]


def approved_text(root=ROOT):
    return list(build(root)["public"])
