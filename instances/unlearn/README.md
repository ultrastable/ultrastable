# Instance: Unlearn

**Ultrastable is the foundation for any autonomous system.** Unlearn is a tenant system on it (level 1, parent `ultrastable`). Idea and system test: `IDEA.md`; manifest: `instance.json`.

A system is autonomous if it has self-referential loops and the ability to close them (`python3 -m foundation loops --verify`).

Ultrastable runs on itself (`python3 -m foundation selfhost`).

> "Most of what kids want to learn, you can't teach them." (Rob, a coach at Agora, in Rutger Bregman, *Humankind*, chapter "Homo Ludens".) The coaches there "nurture and challenge, encourage and guide", and "have to unlearn much of their training as teachers."

## Concept

Play and exploration are learning. Unlearn is not a lesson app. It serves the adult beside a curious child (coach, parent, mentor), because that adult is the one who has to unlearn the reflex to teach.

1. **Log a curiosity.** One line, spoken or typed: "She wants to know why the bread rose." No child account, no child data.
2. **Get a coaching move, never a lesson.** One of four kinds: a question to ask back, something to try or build, a person or place to go to, a reason to wait and watch. Never an explanation of the answer.
3. **Follow up.** At 7 and 14 days Unlearn asks one yes/no: is the child still at it on their own?
4. **Re-weight.** Moves that keep children going rise; moves that end explorations fall and are retired. Coach notes are read for telling versus asking.

What it refuses: curricula, grades, streaks, leaderboards, mastery levels. Anything that turns play back into instruction is a defect.

## The loop and its measures (Ultrastable system test)

| | |
|---|---|
| Loop | curiosity → move → follow-up at 7 and 14 days → move weights updated |
| Primary measure | `continuation_14d`: share of explorations still self-directed after 14 days, target ≥ 0.5 |
| Guard measure | `telling_share`: share of coach notes that tell rather than ask, target ≤ 0.3 |
| Upkeep | new curiosities weekly, link rot in resources, retiring moves that stop working |
| Run cost | 5 USD a month (Workers, D1, Workers AI inside the free allocation) |

`seed/bootstrap/bootstrap.py --dry-run` on this `IDEA.md` passes stage `qualify` and seeds 3 objectives and 12 metrics (8 liveness, 4 declared awaiting probes).

## Build plan (each step a queue item with a closing probe)

1. **Manifest and idea** (this change). Probe: `python3 -m unittest tests.foundation.test_unlearn`.
2. **Tenant runtime.** One Durable Object per tenant in `ultrastable-tenants` (TENANT-STORAGE-1); tables `curiosities`, `moves`, `followups`, `move_weights`. Probe: tenant `/health` self-test.
3. **Pill ask bar** (INTERVIEW-1): "What is the child curious about?" with mic, then two either/or taps (age band, indoors or out). Probe: `site/site.test.mjs`-style render test.
4. **Move generator.** Workers AI with a system prompt that forbids explanations; a guard rejects any move that states the answer (lexical check plus a second model pass). Probe: fixture set of 50 curiosities, 0 moves that explain.
5. **Follow-up clock** at 7 and 14 days by email link (one tap yes/no), cron in the tick Worker. Probe: `continuation_14d` has a probe and leaves `declared`.
6. **Telling detector** for coach notes (question share, imperative share). Probe: `telling_share` measured.
7. **Public page** rendering only measured numbers (FRONT-BACKED-1, CLAIMS-1).

## Open product decision

Audience for v1: the adult (coach or parent) is the user, and the child never holds an account. Default in effect until changed: coaches and parents first.
