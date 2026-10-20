"""Budget and retry discipline for the inner loop (spec section 5.2/5.3).

Three independent caps (iterations / model calls / wall-clock) plus two
counters that stop unproductive repetition:
  * the same root-cause hypothesis failing twice forces a fresh diagnosis;
  * a second forced re-diagnosis with no direction escalates to BLOCKED.
A clock is injected so wall-clock behaviour is deterministic in tests.
"""

from __future__ import annotations

import time
from collections.abc import Callable

from .models import BudgetConfig


class BudgetGuard:
    def __init__(self, config: BudgetConfig, clock: Callable[[], float] | None = None):
        self.config = config
        self._clock = clock or time.monotonic
        self._start = self._clock()
        self.iterations = 0
        self.model_calls = 0
        self._hypothesis: str | None = None
        self._hypothesis_failures = 0
        self.rethink_count = 0

    def tick_iteration(self) -> None:
        self.iterations += 1

    def tick_model_call(self) -> None:
        self.model_calls += 1

    def set_hypothesis(self, hypothesis: str) -> None:
        """Call when the model commits to a new root-cause hypothesis."""
        if hypothesis != self._hypothesis:
            self._hypothesis = hypothesis
            self._hypothesis_failures = 0

    def note_hypothesis_failure(self, hypothesis: str) -> bool:
        """Record a failed attempt for hypothesis. Return True to force rethink."""
        self.set_hypothesis(hypothesis)
        self._hypothesis_failures += 1
        return self._hypothesis_failures >= 2

    def note_rethink(self) -> bool:
        """Record a forced re-diagnosis. Return True when the task must block."""
        self.rethink_count += 1
        return self.rethink_count >= 2

    def exhausted(self) -> tuple[bool, str]:
        if self.iterations >= self.config.max_iterations:
            return True, "iteration budget reached"
        if self.model_calls >= self.config.max_model_calls:
            return True, "model call budget reached"
        if self._clock() - self._start >= self.config.wallclock_seconds:
            return True, "wall-clock time budget reached"
        return False, ""
