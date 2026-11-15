# Outreach: funding and promotion loop

Run by the funding manager, outreach manager and outreach coordinator (`agents/roles/`). Engine: `scripts/outreach.py` (generic; the QNFO fleet adopts it by copying `outreach/` and the script and editing `profiles.json`). Schedule: `.github/workflows/outreach.yml`, weekly and on demand only (one job, minute budget in its header; Actions minutes are limited).

Pipeline per target `<profile>:<registry id>`: discover (registry rows only, track matches the profile, not marked `outreach:false`) -> tailored packet in `packets/` -> guard (blocked words, no numbers or links in our own text) -> queue (only from a verified or secondary source, within caps) -> send (email routes through the sender adapter in live mode) or one consolidated owner card per profile (forms) -> replies (`outreach.py reply`) -> follow-ups on the cadence in `gate.json`, at most two -> status in `STATUS.md` and `status.json`.

| File | Purpose |
|---|---|
| `gate.json` | kill switch, mode (dry-run or live), sender identity, caps, cadence. Data, edited by PR |
| `profiles.json` | who is asking: tracks, the only text packets may contain, blocked patterns |
| `suppression.json` | opt-outs and do-not-contact; always wins |
| `state.json`, `log.jsonl` | every target and event; nothing is dropped without a disposition |
| `predictions.json` | scored predictions |
| `cards/` | owner cards (identity-bound, default in effect, closing probe) |

Live versus dry-run: see the top of `STATUS.md`. Live needs the owner's sender identity (`cards/OUT-SENDER.md`); forms are always the owner's act.
