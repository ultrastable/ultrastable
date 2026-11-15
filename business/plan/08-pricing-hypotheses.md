# Pricing hypotheses (PR-4, issue #43)

Hypotheses to test with design partners, not prices. No figure here is a market fact; each needs a counterpart in `docs/ops/COST-PER-TICK.md` and customer interviews. Mark for accountant review before any public use.

| # | Hypothesis | Basis | How it is tested | Kill criterion |
|---|---|---|---|---|
| H1 | Buyers accept a per-managed-project subscription, not per-seat | The unit of value is a project run on a tick, not a person | Ask each design partner (#7) to rank per-project, per-tick and flat team pricing | Two of three prefer another unit |
| H2 | Price must sit above cost per tick with margin | cost_per_tick formula in COST-PER-TICK.md (agent tokens plus hosting) | Fill the formula from a live run (#109) | Margin below the plus-share reserve |
| H3 | Governance and audit evidence justify a premium over executor-only agents | Positioning in `docs/product-and-positioning.md` section 8 | Ask whether the ledger export replaces a manual audit step | No partner ties it to a budget line |
| H4 | An open core with paid hosting and support converts | `platform/open-core/` exists; licence decided: Ultrastable License (open core) | Partner interviews | Partners will not pay for hosting or support |
| H5 | Pilot is free for three design partners for a fixed period in exchange for a case study | PR-3 case study | Partner agreement terms | Partners refuse publication rights |

Defaults in effect: no price published, no quote given. Follow-up probe: at least one hypothesis row carries linked interview evidence.
