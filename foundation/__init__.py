"""Ultrastable is the foundation for any autonomous system.

Layers (docs/FOUNDATION.md):
  0 kernel      seed/: doctrine, roles, policy, case library, tick worker. Same for every system.
  1 foundation  this package: manifest, new-system generator, credential ladder, preflight, filing planner, minute guard, owner-step routes.
  2 instance    instances/<slug>/instance.json: the only file that differs between systems.
Stdlib only. Never reads, prints or writes a secret value; it checks only whether a binding is set.
"""
__version__ = "0.1.0"
import json as _json
from pathlib import Path as _P
TAGLINE = _json.loads((_P(__file__).resolve().parent.parent / "doctrine" / "positioning.json").read_text(encoding="utf-8"))["tagline"]  # source of truth: doctrine/positioning.json
