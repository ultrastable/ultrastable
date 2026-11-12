# Guiding directive: where each clause lives in code

> Ultrastable is the foundation for any autonomous system.

Rowan (2026-11-12): "All information is useful somehow. The key is you have to figure out what to do with it." The directive is stored verbatim in `GUIDING-DIRECTIVE.md` and layers on `doctrine/kernel-8.2.1.md` (section 4 is IC-GATE-001). This map says what each clause became. Check: `python3 -m foundation directive --check`.

| Clause | Becomes | Enforced by |
|---|---|---|
| Opening paragraph, 1, 18, 19 | Imported by `CLAUDE.md`; loaded by `agents/AGENTS.md`, every role file, both copilot files; copied to `seed/doctrine/` so new systems inherit it | `directive.instruction_check`, byte-equal seed copy |
| 0 Precedence, tie-break | `precedence`, `tie_break` in `doctrine/directive.json` | `directive.check` compares order with the text |
| 2 Loop-breaker | `directive.loop_breaker` (2 same-signature failures: mutate; 3: incident) | `test_loop_breaker` |
| 3 Blocker red-team, 15 surface-coverage | `surfaces`, `blocker_fields`; `directive.scorecard` | `test_blocker_log_scorecard` |
| 4 Interrupt gate | kernel IC-GATE-001, `seed/autonomy/policy.json`; register control `ctl-interrupt-gate` | `directive.registers_check` |
| 5, 6 No loose ends, no silent drop | `directive.accounting` (`entered = open + closed + superseded`), `issue_ledger` over `docs/issues` | `test_accounting_invariant`, `directive --ledger` |
| 7 Security | kernel secret rules, `agents/AGENTS.md` section 1 | existing secret lint |
| 12, 16 SPOF and failure-mode registers | `doctrine/registers.json`, cadence probes, append-only `doctrine/probe-log.jsonl` | `directive --check`, `directive --probe` |
| 13 Control disposition | `controls` in the register: remove, demote or replace; none on a critical path | `registers_check` |
| 14 Provenance | `provenance_fields`, `directive.validate_provenance` | `test_provenance` |
| 15 Scorecard | `scorecard` in `directive.json`, `directive.scorecard` | `test_blocker_log_scorecard` |
| 1, 3, 20 No questions, menus, owner blockers | `lint` rules (question-to-owner, menu, courtesy-stop, blocker-as-owner-issue) | `directive --lint` over handoff and lessons in `checks` |
| 17 Self-modification | kernel §EVOLUTION and the `doctrine-amendment` loop; the directive changes only by PR with lineage | glossary term `guiding-directive` |
| Memory is not storage (Rowan, same day) | `doctrine/durable-facts.json`, `docs/BOOTSTRAP-NO-MEMORY.md` | `directive.facts_check`, `directive --bootstrap` |
