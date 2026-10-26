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
        self.checks = []

    def initial_prompt(self):
        return "开始：先复现。"

    def execute(self, step, gate):
        kind = type(step).__name__
        self.calls.append(kind)
        if kind == "RunCheckStep":
            self.checks.append(step.kind)
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


def loop_for(chat, executor, gate=None, cfg=None, supports=True, max_probes=None):
    return ReactLoop(
        task=make_task(), chat=chat, registry=build_default_registry(),
        executor=executor,
        budget=BudgetGuard(cfg or BudgetConfig()),
        supports_tools=supports, gate=gate or GateState(), max_probes=max_probes,
    )


def test_running_user_input_and_current_memory_reach_next_model_request():
    executor = ScriptedExecutor()
    executor.external_inputs = lambda: ['用户追加：保留键盘支持']
    executor.context_brief = lambda: '当前计划：检查事件处理函数'
    chat = FakeChat([tool_resp(('blocked', {'reason': 'requires credentials'}))])
    loop_for(chat, executor).run()
    content = str(chat.requests[0].messages)
    assert '用户追加：保留键盘支持' in content
    assert '当前计划：检查事件处理函数' in content


def test_cancelled_child_does_not_make_another_model_call():
    executor = ScriptedExecutor()
    executor.should_stop = lambda: True
    chat = FakeChat([tool_resp(('blocked', {'reason': 'unused'}))])
    signal, reason = loop_for(chat, executor).run()
    assert signal == LoopSignal.BLOCKED
    assert 'cancel' in reason
    assert not chat.requests


def test_model_request_lifecycle_reports_failure_without_changing_exception():
    import pytest
    executor = ScriptedExecutor()
    states = []
    executor.model_request = lambda status, error=None: states.append((status, error))
    class OfflineChat:
        def chat(self, req):
            assert states == [('running', None)]
            raise TimeoutError('private provider payload')
    with pytest.raises(TimeoutError):
        loop_for(OfflineChat(), executor).run()
    assert [status for status, _ in states] == ['running', 'failed']


def test_model_request_lifecycle_clears_waiting_after_success():
    executor = ScriptedExecutor()
    states = []
    executor.model_request = lambda status, error=None: states.append(status)
    chat = FakeChat([tool_resp(('blocked', {'reason': 'needs service'}))])
    loop_for(chat, executor).run()
    assert states == ['running', 'idle']


def test_terminal_signal_completes_all_tool_call_pairs_before_persisting():
    executor = ScriptedExecutor()
    saved = []
    executor.save_context = lambda messages: saved.extend(messages)
    chat = FakeChat([tool_resp(("blocked", {"reason": "external unavailable"}), ("read_file", {"path": "x"}))])
    loop_for(chat, executor).run()
    calls = {c["id"] for m in saved for c in m.get("tool_calls", [])}
    results = {m["tool_call_id"] for m in saved if m["role"] == "tool"}
    assert calls == results
    assert executor.calls == ["BlockedStep"]


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


def test_default_loop_finishes_after_exceeding_old_limits():
    chat = FakeChat([
        *[tool_resp(("read_file", {"path": f"source-{i}.ts"})) for i in range(50)],
        tool_resp(("run_check", {"check": "unit"})),
        tool_resp(("apply_patch", {"diff": "--- a/x\n+++ b/x\n"})),
        tool_resp(("finish", {"summary": "done"})),
    ])
    loop = loop_for(chat, ScriptedExecutor())
    assert loop.run() == (LoopSignal.FINISH, "done")
    assert loop.budget.model_calls == 53
    assert loop.budget.iterations == 53


def test_explicit_probe_cap_still_blocks():
    chat = FakeChat([tool_resp(("read_file", {"path": "a.ts"}))])
    signal, reason = loop_for(chat, ScriptedExecutor(), max_probes=2).run()
    assert signal == LoopSignal.BLOCKED
    assert reason == "too many read-only probes without progress"
    assert len(chat.requests) == 3


