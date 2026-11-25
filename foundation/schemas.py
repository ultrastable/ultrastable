"""OPEN-STANDARDS-1: JSON Schema coverage for the platform's configs and manifests. The engine is the seed's
`scripts/schemas.py` (one fix reaches every system); this module points it at the platform root and also checks the seed's
own catalog, so the template stays valid. `python3 -m foundation schemas --check|--gen|--refresh FILE`."""
from __future__ import annotations
import importlib.util
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("seed_schemas", REPO / "seed/scripts/schemas.py")
engine = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(engine)


def check(root: Path = REPO) -> list[str]:
    root = Path(root)
    bad = engine.check(root)
    if (root / "seed" / engine.CONFIG).exists():
        bad += [f"seed/{b}" for b in engine.check(root / "seed")]
    return bad


def main(argv: list[str]) -> int:
    if argv and argv[0] == "--check":
        bad = check()
        n = len(engine.covered(REPO)) + len(engine.covered(REPO / "seed"))
        print("\n".join(bad) if bad else f"schemas ok: {n} files validate against their JSON Schema (platform and seed)")
        return 1 if bad else 0
    return engine.main(argv, default_root=str(REPO))
