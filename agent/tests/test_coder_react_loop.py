from agent_core.coder.budget import BudgetGuard
from agent_core.coder.gates import GateState, VerifyState
from agent_core.coder.models import BudgetConfig, AcceptanceCriterion, CheckKind, DevTask
from agent_core.coder.parser import build_default_registry
from agent_core.coder.react_loop import ReactLoop, LoopSignal
from agent_core.models import ChatResponse, Usage, ToolCall


def make_task():
    return DevTask(
        id="d1", title="t", problem="p",
        acceptance=[AcceptanceCriterion(id="a", description="d", check=CheckKind.UNIT)],
        workdir=".",
    )


def tool_resp(*calls):
    return ChatResponse(
        content="", model="m", tier="flash", usage=Usage(), latency_ms=0,
        tool_calls=[ToolCall(id=f"c{i}", name=n, arguments=a)
                    for i, (n, a) in enumerate(calls)],
    )


def json_resp(action, **params):
    import json

    return ChatResponse(
        content=json.dumps({"action": action, "params": params}),
        model="m", tier="flash", usage=Usage(), latency_ms=0,
    )


class FakeChat:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []
        self.i = 0

    def chat(self, req):
        self.requests.append(req)
        response = self.responses[min(self.i, len(self.responses) - 1)]
        self.i += 1
        return response


class ScriptedExecutor:
    def __init__(self, *, red=True, patch_green=True):
        self.red = red
        self.patch_green = patch_green
        self.calls = []

    def initial_prompt(self):
        return "开始：先复现。"

    def execute(self, step, gate):
        kind = type(step).__name__
        self.calls.append(kind)
        if kind == "RunCheckStep":
            if not gate.red_seen:
                if self.red:
                    gate.record_red()
                    return _step_result("unit FAIL: 1 failed", made_progress=True)
                return _step_result("unit already passed")
            return _step_result("unit PASS")
        if kind == "ApplyPatchStep":
            gate.record_write()
            gate.begin_verify()
            gate.record_verify(self.patch_green)
            if self.patch_green:
                return _step_result("all checks PASS in sandbox", made_progress=True)
            return _step_result("unit still FAIL: detail", made_progress=True)
        if kind == "FinishStep":
            gate.finish_requested = True
            return _step_result("finishing", signal=LoopSignal.FINISH, reason=step.summary)
        if kind == "BlockedStep":
            return _step_result("blocked", signal=LoopSignal.BLOCKED, reason=step.reason)
        return _step_result(f"{kind} ok")


def _step_result(observation, *, signal=LoopSignal.CONTINUE, reason="", made_progress=False):
    from agent_core.coder.react_loop import StepResult
    return StepResult(observation, signal=signal, reason=reason, made_progress=made_progress)


def loop_for(chat, executor, gate=None, cfg=None, supports=True):
    return ReactLoop(
        task=make_task(), chat=chat, registry=build_default_registry(),
        executor=executor,
        budget=BudgetGuard(cfg or BudgetConfig()),
        supports_tools=supports, gate=gate or GateState(),
    )


def test_function_protocol_red_patch_finish():
    chat = FakeChat([
        tool_resp(("run_check", {"check": "unit"})),
        tool_resp(("apply_patch", {"diff": "--- a/x\n+++ b/x\n", "hypothesis": "h"})),
        tool_resp(("finish", {"summary": "done"})),
    ])
    executor = ScriptedExecutor(red=True, patch_green=True)
    gate = GateState()
    signal, _ = loop_for(chat, executor, gate=gate).run()
    assert signal == LoopSignal.FINISH
    assert gate.red_seen and gate.verify_state == VerifyState.PASSED.value
    first_tools = {tool["function"]["name"] for tool in chat.requests[0].tools}
    assert "apply_patch" not in first_tools and "finish" not in first_tools
    finish_tools = {tool["function"]["name"] for tool in chat.requests[2].tools}
    assert "finish" in finish_tools


def test_closed_gate_call_is_rejected_not_executed():
    chat = FakeChat([
        tool_resp(("apply_patch", {"diff": "--- a/x\n+++ b/x\n"})),
        tool_resp(("blocked", {"reason": "cannot reproduce"})),
    ])
    executor = ScriptedExecutor()
    signal, _ = loop_for(chat, executor).run()
    assert signal == LoopSignal.BLOCKED
    assert "ApplyPatchStep" not in executor.calls


def test_only_one_write_per_turn():
    chat = FakeChat([
        tool_resp(("run_check", {"check": "unit"})),
        tool_resp(
            ("apply_patch", {"diff": "--- a/x\n+++ b/x\n"}),
            ("apply_patch", {"diff": "--- a/y\n+++ b/y\n"}),
        ),
        tool_resp(("finish", {"summary": "done"})),
    ])
    executor = ScriptedExecutor()
    signal, _ = loop_for(chat, executor).run()
    assert signal == LoopSignal.FINISH
    assert executor.calls.count("ApplyPatchStep") == 1


def test_budget_exhausted_blocks():
    chat = FakeChat([tool_resp(("read_file", {"path": "a.ts"}))])
    executor = ScriptedExecutor()
    cfg = BudgetConfig(max_model_calls=2)
    signal, reason = loop_for(chat, executor, cfg=cfg).run()
    assert signal == LoopSignal.BLOCKED and "budget" in reason


def test_json_fallback_protocol_red_patch_finish():
    chat = FakeChat([
        json_resp("run_check", check="unit"),
        json_resp("apply_patch", diff="--- a/x\n+++ b/x\n", hypothesis="h"),
        json_resp("finish", summary="done"),
    ])
    executor = ScriptedExecutor(red=True, patch_green=True)
    gate = GateState()
    signal, _ = loop_for(chat, executor, gate=gate, supports=False).run()
    assert signal == LoopSignal.FINISH
    assert gate.verify_state == VerifyState.PASSED.value
    assert chat.requests[0].tools is None
    assert chat.requests[0].json_mode is True
    assert "read_file" in chat.requests[0].messages[-1]["content"]


def test_json_malformed_reply_is_reprompted():
    chat = FakeChat([
        ChatResponse(content="not json at all", model="m", tier="flash",
                     usage=Usage(), latency_ms=0),
        json_resp("blocked", reason="giving up"),
    ])
    executor = ScriptedExecutor()
    signal, _ = loop_for(chat, executor, supports=False).run()
    assert signal == LoopSignal.BLOCKED
    assert len(chat.requests) == 2
