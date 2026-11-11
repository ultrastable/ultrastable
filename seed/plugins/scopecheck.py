"""Lint: the core-vs-plugin boundary, enforced. Exit 1 on any violation.
  1. Nothing on the core path (SCOPE.core.paths) imports, requires or names the plugin tier.
  2. Every plugin in SCOPE has a manifest, a role file, an entry, and manifest classes within SCOPE.
  3. Plugins read secrets only through Runtime.secret (no os.environ or getenv outside api.py and the CLI).
  4. No secret-like strings, and no names or ids of the system these patterns were learned from.
  5. The config template ships everything dry-run, nothing live, no value-looking credentials.
"""
import json, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SCOPE = json.loads((HERE / "SCOPE.json").read_text())
CORE_REF = re.compile(r"(^|[\s'\"(/.])plugins([\s'\"/.)]|$)|plugins\.config|SCOPE\.json")
SECRET = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}")
FORBIDDEN_NAMES = re.compile("q" + "nfo|q" + "08|q" + "wav", re.I)
TEXT = {".py", ".js", ".mjs", ".json", ".md", ".sql", ".yml", ".yaml", ".toml", ".jsonc"}


def files(base):
    base = Path(base)
    if base.is_file(): yield base; return
    for p in sorted(base.rglob("*")):
        if p.is_file() and p.suffix in TEXT and "__pycache__" not in p.parts and "node_modules" not in p.parts: yield p


def check(root=ROOT):
    root = Path(root); errs = []
    for rel in SCOPE["core"]["paths"]:
        for p in files(root / rel):
            for n, line in enumerate(p.read_text(errors="replace").splitlines(), 1):
                if CORE_REF.search(line): errs.append(f"core imports or names the plugin tier: {p.relative_to(root)}:{n}: {line.strip()[:80]}")
    pdir = root / "plugins"
    for name, spec in SCOPE["plugins"].items():
        m = pdir / name / "plugin.json"
        if not m.exists(): errs.append(f"plugin {name}: manifest missing"); continue
        man = json.loads(m.read_text())
        if not set(man["classes"]) <= set(spec["classes"]): errs.append(f"plugin {name}: manifest classes exceed SCOPE")
        if not (pdir / man["entry"]).exists(): errs.append(f"plugin {name}: entry {man['entry']} missing")
        if not (pdir / "roles" / f"{spec['role']}.md").exists(): errs.append(f"plugin {name}: role file roles/{spec['role']}.md missing")
        if man["default"] != {"enabled": False, "mode": "dry-run"}: errs.append(f"plugin {name}: must default to enabled=false, mode=dry-run")
        if not set(spec["classes"]) <= set(SCOPE["action_classes"]): errs.append(f"plugin {name}: unknown action class in SCOPE")
    for p in files(pdir):
        t = p.read_text(errors="replace"); rel = p.relative_to(root)
        if p.suffix == ".py" and p.name not in ("api.py", "__main__.py", "scopecheck.py") and "tests" not in p.parts and re.search(r"os\.environ|getenv", t):
            errs.append(f"{rel}: reads the environment directly; use Runtime.secret")
        if p.name != "scopecheck.py" and SECRET.search(t): errs.append(f"{rel}: secret-like string")
        if p.name != "scopecheck.py" and FORBIDDEN_NAMES.search(t): errs.append(f"{rel}: names the system these patterns were learned from")
    tpl = json.loads((pdir / "plugins.config.template.json").read_text())
    for n, c in tpl["plugins"].items():
        if c["mode"] != "dry-run": errs.append(f"template: {n} is not dry-run")
        if n not in ("selfdescribe", "communicate") and c["enabled"]: errs.append(f"template: {n} ships enabled")
        for k, v in c["adapter_config"].items():
            if k.endswith("_env") and not re.fullmatch(r"[A-Z][A-Z0-9_]*", v): errs.append(f"template: {n}.{k} must be an environment binding name")
    return errs


def main():
    errs = check()
    print("\n".join(errs) or "scope ok: core is free of plugins; plugins within reach")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
