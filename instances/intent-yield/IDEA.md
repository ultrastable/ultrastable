---
# Level 1 tenant on Ultrastable. Design proposal: instances/intent-yield/README.md. Consumer: tests/test_intent_yield.py.
org_name: Intent Yield
slug: intent-yield
owner: Rowan
owner_contact: set-in-secret-store
owner_contact_backup: set-in-secret-store
parent: ultrastable
---

# Idea

For a given unit of human input, what is the best unit of output? Intent Yield takes each thing a person says they want (one intent, in their own words) and measures what came of it: did an outcome the intent named come true, pass its own probe, and stay true, without the person having to say it again. It scores the system's response to the person, never the person, and it never counts hours, commits, lines or posts, because a count that is paid for is a count that grows.

# System test

- Loop: intent recorded, work dispatched, outcome probed, survival and restatements read from the record after the settle window, the system's next response re-weighted, with no person in the middle
- Measure: share of intents kept at 30 days (outcome probe passes, not reverted, not restated), paired with attention seconds per kept intent; target 0.8 kept
- Upkeep: new intents arrive every day and kept outcomes decay as the code around them changes
- Run cost: model calls for matching intents to outcomes and restatements, and storage, every month

# Who it is for

- One person, or a small team, who direct an Ultrastable system and want their words to turn into lasting results instead of activity

# First outcomes

- Every owner directive Ultrastable already holds has a kept, broken or unmeasured verdict, recomputed daily
- A restatement of an earlier intent is detected and charged to the original intent
- The yield and its guards are published at /yield and /yield.json, with no score shown for any person

# Constraints

- Budget per month: 5 USD
- Read-only in v1: it measures and files items, it changes no other loop's code
- No points, streaks, badges, rankings or per-person scores anywhere
