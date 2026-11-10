# Products

Ultrastable ships its own products from what already exists in this repo. Decided 2026-11-10 without being asked; code is the measure, not user impact.

| Product | What it is | Built from | Status |
|---|---|---|---|
| **gaplint** (`products/gaplint/`) | Lints any repo for open loops: gap entries without a closing probe, owner cards without a default, agent files missing standing rules, reports that hand steps to a person. | the gap register and agent agreement formats | BUILT: 11 tests, runs in the `checks` workflow |
| Funding packet generator (standalone) | Validates and tracks funding application packets for any org from a registry file. | `scripts/funding_packet.py` and `business/funding/` | PLANNED: extract with its tests, no repo-specific paths |
| Self-filing guide generator | Turns a form-filing route (portal, fees, signature, payment) into a click-by-click walkthrough plus an owner card with default and probe. | the walkthrough and owner-card format in `ip/europe/` | PLANNED: generic template and generator, no domain-specific content |

Order was chosen by reuse: gaplint also enforces the agent agreement, so it ships first. Each product needs code, tests, docs and a probed check before it counts as shipped. Impact on outside users is a hypothesis until measured.

Also: `demos/` holds the runnable demos (see `demos/README.md`).
