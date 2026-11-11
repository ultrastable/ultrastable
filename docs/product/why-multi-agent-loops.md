# Why Ultrastable is multi-agent, self-referential code loops

**Vibe coding is a start, not a system.** Describing what you want to one model gets you a first draft. It does not run, check, remember, improve or report on itself next week.

| Approach | What it gives | Where it stops |
|---|---|---|
| Vibe coding | A fast first draft from a description | No memory, no checks, no owner of the result; breaks silently; the person must read code to know |
| One code agent | Strong execution of a task someone hands it | It does not decide what is missing, review its own work, run the schedule, or report; one context, one failure point |
| **Multi-agent code loops** | Many agents with one job each (manager, doer, reviewer, operations) on a heartbeat | Needs the discipline below, which is the product |

What makes a loop a system, all in code:
1. **Many agents, separated duties.** The doer is never the reviewer; a manager owns each outcome. A single agent cannot honestly check itself.
2. **A heartbeat.** Each tick reconciles state, pulls the next item, acts, verifies by an independent path, compares with the logged prediction, records, reports in four lines.
3. **Self-referential.** The rules, roles and limits are files the agents read and, through reviewed PRs, amend. Plussing reserves capacity to improve the loop itself; trust widens scope only by PR.
4. **Everything is a record.** If it is not in code it does not exist; a thread can vanish and the system continues.
5. **Bounded reach.** Optional plugins (email, social, video, cloud) go through one gate: scope file, dry-run default, consent, caps, guard, credentials by name only. Outreach and marketing are loops with the same discipline, not scripts that post.

A person with an idea supplies the wish in plain choices; the loops do the rest, and only an irreversible, identity-bound step comes back to them.
