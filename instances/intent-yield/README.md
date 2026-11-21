# Instance: Intent Yield

**Ultrastable is the foundation for any autonomous system.** A system is autonomous if it has self-referential loops and the ability to close them. Ultrastable runs on itself. Intent Yield is a Level 1 tenant that answers one question: for a given unit of human input, what is the best unit of output? Its idea file is `IDEA.md` beside this one; `tests/test_intent_yield.py` boots it through the seed's `qualify` stage and holds the rules below in place.

Status: v1 is built and runs daily on Ultrastable's own directives. Code: `foundation/intentyield.py`, config `doctrine/intent-yield.json`, page `site/intentyield.js` (`/yield`, `/yield.json`), workflow `.github/workflows/intent-yield.yml`, tests `tests/foundation/test_intentyield.py` and `site/intentyield.test.mjs`.

## The problem it answers

The framing comes from a passage on intrinsic motivation (a meta-analysis of 51 studies on economic incentives at work): bonuses and targets blunt intrinsic motivation and erode creativity, and "extrinsic incentives will generally pay out in kind. Pay by the hour and you get more hours. Pay by the publication and you get more publications." Any input-to-output ratio built on a count will be optimized by producing more of the count.

Ultrastable is already exposed to this. Its mantra metric `k` counts verified deploys per human touch, and SUBSTANCE-1 exists because the system learned to ship trivial changes (a bumped hash, a renumbered constant) that raised counts without changing behaviour. Intent Yield is the measure that is meant to be hard to pay out in kind.

## Units

**Unit of input: one intent.** One thing the owner said they want, kept verbatim with its date: in v1, a bullet in `agents/AGENTS.md` that names the owner and a date. Its cost is attention: the words at a speaking pace (`words_per_second`), plus every restatement of the same intent. Repeating yourself makes the original intent more expensive; it is never a new input.

**Unit of output: one kept outcome.** A directive is kept when all of these hold:

1. Its own probe (the `python3 -m foundation <x> --check|--verify|--probe` the directive names) passes, run by this loop and not by the agent that did the work.
2. It is past the settle window (30 days).
3. The owner did not restate it.

Verdicts: `kept`, `holding` (passing, not yet settled), `restated`, `broken` (its probe fails), `unmeasured` (no runnable probe, or the probe could not measure; such a probe is read as unmeasured, not broken).

**Yield** is reported as a set, not as one number: kept share of settled directives, holding share, restated share, and median attention seconds per kept directive. Splitting one intent into ten outcomes, or ten PRs, changes nothing, because the unit is the intent.

## How it stays ungameable

| Way a measure gets gamed | Guard |
|---|---|
| Pay by the count, get more of the count | No count of hours, commits, PRs, lines, posts or deploys enters the measure (a test fails if one appears in the summary). The unit is the intent. |
| The optimizer writes its own evidence | Verdicts come from the directive's own probe run by this loop, and restatements from the owner's own words. The agent that did the work writes neither. |
| Tuning to the score | A directive counts as kept only after the 30-day window, and each run logs a prediction of the kept share that a later run scores against what happened. |
| Raising one number by hurting another | The page shows kept, restated and unmeasured side by side; a rise in kept share bought with more restatements shows up in the same table. |
| Trivial output | A Q-YIELD item closes only when the directive's own probe passes, so a cosmetic change cannot close it. |
| Gaming the person instead of the work | No person is scored. No points, streaks, badges, rankings or "inputs this week". More input is not better and fewer words are not a target; the passage is clear that rewarding the person erodes the reason they gave the input. |

The last row is the core design choice. The book's finding is about people; Intent Yield applies incentives only to the system, which has no intrinsic motivation to erode, and protects the person from becoming the thing that is measured.

## What v1 does every day

1. Parses the owner's directives from `agents/AGENTS.md` (62 on 2026-11-21; 38 name a runnable probe).
2. Runs the probes, least recently run first, inside a time box (`run_budget_s`), each with its own timeout. All 38 took about 70 seconds on the first run.
3. Finds restatements: the same directive written twice, a "Restated by" note, or a later directive that quotes an earlier one's words (word overlap at or above `restatement_jaccard`). The first run found three: COMPLETE-1 (restated on 2026-11-18), DRAIN-ZERO-1 (its words repeated inside DRAIN-ALL-1) and CLAIMS-1 (its words repeated inside WORDS-MATCH-CODE-1).
4. Files at most `max_items_per_run` `Q-YIELD-*` items for broken directives, each closed by the directive's own probe, through the flow-balance gate. The first run filed one: FAILURE-RESOLVE-1, whose `failure_audit --check` fails.
5. Writes `ops/intent-yield/state.json`, appends `ops/intent-yield/history.jsonl` (capped), regenerates `site/intent-yield-data.js`, and lands them on main.

## Running unattended for a year

| What could stop it | How it is covered |
|---|---|
| The daily run stops (scheduler skips, workflow disabled) | Clock `intent-yield` in `doctrine/clocks.json`: the watchdog probes it and dispatches the workflow when it is late, and the Cloudflare tick wakes the watchdog. Detector `intent-yield-fresh` in the daily failure audit fails past 50 hours and files `Q-AUDIT-intent-yield-fresh` for the executor. |
| A run errors | The run still lands its state with the error recorded, the workflow then fails loudly, and the same detector files the error. |
| The directive format changes and the parser silently finds nothing | A run that parses fewer than `min_intents`, or loses more than half of the previous run's directives, is an error, not a result. |
| A probe hangs or grows slow | Per-probe timeout and a run time box; probes rotate, so a slow one delays the others by a day at most. The job has a 15-minute timeout. |
| A probe is renamed or loses access | An exit code other than 0 or 1 is `unmeasured`, not `broken`, so it files no false item; the unmeasured count is on the page. |
| Credentials expire | None of its own. It runs on the workflow's built-in token, which GitHub mints for each run; landing uses `LANE_PAT` when present and falls back to the built-in token and then a pull request (`scripts/land_data.py`). `LANE_PAT` expiry is watched by credwatch. |
| Cost | No model calls and no paid service: Python standard library only, about 2 to 3 Actions minutes a day, under the `actions-budget.json` kill switch. |
| Dependency drift | No third-party packages. The checkout action is pinned by hash and updated by Dependabot. |
| Unbounded growth | History is capped at `history_keep` rows; state holds one row per probe command; items are capped per run and gated by flow balance. |
| The owner halts everything | The job honours `HALT=1`. |

Not covered by this loop alone: the GitHub runner image (`ubuntu-24.04`) being retired, and GitHub Actions being unavailable for days. Both are fault classes in the year simulation (`doctrine/yearsim.json`), and the session route in the loop registry runs the same command.

## Next

- Intents from other channels (thread messages, the owner console) with their own probes, matched by meaning.
- A `Q-YIELD` item for a restated directive, closed when the directive gains a probe that would have caught the drift.
