from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from agent_core.coder.models import (
    AcceptanceCriterion,
    BudgetConfig,
    CheckKind,
    DevTask,
    TaskStatus,
    can_transition,
)


def make_task(**over):
    defaults = dict(
        id="dev_001",
        title="rating/action consistency",
        problem="rating capped to Hold but action still says buy",
        acceptance=[
            AcceptanceCriterion(
                id="ac1",
                description="Hold action must not contain buy verbs",
                check=CheckKind.UNIT,
                target="rating-rules",
            )
        ],
        workdir="D:/stock/code",
    )
    defaults.update(over)
    return DevTask(**defaults)


def test_new_task_starts_in_new_status():
    t = make_task()
    assert t.status == TaskStatus.NEW


def test_legal_transitions_are_allowed():
    assert can_transition(TaskStatus.NEW, TaskStatus.REPRODUCED)
    assert can_transition(TaskStatus.REPRODUCED, TaskStatus.DIAGNOSED)
    assert can_transition(TaskStatus.DIAGNOSED, TaskStatus.PATCHED)
    assert can_transition(TaskStatus.PATCHED, TaskStatus.VERIFYING)
    assert can_transition(TaskStatus.VERIFYING, TaskStatus.AWAITING_APPROVAL)
    assert can_transition(TaskStatus.AWAITING_APPROVAL, TaskStatus.VERIFIED)


def test_verifying_failure_returns_to_diagnosed():
    assert can_transition(TaskStatus.VERIFYING, TaskStatus.DIAGNOSED)
    assert can_transition(TaskStatus.AWAITING_APPROVAL, TaskStatus.DIAGNOSED)


def test_any_active_status_can_be_blocked():
    for st in (
        TaskStatus.NEW,
        TaskStatus.REPRODUCED,
        TaskStatus.DIAGNOSED,
        TaskStatus.PATCHED,
        TaskStatus.VERIFYING,
        TaskStatus.AWAITING_APPROVAL,
    ):
        assert can_transition(st, TaskStatus.BLOCKED)


def test_cannot_skip_reproduction():
    assert not can_transition(TaskStatus.NEW, TaskStatus.VERIFIED)
    assert not can_transition(TaskStatus.NEW, TaskStatus.PATCHED)


def test_verified_and_blocked_are_terminal():
    assert not can_transition(TaskStatus.VERIFIED, TaskStatus.DIAGNOSED)
    assert not can_transition(TaskStatus.BLOCKED, TaskStatus.NEW)


def test_acceptance_requires_description():
    with pytest.raises(ValidationError):
        AcceptanceCriterion(id="ac1", description="  ", check=CheckKind.UNIT)


def test_budget_defaults_match_spec():
    b = BudgetConfig()
    assert b.max_iterations == 8
    assert b.max_model_calls == 40
    assert b.wallclock_seconds == 1800


def test_task_records_red_flag_and_timestamps():
    t = make_task()
    assert t.red_seen is False
    assert t.created_at <= datetime.now(timezone.utc)
