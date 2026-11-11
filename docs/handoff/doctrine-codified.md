# Handoff: doctrine codified (2026-11-11)

Session: session_0156nqDtpVbQueQpYRm4zUBg

Built: `doctrine/glossary.json` + `GLOSSARY.md` + dashboard glossary and loops panels; autonomy line (`doctrine/positioning.json` `autonomy`, injected and linted, GL008); loop registry `instances/ultrastable/loops.json` and `foundation/loops.py`; `foundation/writeback.py`; `foundation/kernel.py` and `foundation/trust.py` with `doctrine/kernel-8.2.1.md`, `doctrine/kernel.json`, `doctrine/standing-directives.md`; framing lint in `foundation/doctrine.py`; tests `tests/foundation/test_{loops,glossary,kernel,writeback,doctrine_lint}.py`; one new step in `checks.yml`, no new workflow.

Next (driver order): wire `kernel --lint` over `docs/handoff` once older handoffs are rewritten; have the tick runtime call `foundation trust --tick`; show glossary on the live dashboard when the worker deploys (gap BG-27).
