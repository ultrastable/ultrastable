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

# UPTIME-UA-1 (2026-11-21): Cloudflare answers the default `Python-urllib/x` agent with 403 (error 1010), so any foundation probe of a
# Cloudflare-fronted page measured its own user agent (every spinoff read uptime 0.0 while serving 200). One default opener for the package:
# a request that sets its own user-agent keeps it; every other request gets a named agent.
import urllib.request as _ur
_op = _ur.build_opener()
_op.addheaders = [("User-Agent", "ultrastable-foundation/1 (+https://ultrastable.io)")]
_ur.install_opener(_op)
