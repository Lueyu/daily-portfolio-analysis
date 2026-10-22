from agent_core.coder.models import AcceptanceCriterion, CheckKind
from agent_core.coder.prompts import (
    diagnose_prompt,
    reproduce_prompt,
    verify_prompt,
)


def ac():
    return [
        AcceptanceCriterion(
            id="ac1",
            description="Hold action must not contain buy verbs",
            check=CheckKind.UNIT,
            target="rating-rules",
        )
    ]


def test_phase_prompts_include_guardrails():
    p_repro = reproduce_prompt("rating says Hold but action is buy", ac())
    p_diag = diagnose_prompt("red", ["git diff"])
    assert "read_file" in p_repro
    assert "apply_patch" in p_diag
    assert "不得" in p_repro and "不能" in p_repro


def test_verify_prompt_includes_acceptance():
    v = verify_prompt(ac())
    assert "ac1" in v
    assert "test:unit" in v


def test_prompts_never_promise_direct_commit():
    for p in (
        reproduce_prompt("p", ac()),
        diagnose_prompt("red", []),
        verify_prompt(ac()),
    ):
        assert "git commit" not in p
        assert "git push" not in p


def test_react_system_prompt_mentions_reproduction_and_gates():
    from agent_core.coder.prompts import react_system_prompt

    msg = react_system_prompt("the bug", ac())
    assert "复现" in msg
    assert "run_check" in msg and "apply_patch" in msg
    assert "人工" in msg or "提交" in msg


def test_json_contract_lists_only_visible_tools():
    from agent_core.coder.prompts import json_tools_contract
    from agent_core.coder.gates import GateState, visible_tools
    from agent_core.coder.parser import build_default_registry

    reg = build_default_registry()
    contract = json_tools_contract(visible_tools(reg, GateState()))
    assert "read_file" in contract and "run_check" in contract
    assert "apply_patch" not in contract and "finish" not in contract
