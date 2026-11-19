"""Regression test: a raising probe is logged and recorded, never swallowed."""

import logging

from foundation.clockwork import Clockwork, LoopStep


def test_raising_probe_is_recorded_not_silenced():
    def trigger():
        return True

    def probe():
        raise ValueError("probe exploded")

    step = LoopStep("s1", owner="code-agent", trigger=trigger, probe=probe, max_attempts=2)
    clock = Clockwork()
    clock.register(step)
    verdict = clock.run()
    assert not verdict["steps"][0]["closed"]
    errors = [e for e in step.events if e["kind"] == "probe_error"]
    assert len(errors) == 2
    assert "probe exploded" in errors[0]["detail"]


def test_raising_probe_is_logged(caplog):
    def trigger():
        return True

    def probe():
        raise RuntimeError("visible")

    step = LoopStep("s2", owner="code-agent", trigger=trigger, probe=probe, max_attempts=1)
    with caplog.at_level(logging.WARNING, logger="ultrastable.clockwork"):
        step.run()
    assert any("visible" in rec.message for rec in caplog.records)


def test_passing_probe_closes():
    step = LoopStep(
        "s3",
        owner="code-agent",
        trigger=lambda: True,
        probe=lambda: True,
        max_attempts=1,
    )
    assert step.run() is True
