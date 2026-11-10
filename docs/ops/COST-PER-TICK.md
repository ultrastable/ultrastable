# Cost per managed project tick (FUND-7, #109)

Status: method and first measured numbers. The dollar figure is a formula with parameters, not a claim, because no live model run has happened yet (see #91, #90).

## Measured (2026-11-10, platform/core demo, simulated agents, 40 ticks)

| Quantity | Value | How |
|---|---|---|
| Compute per tick | about 0.75 ms | wall time of `run_demo(e, 40)` = 0.03 s / 40 |
| Agent dispatches per tick | 1.4 | 56 dispatches / 40 ticks |
| Outcome rows per tick | 1.33 | 53 outcomes / 40 ticks |

Reproduce: `cd platform/core && python3 -c "from ultrastable.demo import run_demo; ..."` as in the commit that added this file; counts come from the `dispatches`, `outcomes` and `tick_runs` tables.

## Formula

cost_per_tick = dispatches_per_tick x (doer_tokens x doer_price + reviewer_tokens x reviewer_price) + hosting_per_tick

Inputs still to be measured: tokens per doer and reviewer call (from a live run), model prices at the time of pricing (take from the vendor price page then, do not hard-code), hosting per tick (Cloud Run or Workers invoice divided by ticks).

## Default in effect

Pricing stays a planning assumption until a live run fills the token inputs. Closing probe: this file holds a dollar figure computed from a live run's token counts, with the run linked.
