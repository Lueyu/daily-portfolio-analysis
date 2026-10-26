from agent_core.coder.models import AcceptanceCriterion, CheckKind
from agent_core.coder.prompts import reproduce_prompt


def ac():
    return [
        AcceptanceCriterion(
            id="ac1",
            description="Hold action must not contain buy verbs",
            check=CheckKind.UNIT,
            target="rating-rules",
        )
    ]


def test_reproduction_prompt_includes_guardrails():
    p_repro = reproduce_prompt("rating says Hold but action is buy", ac())
    assert "read_file" in p_repro
    assert "不得" in p_repro and "不能" in p_repro


def test_reproduction_prompt_never_promises_direct_commit():
    p = reproduce_prompt("p", ac())
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
