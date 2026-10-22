"""Capability-gated ReAct orchestration for the coder persona.

The loop owns model turns, protocol handling, action validation and feedback.
An injected executor owns all effects such as sandbox access and verification.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol

from ..models import ChatRequest, ModelTask
from .budget import BudgetGuard
from .gates import GateState, visible_tools
from .prompts import json_tools_contract, react_system_prompt
from .registry import ToolKind, ToolRegistry
from .scratchpad import Scratchpad
from .tool_schema import openai_tools_payload


class LoopSignal:
    CONTINUE = "continue"
    FINISH = "finish"
    BLOCKED = "blocked"


@dataclass
class StepResult:
    observation: str
    signal: str = LoopSignal.CONTINUE
    reason: str = ""
    made_progress: bool = False
    action: str = ""


class ToolExecutor(Protocol):
    """Harness interface for executing one validated action."""

    def initial_prompt(self) -> str: ...

    def execute(self, step, gate: GateState) -> StepResult: ...


@dataclass
class _Pending:
    call_id: str | None
    name: str
    arguments: dict


class ReactLoop:
    def __init__(
        self,
        *,
        task,
        chat,
        registry: ToolRegistry,
        executor: ToolExecutor,
        budget: BudgetGuard,
        supports_tools: bool,
        gate: GateState,
        max_probes: int = 10,
    ):
        self.task = task
        self.chat = chat
        self.registry = registry
        self.executor = executor
        self.budget = budget
        self.supports_tools = supports_tools
        self.gate = gate
        self.max_probes = max_probes
        self.probe_warning = max(1, max_probes - 2)
        self._probes = 0

    def run(self) -> tuple[str, str]:
        pad = Scratchpad(
            react_system_prompt(self.task.problem, self.task.acceptance),
            self.executor.initial_prompt(),
        )
        while True:
            tripped, reason = self.budget.exhausted()
            if tripped:
                return LoopSignal.BLOCKED, reason

            visible_names = visible_tools(self.registry, self.gate)
            visible_specs = [self.registry.get(name) for name in visible_names]
            pending = self._request_calls(pad, visible_specs)
            if isinstance(pending, str):
                pad.observation(pending)
                continue

            signal, reason = self._execute_turn(
                pad, pending, allowed_names=set(visible_names))
            if signal != LoopSignal.CONTINUE:
                return signal, reason

    def _request_calls(
        self, pad: Scratchpad, visible_specs: list
    ) -> list[_Pending] | str:
        self.budget.tick_model_call()
        if self.supports_tools:
            response = self.chat.chat(ChatRequest(
                messages=pad.messages,
                task=ModelTask.CODE,
                tools=openai_tools_payload(visible_specs),
                tool_choice="auto",
            ))
            calls = response.tool_calls or []
            if not calls:
                pad.assistant_text(response.content)
                return "你必须调用一个工具（或 blocked/finish），不要只回复文字。"

            pad.assistant_tool_calls(
                response.content,
                [{
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": json.dumps(call.arguments, ensure_ascii=False),
                    },
                } for call in calls],
            )
            return [
                _Pending(call.id, call.name, call.arguments)
                for call in calls
            ]

        response = self.chat.chat(ChatRequest(
            messages=pad.messages + [{
                "role": "system",
                "content": json_tools_contract(visible_specs),
            }],
            task=ModelTask.CODE,
            json_mode=True,
        ))
        pad.assistant_text(response.content)
        try:
            name, arguments = self.registry.parse_action(response.content)
        except ValueError as exc:
            return f"你的回复不是合法 JSON 动作（{exc}），请只重发一个 JSON 对象。"
        return [_Pending(None, name, arguments)]

    def _execute_turn(
        self,
        pad: Scratchpad,
        pending: list[_Pending],
        *,
        allowed_names: set[str],
    ) -> tuple[str, str]:
        did_write = False
        for call in pending:
            try:
                spec = self.registry.get(call.name)
            except ValueError as exc:
                self._feedback(pad, call, f"未知工具：{exc}")
                continue

            # Enforce the exact capability set sent with this model request.
            # A prior call in a multi-call response must not unlock a hidden
            # tool midway through the same response.
            if call.name not in allowed_names or not self.gate.is_visible(spec.gate):
                self._feedback(pad, call, self._closed_message(spec.name))
                continue
            if spec.kind == ToolKind.PATCH and did_write:
                self._feedback(
                    pad, call,
                    "一轮只允许一个写操作，其余写操作请下一轮再提交。",
                )
                continue
            if not isinstance(call.arguments, dict):
                self._feedback(pad, call, "工具参数必须是 JSON 对象。")
                continue
            try:
                step = self.registry.validate(call.name, call.arguments)
            except ValueError as exc:
                self._feedback(pad, call, f"工具参数不合法：{exc}")
                continue

            result = self.executor.execute(step, self.gate)
            if spec.kind == ToolKind.PATCH:
                did_write = True
            if spec.kind == ToolKind.READ_ONLY:
                self._count_probe(result)
            elif result.made_progress:
                self._probes = 0

            self._feedback(pad, call, result.observation)
            self.budget.tick_iteration()

            if result.signal == LoopSignal.FINISH:
                return LoopSignal.FINISH, result.reason
            if result.signal == LoopSignal.BLOCKED:
                return LoopSignal.BLOCKED, result.reason
        return LoopSignal.CONTINUE, ""

    def _feedback(self, pad: Scratchpad, call: _Pending, text: str) -> None:
        if self.supports_tools and call.call_id is not None:
            pad.tool_result(call.call_id, call.name, text)
        else:
            pad.observation(text)

    def _count_probe(self, result: StepResult) -> None:
        self._probes += 1
        if self._probes > self.max_probes:
            result.signal = LoopSignal.BLOCKED
            result.reason = "too many read-only probes without progress"
        elif self._probes >= self.probe_warning:
            result.observation += (
                "\n[PROBE BUDGET WARNING] 已做大量只读探查但没有进展。下一步必须 "
                "run_check 复现，或 blocked 说明需要人工启动的服务/数据。"
            )

    def _closed_message(self, name: str) -> str:
        if name == "apply_patch":
            return (
                "apply_patch 尚未开放：必须先 run_check 看到一个失败的测试（红灯）。"
                "请先复现。"
            )
        if name == "finish":
            return (
                "finish 尚未开放：必须先 apply_patch 且沙箱验收检查全部通过。"
                "请先修复并等待检查结果。"
            )
        return f"工具 {name} 当前不可用。"
