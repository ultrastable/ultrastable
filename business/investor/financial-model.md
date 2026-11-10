# Financial model (structure only, issue #9)

Status: model structure with measured inputs; every dollar input is blank until measured or sourced. **NEEDS ACCOUNTANT** before any external use. Nothing here is a forecast. Nothing here is public before the provisional filing.

## Unit economics (per managed project per month)

```
ticks_per_month      = 30 x 24 x 60 / tick_minutes          # tick_minutes = 10 in policy, so 4,320
cost_per_tick        = dispatches_per_tick x (doer_tokens x doer_price + reviewer_tokens x reviewer_price) + hosting_per_tick
cost_per_project     = ticks_per_month x cost_per_tick + support_cost
price_per_project    = hypothesis H1..H5 in business/plan/08-pricing-hypotheses.md
gross_margin         = (price_per_project - cost_per_project) / price_per_project
```

| Input | Value | Source |
|---|---|---|
| tick_minutes | 10 | `platform/core/ultrastable/data/policy.json` |
| dispatches_per_tick | 1.4 (simulated agents, 40 ticks) | `docs/ops/COST-PER-TICK.md` |
| doer_tokens, reviewer_tokens | not measured | needs a live run (#91, #94) |
| doer_price, reviewer_price | not recorded | vendor price page on the day of pricing |
| hosting_per_tick | not measured | Cloud Run or Workers invoice / ticks |
| support_cost | not estimated | design-partner pilot (#7) |

## Company level (fill after entity and funding route are decided)

| Line | Status |
|---|---|
| Revenue by month | no customers; no figure claimed |
| Funding | none received; programs and their verification state in `business/funding/registry.json` |
| Fixed costs | domains, hosting, tooling: sum from invoices |
| Runway | cash / monthly burn once an entity and bank account exist (#105) |

## Closing probe
Every blank input above is replaced with a sourced figure and an accountant has reviewed the file; until then the data-room index row 10 stays "structure only".