def test_long_run_bounds_model_request_context_without_stopping_work():
    import json

    class LargeOutputExecutor(ScriptedExecutor):
        def execute(self, step, gate):
            if type(step).__name__ == "ReadFileStep":
                return _step_result("real file contents\n" + "内容" * 2900)
            return super().execute(step, gate)

    chat = FakeChat([
        *[tool_resp(("read_file", {"path": f"source-{i}.ts"})) for i in range(30)],
        tool_resp(("run_check", {"check": "unit"})),
        tool_resp(("apply_patch", {"diff": "--- a/x\n+++ b/x\n"})),
        tool_resp(("finish", {"summary": "done"})),
    ])
    assert loop_for(chat, LargeOutputExecutor()).run() == (LoopSignal.FINISH, "done")
    assert len(chat.requests) == 33
    assert max(len(json.dumps(request.messages, ensure_ascii=False).encode("utf-8"))
               for request in chat.requests) <= 96_000


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


def test_json_contract_tracks_gate_visibility_each_turn():
    chat = FakeChat([
        json_resp("run_check", check="unit"),
        json_resp("apply_patch", diff="--- a/x\n+++ b/x\n", hypothesis="h"),
        json_resp("finish", summary="done"),
    ])
    signal, _ = loop_for(chat, ScriptedExecutor(), supports=False).run()
    assert signal == LoopSignal.FINISH
    initial_contract = chat.requests[0].messages[-1]["content"]
    patch_contract = chat.requests[1].messages[-1]["content"]
    finish_contract = chat.requests[2].messages[-1]["content"]
    assert "apply_patch" not in initial_contract
    assert "apply_patch" in patch_contract and "finish" not in patch_contract
    assert "finish" in finish_contract


def test_repeated_unchanged_reads_run_acceptance_before_reporting_no_reproduction():
    chat = FakeChat([tool_resp(("read_file", {"path": "a.ts"}))])
    executor = ScriptedExecutor(red=False)
    loop = loop_for(chat, executor, cfg=BudgetConfig(max_model_calls=10))
    loop.task.acceptance = [
        AcceptanceCriterion(id="a", description="visible", check=CheckKind.E2E),
        AcceptanceCriterion(id="b", description="readable", check=CheckKind.E2E),
    ]
    signal, reason = loop.run()
    assert signal == LoopSignal.BLOCKED
    assert "配置的复现检查均通过" in reason and "未修改代码" in reason
    assert executor.calls == ["ReadFileStep"] * 3 + ["RunCheckStep"]
    assert executor.checks == [CheckKind.E2E]
    assert len(chat.requests) == 3
    assert loop.budget.iterations == 4
    assert not loop.gate.red_seen and loop.gate.verify_state == VerifyState.NONE


def test_repeated_reads_with_new_content_do_not_trigger_reproduction_recovery():
    class ChangingExecutor(ScriptedExecutor):
        def execute(self, step, gate):
            result = super().execute(step, gate)
            if type(step).__name__ == "ReadFileStep":
                result.observation += str(len(self.calls))
            return result

    chat = FakeChat([
        *[tool_resp(("read_file", {"path": "a.ts"})) for _ in range(12)],
        tool_resp(("blocked", {"reason": "missing target fixture"})),
    ])
    executor = ChangingExecutor(red=False)
    assert loop_for(chat, executor).run() == (LoopSignal.BLOCKED, "missing target fixture")
    assert "RunCheckStep" not in executor.calls


def test_reproduction_recovery_with_red_evidence_continues_to_patch():
    chat = FakeChat([
        *[tool_resp(("read_file", {"path": "a.ts"})) for _ in range(3)],
        tool_resp(("apply_patch", {"diff": "--- a/x\n+++ b/x\n"})),
        tool_resp(("finish", {"summary": "done"})),
    ])
    executor = ScriptedExecutor(red=True)
    loop = loop_for(chat, executor, cfg=BudgetConfig(max_model_calls=8))
    assert loop.run() == (LoopSignal.FINISH, "done")
    assert executor.calls == ["ReadFileStep"] * 3 + ["RunCheckStep", "ApplyPatchStep", "FinishStep"]
    forced_tools = {tool["function"]["name"] for tool in chat.requests[3].tools}
    assert forced_tools == {"run_check", "apply_patch", "blocked"}
    assert "read_file" in {tool["function"]["name"] for tool in chat.requests[4].tools}


