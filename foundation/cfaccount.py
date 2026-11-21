# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SINGLE-ACCOUNT-2 (Rowan 2026-11-21: zero Ultrastable assets in quniverse): no foundation command acts on a retired Cloudflare account.

The repo secrets CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID still name the retired account (deploy/cloudflare-accounts.json `target.gate`). A command
that read them would deploy to, spend in or write to that account. scrub() runs before every `python3 -m foundation` command: when the bound account
is retired it removes both variables from this process, so each module takes its credential-free route (OIDC through the site worker) or reports
itself unmeasured. The deploy/*.mjs scripts carry the same guard inline; `singleaccount --check` fails a script that reads the account id without it.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def retired_ids(root=ROOT) -> list[str]:
    return json.loads((Path(root) / "deploy" / "cloudflare-accounts.json").read_text(encoding="utf-8")).get("retired_account_ids", [])


def scrub(env=None, root=ROOT) -> bool:
    env = os.environ if env is None else env
    if env.get("CLOUDFLARE_ACCOUNT_ID", "") in retired_ids(root):
        env.pop("CLOUDFLARE_ACCOUNT_ID", None)
        env.pop("CLOUDFLARE_API_TOKEN", None)
        print("cfaccount: the bound Cloudflare account is retired; its credential is not used by this command (SINGLE-ACCOUNT-2)", file=sys.stderr)
        return True
    return False
