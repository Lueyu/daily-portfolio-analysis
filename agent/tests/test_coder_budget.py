from agent_core.coder.budget import BudgetGuard
from agent_core.coder.models import BudgetConfig


class FakeClock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t

    def advance(self, dt):
        self.t += dt


def guard(clock=None, **over):
    cfg = BudgetConfig(**over)
    return BudgetGuard(cfg, clock=clock or FakeClock())


def test_not_exhausted_at_start():
    g = guard()
    assert g.exhausted() == (False, "")


def test_iteration_cap_trips():
    g = guard(max_iterations=2)
    g.tick_iteration()
    assert g.exhausted() == (False, "")
    g.tick_iteration()
    tripped, reason = g.exhausted()
    assert tripped and "iteration" in reason


def test_model_call_cap_trips():
    g = guard(max_model_calls=3)
    for _ in range(3):
        g.tick_model_call()
    tripped, reason = g.exhausted()
    assert tripped and "model call" in reason


def test_wallclock_cap_trips():
    clock = FakeClock()
    g = guard(clock, wallclock_seconds=30)
    clock.advance(31)
    tripped, reason = g.exhausted()
    assert tripped and "time" in reason


def test_same_hypothesis_failing_twice_forces_rethink():
    g = guard()
    assert g.note_hypothesis_failure("hyp-A") is False
    assert g.note_hypothesis_failure("hyp-A") is True
    # A new hypothesis resets the streak.
    assert g.note_hypothesis_failure("hyp-B") is False


def test_rethinking_twice_blocks():
    g = guard()
    assert g.note_rethink() is False
    assert g.note_rethink() is True  # escalate to BLOCKED
