"""Tenant settings for the Cloudflare reference scripts (ULTRASTABLE-TENANT-1).

Nothing tenant-specific is hard-coded. Point ULTRASTABLE_TENANT at a JSON file:
  {"host_suffixes": [".example.workers.dev"], "host_exact": ["example.com"],
   "private_databases": ["identity-db"], "health_url": "https://{worker}.example.workers.dev/health",
   "ledger_db": "ledger", "databases": {"ledger": "<d1-uuid>"}}
With no file the defaults are empty and strict: no host is allowed, no database is known.
"""
import json
import os

_EMPTY = {"host_suffixes": [], "host_exact": [], "private_databases": [],
          "health_url": "", "ledger_db": "", "databases": {}}


def load():
    cfg = dict(_EMPTY)
    path = os.environ.get("ULTRASTABLE_TENANT", "")
    if path:
        with open(path, encoding="utf-8") as f:
            cfg.update(json.load(f))
    return cfg


TENANT = load()