def test_existing_red_stall_forces_decision_without_terminating_task():
    chat = FakeChat([
        *[tool_resp(("read_file", {"path": "a.ts"})) for _ in range(3)],
        tool_resp(("read_file", {"path": "a.ts"})),  # ignores the temporary capability restriction
        tool_resp(("apply_patch", {"diff": "--- a/x\n+++ b/x\n"})),
        tool_resp(("finish", {"summary": "done"})),
    ])
    executor = ScriptedExecutor()
    loop = loop_for(chat, executor, gate=GateState(red_seen=True))
    assert loop.run() == (LoopSignal.FINISH, "done")
    assert executor.calls.count("ReadFileStep") == 3
    for request in chat.requests[3:5]:
        assert "read_file" not in {tool["function"]["name"] for tool in request.tools}


def test_json_repeated_reads_also_run_checks_before_no_reproduction_exit():
    chat = FakeChat([json_resp("read_file", path="a.ts")])
    executor = ScriptedExecutor(red=False)
    loop = loop_for(chat, executor, cfg=BudgetConfig(max_model_calls=10), supports=False)
    signal, reason = loop.run()
    assert signal == LoopSignal.BLOCKED and "配置的复现检查均通过" in reason
    assert executor.calls.count("RunCheckStep") == 1


def test_recovery_does_not_exceed_an_explicit_action_cap():
    chat = FakeChat([tool_resp(("read_file", {"path": "a.ts"}))])
    executor = ScriptedExecutor(red=False)
    loop = loop_for(chat, executor, cfg=BudgetConfig(max_iterations=3))
    assert loop.run() == (LoopSignal.BLOCKED, "iteration budget reached")
    assert "RunCheckStep" not in executor.calls


def test_recovery_checks_all_distinct_acceptance_kinds_until_it_observes_red():
    class SecondCheckFails(ScriptedExecutor):
        def execute(self, step, gate):
            if type(step).__name__ == "RunCheckStep":
                self.red = step.kind == CheckKind.E2E
            return super().execute(step, gate)

    chat = FakeChat([
        *[tool_resp(("read_file", {"path": "a.ts"})) for _ in range(3)],
        tool_resp(("apply_patch", {"diff": "--- a/x\n+++ b/x\n"})),
        tool_resp(("finish", {"summary": "done"})),
    ])
    executor = SecondCheckFails(red=False)
    loop = loop_for(chat, executor)
    loop.task.acceptance = [
        AcceptanceCriterion(id="a", description="unit", check=CheckKind.UNIT),
        AcceptanceCriterion(id="b", description="e2e", check=CheckKind.E2E),
    ]
    assert loop.run() == (LoopSignal.FINISH, "done")
    assert executor.checks == [CheckKind.UNIT, CheckKind.E2E]


def test_repeated_probe_arguments_are_compared_after_validation():
    chat = FakeChat([
        tool_resp(("read_file", {"path": "a.ts"})),
        tool_resp(("read_file", {"path": " a.ts "})),
        tool_resp(("read_file", {"path": "a.ts"})),
        tool_resp(("blocked", {"reason": "fallback"})),
    ])
    executor = ScriptedExecutor(red=False)
    signal, reason = loop_for(chat, executor).run()
    assert signal == LoopSignal.BLOCKED and "配置的复现检查均通过" in reason
    assert executor.calls.count("RunCheckStep") == 1
    assert len(chat.requests) == 3


def test_different_arguments_are_distinct_even_when_content_is_the_same():
    chat = FakeChat([
        *[tool_resp(("read_file", {"path": f"file-{i}.ts"})) for i in range(8)],
        tool_resp(("blocked", {"reason": "needs acceptance details"})),
    ])
    executor = ScriptedExecutor(red=False)
    assert loop_for(chat, executor).run() == (LoopSignal.BLOCKED, "needs acceptance details")
    assert executor.checks == []


