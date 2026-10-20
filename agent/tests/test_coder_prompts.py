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
