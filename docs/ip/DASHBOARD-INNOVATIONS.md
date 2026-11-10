# Dashboard innovations for the provisional (working draft for attorney review, not legal advice)

Rowan's instruction (2026-11-10): the dashboard, email-me-a-code, owner task queue, one-tap fix or delegate-to-fleet buttons and command execution from the dashboard are all inventive features of Ultrastable and must be in the provisional. Source of the reduction to practice: the QNFO fleet dashboard (qnfo-fleet-dashboard, public history in QNFO/qnfo-workers) and this repo's `dashboard/`.

Status: NOT yet in `provisional-specification.md`. The sibling thread owns that file and the repo layout; this note is the insert text and claim proposals to merge, so nothing is lost.

## Features to describe (each is an embodiment element)
1. **Single owner pane on the organization's own infrastructure.** One page shows the state of every service, check, task and agent action at a glance, read from the system's own records, with no third-party monitoring product.
2. **Email-me-a-code owner login.** No password. A one-time code is generated, only its salted hash is stored, it is sent to a single pre-configured owner address (the request carries no address), expires in minutes, burns after a few wrong tries, and is rate limited. A session cookie follows.
3. **Step-up confirmation for state changes.** A signed-in session can read; any change requires a code emailed within a short window. The interface prompts in place, then repeats the interrupted action after verification. A machine token can read but cannot approve (QNFO: the loop token is refused for owner decisions).
4. **Owner task queue split by who can act.** Items are classified identity-bound (money, signature, legal act, owner's own accounts) versus delegable; delegable items are never shown to the owner as work. Each item carries a plain reading: what it is, why it is shown, what happens if the owner waits, and what to do.
5. **One-tap actions.** Done, Snooze (3 or 7 days, returns on its own), Not doing, Fix it, Hand to fleet, Approve and Decline on decision cards. Targets are large enough for a phone.
6. **Delegate to the fleet.** The tap writes a queue entry that agents claim and acknowledge; the issue is labeled in the tracker; completion closes the task. The owner sets direction and receives reports; the owner is not the executor.
7. **Command execution from the dashboard.** A registry of named commands runs through one path used by both typed commands and buttons; there is no arbitrary shell. Mutating commands are gated by step-up; reads are not. Voice input (speech to text) can feed the same line (QNFO CMD-VOICE-1).
8. **Audit log with undo.** Every command is recorded with its result and, for state changes, the inverse; `undo` reverses the last undoable change.
9. **Owner email notifications.** Failing checks, new owner items (grouped into one message) and a daily digest, each de-duplicated by a key so a condition mails once, and logged on the dashboard including failures to send.
10. **Disclosure guard.** A recurring check fetches the public pages and fails if they contain terms from a forbidden list, so confidentiality before filing is enforced by the system, not by memory.
11. **Public side minimal, owner side complete.** Same deployment serves a generic public page and the owner pane; visitors see only the former. (QNFO variant: signed-out visitors may Ask but cannot change anything.)
12. **Other QNFO dashboard elements observed to describe**: yield per $100 (outputs, quality, impact per unit cost) with push and trim levers; triage view mapping each breaching metric to a root cause and listing breaching metrics no cause maps (named, never counted as zero); watchmaker index (a recurring operation is listed with the query that proves it ran); a changelog and architecture view generated from the system's records.

## Proposed claims (to merge into the claim families in CLAIM-STRATEGY.md)
- A system comprising a processor and storage, configured to: store a hashed one-time code generated on request; send the code only to a pre-configured owner address; accept the code to open a session; and require a code verified within a step-up window before executing any command that changes state.
- The system of the above, wherein the interface, on a refused change, requests the code in place and re-executes the refused change after verification.
- A system that classifies queue items as identity-bound or delegable, presents only identity-bound items as owner work, and on a single user input moves a delegable item to a queue read and acknowledged by autonomous agents.
- A method wherein typed commands and single-input controls resolve to the same registered command, each execution is written to an audit record with an inverse operation, and a command reverses the most recent inverse.
- A method wherein a recurring check retrieves a public page and fails when it contains any term of a forbidden list, and the failure sends the owner a notification de-duplicated by a key.
- A notification method that groups new owner items into a single message, sends a periodic digest, and records each send and each failed send for display on the owner interface.

## Evidence (reduction to practice)
- QNFO: qnfo-fleet-dashboard worker (OTP step-up, /api/owner/act, /api/cmd/run, ONE-TAP-ACTIONS-1, CMD-VOICE-1 release notes inside the worker header); dates to be filled in the evidence log from QNFO commits.
- Ultrastable: `dashboard/` (this PR), tests in `dashboard/test/`.