def test_recovery_waits_for_all_native_results_before_injecting_check_feedback():
    chat = FakeChat([
        tool_resp(("list_dir", {"path": "."})),
        tool_resp(("read_file", {"path": "a.ts"})),
        tool_resp(("read_file", {"path": "a.ts"})),
        tool_resp(("read_file", {"path": "a.ts"}), ("list_dir", {"path": "."})),
        tool_resp(("apply_patch", {"diff": "--- a/x\n+++ b/x\n"})),
        tool_resp(("finish", {"summary": "done"})),
    ])
    assert loop_for(chat, ScriptedExecutor()).run() == (LoopSignal.FINISH, "done")
    messages = chat.requests[4].messages
    multi_index = next(i for i, msg in enumerate(messages) if len(msg.get("tool_calls", [])) == 2)
    assert [msg["role"] for msg in messages[multi_index:multi_index + 4]] == [
        "assistant", "tool", "tool", "user",
    ]


def test_new_red_evidence_resets_old_repeat_history():
    chat = FakeChat([
        tool_resp(("read_file", {"path": "a.ts"})),
        tool_resp(("read_file", {"path": "a.ts"})),
        tool_resp(("run_check", {"check": "unit"})),
        tool_resp(("read_file", {"path": "a.ts"})),
        tool_resp(("apply_patch", {"diff": "--- a/x\n+++ b/x\n"})),
        tool_resp(("finish", {"summary": "done"})),
    ])
    executor = ScriptedExecutor()
    assert loop_for(chat, executor).run() == (LoopSignal.FINISH, "done")
    assert executor.checks == [CheckKind.UNIT]
    assert "read_file" in {tool["function"]["name"] for tool in chat.requests[4].tools}


def test_new_files_between_repeated_reads_reset_stall_evidence():
    chat = FakeChat([
        *[tool_resp(("read_file", {"path": path}))
          for path in ["a.ts", "new-b.ts", "a.ts", "new-c.ts", "a.ts"]],
        tool_resp(("blocked", {"reason": "need missing fixture"})),
    ])
    executor = ScriptedExecutor(red=False)
    assert loop_for(chat, executor).run() == (LoopSignal.BLOCKED, "need missing fixture")
    assert executor.checks == []
    assert len(chat.requests) == 6


def test_new_evidence_later_in_native_batch_cancels_pending_stall_recovery():
    chat = FakeChat([
        tool_resp(("read_file", {"path": "a.ts"})),
        tool_resp(("read_file", {"path": "a.ts"})),
        tool_resp(("read_file", {"path": "a.ts"}), ("read_file", {"path": "new-b.ts"})),
        tool_resp(("blocked", {"reason": "need missing fixture"})),
    ])
    executor = ScriptedExecutor(red=False)
    assert loop_for(chat, executor).run() == (LoopSignal.BLOCKED, "need missing fixture")
    assert executor.checks == []
    assert executor.calls.count("ReadFileStep") == 4


def test_alternating_known_unchanged_files_still_trigger_stall_recovery():
    chat = FakeChat([
        *[tool_resp(("read_file", {"path": path}))
          for path in ["a.ts", "b.ts", "a.ts", "b.ts", "a.ts", "b.ts"]],
        tool_resp(("blocked", {"reason": "fallback"})),
    ])
    executor = ScriptedExecutor(red=False)
    signal, reason = loop_for(chat, executor).run()
    assert signal == LoopSignal.BLOCKED and "配置的复现检查均通过" in reason
    assert executor.checks == [CheckKind.UNIT]
    assert len(chat.requests) == 6


def test_changed_file_content_resets_other_probe_repeat_counts():
    class ChangedFileExecutor(ScriptedExecutor):
        def __init__(self):
            super().__init__(red=False)
            self.version = 0

        def execute(self, step, gate):
            result = super().execute(step, gate)
            if type(step).__name__ == "ReadFileStep" and step.path == "b.ts":
                self.version += 1
                result.observation += f" version {self.version}"
            return result

    chat = FakeChat([
        *[tool_resp(("read_file", {"path": path}))
          for path in ["b.ts", "a.ts", "a.ts", "b.ts", "a.ts"]],
        tool_resp(("blocked", {"reason": "need missing fixture"})),
    ])
    executor = ChangedFileExecutor()
    assert loop_for(chat, executor).run() == (LoopSignal.BLOCKED, "need missing fixture")
    assert executor.checks == []
