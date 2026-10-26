# tests/test_coder_gates.py
from agent_core.coder.gates import (
    GateKind,
    GateState,
    VerifyState,
    visible_tools,
)
from agent_core.coder.models import (
    AcceptanceCriterion,
    CheckKind,
    DevTask,
)
from agent_core.coder.parser import build_default_registry


def _task(**kw) -> DevTask:
    base = dict(
        id="dev_1", title="t", problem="buy but risk fails",
        acceptance=[AcceptanceCriterion(
            id="a1", description="consistent", check=CheckKind.UNIT)],
        workdir="/tmp/repo",
    )
    base.update(kw)
    return DevTask(**base)


def test_initial_gate_hides_patch_and_finish():
    g = GateState.from_task(_task())
    names = visible_tools(build_default_registry(), g)
    assert "apply_patch" not in names and "finish" not in names
    assert "read_file" in names and "run_check" in names and "blocked" in names


def test_red_opens_patch_but_not_finish():
    g = GateState.from_task(_task())
    g.record_red()
    names = visible_tools(build_default_registry(), g)
    assert "apply_patch" in names and "finish" not in names
    assert g.red_seen and g.verify_state == VerifyState.NONE


def test_green_after_write_opens_finish():
    g = GateState.from_task(_task())
    g.record_red()
    g.record_write()
    g.begin_verify()
    g.record_verify(True)
    names = visible_tools(build_default_registry(), g)
    assert "finish" in names and "apply_patch" in names
    assert g.verify_state == VerifyState.PASSED


def test_failed_verify_closes_patch_again_until_recheck():
    g = GateState.from_task(_task())
    g.record_red(); g.record_write(); g.begin_verify()
    g.record_verify(False)
    names = visible_tools(build_default_registry(), g)
    assert "finish" not in names and "apply_patch" not in names
    assert g.verify_state == VerifyState.FAILED


def test_reset_change_after_failed_patch():
    g = GateState.from_task(_task())
    g.record_red(); g.record_write(); g.begin_verify(); g.record_verify(False)
    g.reset_change()
    assert g.sandbox_dirty is False
    assert g.verify_state == VerifyState.NONE
    names = visible_tools(build_default_registry(), g)
    assert "apply_patch" in names and "finish" not in names


def test_gate_round_trips_through_task():
    t = _task()
    g = GateState.from_task(t)
    g.record_red(); g.record_write(); g.begin_verify(); g.record_verify(True)
    g.apply_to(t)
    assert t.red_seen is True
    assert t.sandbox_dirty is True
    assert t.verify_state == VerifyState.PASSED.value
    g2 = GateState.from_task(t)
    assert g2.verify_state == VerifyState.PASSED
    assert "finish" in visible_tools(build_default_registry(), g2)


def test_visible_tools_accepts_specs_directly():
    reg = build_default_registry()
    specs = [reg.get(n) for n in reg.names()]
    g = GateState.from_task(_task())
    assert "apply_patch" not in visible_tools(specs, g)
