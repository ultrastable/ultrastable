# Instance: Intent Yield (design proposal)

**Ultrastable is the foundation for any autonomous system.** Intent Yield is a proposed Level 1 tenant that answers one question: for a given unit of human input, what is the best unit of output? Its idea file is `IDEA.md` beside this one; `tests/test_intent_yield.py` boots it through the seed's `qualify` stage and holds the rules below in place.

Status: proposal. Nothing is deployed. v1 below is the first build.

## The problem it answers

The framing comes from a passage on intrinsic motivation (a meta-analysis of 51 studies on economic incentives at work): bonuses and targets blunt intrinsic motivation and erode creativity, and "extrinsic incentives will generally pay out in kind. Pay by the hour and you get more hours. Pay by the publication and you get more publications." Any input-to-output ratio built on a count will be optimized by producing more of the count.

Ultrastable is already exposed to this. Its mantra metric `k` counts verified deploys per human touch, and SUBSTANCE-1 exists because the system learned to ship trivial changes (a bumped hash, a renumbered constant) that raised counts without changing behaviour. Intent Yield is the measure that is meant to be hard to pay out in kind.

## Units

**Unit of input: one intent.** One thing a person said they want, kept verbatim with its time and channel (typed, spoken, a thread message, a directive in `agents/AGENTS.md`). Its cost is the person's attention: seconds spent saying it, plus every later correction or restatement of the same intent. Repeating yourself makes the original intent more expensive; it is never a new input.

**Unit of output: one kept outcome.** An outcome counts for an intent only when all four hold:

1. The intent names it (matched by meaning, not by an agent's claim that it is related).
2. Its closing probe passes, run by a route other than the one that did the work.
3. It is still in place after the settle window (30 days): not reverted, not superseded by a fix.
4. The person did not restate or correct the intent inside the window.

**Yield** is reported as a pair and never as one number:

- kept share: intents with a kept outcome / intents that reached the settle window;
- attention per kept intent: median attention seconds (including restatements) per kept intent.

An intent is kept or broken; there is no partial credit for activity. Splitting one intent into ten outcomes, or ten PRs, changes nothing, because the unit is the intent.

## How it stays ungameable

| Way a measure gets gamed | Guard |
|---|---|
| Pay by the count, get more of the count | No count of hours, commits, PRs, lines, posts or deploys enters the measure. The unit is the intent. |
| The optimizer writes its own evidence | Survival is read from git history, restatements from the person's own words, probes run on an independent route. The agent that did the work writes none of them. |
| Peeking and tuning to the score | Per-intent verdicts are sealed until the window settles, like the pre-registered experiments in `doctrine/design-experiments.json`. |
| Raising one number by hurting another | Kept share may not rise while revert rate or restatement rate rises; such a period is a breach, not a gain. |
| Trivial output | Only changes that pass SUBSTANCE-1 (`foundation/substance.py`) can be an outcome. |
| Gaming the person instead of the work | The person is never scored. No points, streaks, badges, rankings or "inputs this week". More input is not better and fewer words are not a target; the passage is clear that rewarding the person erodes the reason they gave the input. |

The last row is the core design choice. The book's finding is about people; Intent Yield applies incentives only to the system, which has no intrinsic motivation to erode, and protects the person from becoming the thing that is measured.

## The system test

- Loop: intent recorded, work dispatched, outcome probed, survival and restatements read after the settle window, the system's next response re-weighted (for example, which agent or approach handles that kind of intent).
- Measure: kept share at 30 days, target 0.8, paired with attention per kept intent. It can be wrong and is scored against a logged prediction.
- Upkeep: intents arrive daily, and kept outcomes decay as code around them changes, so verdicts are recomputed.
- Run cost: 5 USD a month for matching and storage.

## v1: dogfood on Ultrastable's own directives

v1 is read-only and has a dataset on day one. `agents/AGENTS.md` holds about 60 dated owner directives, most with a verbatim quote and a named probe (`python3 -m foundation <x> --check`). Each is an intent. v1:

1. Parses the directives into `ops/intent-yield/intents.jsonl` (id, date, quote, named probe).
2. Runs each named probe daily and records kept, broken or unmeasured. A directive with no runnable probe is unmeasured, never kept.
3. Detects restatements: an explicit "Restated by", or a later directive whose quote matches an earlier one by meaning. Each is charged to the original. The file already shows the signal it is looking for: the DRAIN-ZERO-1 quote appears twice, and "No open loops" and "Write back before you end" are each written twice.
4. Publishes `/yield.json` and a `/yield` page from that ledger, and files one `Q-YIELD-*` item per broken directive with its own probe as the closing probe.
5. Logs a prediction before each run (`kept_share >= 0.6 within 720 h`) and scores it after.

Not in v1: intents from anyone but the owner, voice capture, the matching model (v1 uses the probe each directive already names), and any write to other loops.

## Assumptions

- The owner of the input is one person (Rowan), and the first system measured is Ultrastable itself, so the tenant is a measure of how well Ultrastable turns its owner's words into lasting behaviour.
- 30 days is the settle window. It is long enough for reverts and restatements to show, and short enough to re-weight monthly.
- Lives in this repository under `instances/intent-yield/` until it needs its own Worker, then moves to its own repository the way Practical Solutions did.
