# The seed (owner direction, 2026-11-14)

A system is only as good as its seed. The seed is the person's vision or charter: enough direction to grow from, not a specification. It need not be in the system's language. The person knows the vision; the system knows what it can code; the loops translate between them.

## Rules

1. **Seed over nuts and bolts.** Intake encourages high-level vision ("a system that builds other systems") and asks only the clarifying questions that sharpen direction. It never asks for implementation detail the system can decide.
2. **Depth comes from loops, not from the prompt.** One-shot vibe coding returns something shallow (a web page). Ultrastable's offer is repetition: self-reinforcing, self-improving code loops that deepen a seed over many cycles. The person supplies the seed; the loops supply the depth.
3. **A charter always exists.** Every system (tenant 0, Practical Solutions, each pilot) has a charter file naming its vision. A system with no charter has no direction and the ranker treats it as unprioritized.
4. **The seed changes.** Visions are revised as paths are explored. A revision is a versioned change to the charter, never an overwrite, and it re-ranks the backlog (the charter's vectors are the ranker's goals).
5. **Superposition, vector, fork, collapse.** Before a seed is acted on it holds every direction a computer could take. Choosing a direction (a vector) collapses part of that space into work. Paths fork: each fork is a branch with its own charter delta, running in parallel; a fork that does not move its metric is closed and its learning kept, one that does is merged or becomes the new default. Choosing is recorded (decision log) so the collapsed alternatives stay recoverable.
6. **Criticality is the test.** The seed has grown enough when its loops produce more verified deploys than they consume in cost and attention (see the north star). Project management (priorities, queues, roadmaps) is the machinery that turns a vector into ordered work; it serves the seed and is regenerated when the seed changes.

## Mapping to the code

| Idea | Home |
|---|---|
| Seed / charter | `charter.json` per system (SEED-1, not yet built); tenant 0 reads `docs/doctrine/VISION.md` |
| Vectors become goals | `doctrine/priorities.json` goals, to be derived from the charter (SEED-1) |
| Fork and collapse | branches plus `decision_log` rows with predicted outcome and revert path (SEED-2) |
| Intake that asks for vision | front door interview, high-level first (INTERVIEW-1..4) |

The quantum parallel is a design analogy for how direction is chosen and recorded, not a physical claim.
