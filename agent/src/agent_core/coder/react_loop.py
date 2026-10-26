"""Capability-gated ReAct orchestration for the coder persona.

The loop owns model turns, protocol handling, action validation and feedback.
An injected executor owns all effects such as sandbox access and verification.
"""

from __future__ import annotations

import json
from hashlib import sha256
from dataclasses import dataclass, field
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
    PAUSED = "paused"


@dataclass
class StepResult:
    observation: str
    signal: str = LoopSignal.CONTINUE
    reason: str = ""
    made_progress: bool = False
    action: str = ""
    images: list[dict[str, str]] = field(default_factory=list)
    # Executors can identify read-only evidence produced by an execution tool
    # without including volatile session/checkpoint IDs in its fingerprint.
    probe_key: str = ""
    probe_observation: str = ""


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
        max_probes: int | None = None,
    ):
        self.task = task
        self.chat = chat
        self.registry = registry
        self.executor = executor
        self.budget = budget
        self.supports_tools = supports_tools
        self.gate = gate
        self.max_probes = max_probes
        # The tool-step budget can be tighter than the probe cap. Warn early
        # enough that the model gets another turn to act on the warning.
        warning_thresholds = [8]
        if max_probes is not None:
            warning_thresholds.append(max_probes - 2)
        for limit in (budget.config.max_iterations, budget.config.max_model_calls):
            if limit is not None:
                warning_thresholds.append(limit - 1)
        self.probe_warning = max(1, min(warning_thresholds))
        self._probes = 0
        self._probe_evidence: dict[str, str] = {}
        self._probe_repeats: dict[str, int] = {}
        self._force_decision = False
        self._exploration_reads = 0
        self._last_exploration_reminder = 0

    def run(self) -> tuple[str, str]:
        pad = Scratchpad(
            getattr(self.executor, "system_prompt", None) or react_system_prompt(self.task.problem, self.task.acceptance),
            self.executor.initial_prompt(),
            max_context_bytes=getattr(self.executor, "context_bytes", 96000),
        )
        restore = getattr(self.executor, "load_context", None)
        saved = restore() if restore else None
        if isinstance(saved, list) and len(saved) >= 2:
            # Only completed turns are persisted. Keep fresh instructions and
            # actual resumed workspace state ahead of historical evidence.
            pad.restore(saved)
        self._restore_exploration(saved)
        while True:
            should_stop = getattr(self.executor, "should_stop", None)
            if should_stop and should_stop():
                return LoopSignal.BLOCKED, "task cancelled"
            inbox = getattr(self.executor, "external_inputs", None)
            for message in inbox() if inbox else []:
                pad.user_input(message)
            tripped, reason = self.budget.exhausted()
            if tripped:
                return LoopSignal.BLOCKED, reason

            visible_names = visible_tools(self.registry, self.gate)
            if self._execution_focus():
                exploratory = {'read_file', 'list_dir', 'grep', 'glob', 'skills_list', 'skill_read', 'mcp_tools'}
                visible_names = [name for name in visible_names if name not in exploratory]
            if self._force_decision:
                visible_names = [name for name in visible_names
                                 if self.registry.get(name).kind != ToolKind.READ_ONLY]
            visible_specs = [self.registry.get(name) for name in visible_names]
            pending = self._request_calls(pad, visible_specs)
            if isinstance(pending, str):
                pad.observation(pending)
                continue

            signal, reason = self._execute_turn(
                pad, pending, allowed_names=set(visible_names))
            persist = getattr(self.executor, "save_context", None)
            save_exploration = getattr(self.executor, 'save_exploration', None)
            if save_exploration:
                save_exploration(self._exploration_reads, self._last_exploration_reminder)
            if persist:
                persist(pad.messages)
            if signal != LoopSignal.CONTINUE:
                return signal, reason

    def _request_calls(
        self, pad: Scratchpad, visible_specs: list
    ) -> list[_Pending] | str:
        pad.compact()
        self.budget.tick_model_call()
        messages = list(pad.messages)
        context = getattr(self.executor, "context_brief", None)
        if context:
            messages.append({"role": "user", "content": context()})
        if (getattr(self.executor, 'general_mode', False)
                and (self._execution_focus() or self._exploration_reads - self._last_exploration_reminder >= 12)):
            # This advisory lives only in this request, never accumulates in
            # persisted context. Focus restricts broad exploration temporarily,
            # never forces a write or stops the task after a total number of steps.
            self._last_exploration_reminder = self._exploration_reads
            advice = (
                '已连续进行多次只读探索，尚未实际运行验证。请先report_progress总结已有证据和待验证假设，'
                '再选择最小启动命令、目标测试或浏览器交互验证；必要时按证据修改。'
                '若仍需读取，只读能区分当前假设的关键位置，不要无限扩大文件阅读。')
            if self._execution_focus():
                advice += ('当前暂时聚焦验证假设，已收起广泛文件探索工具。请运行最小诊断命令、测试或浏览器操作；'
                           '不要求写代码或结束任务。一次实际执行后会恢复读取，执行失败也可以恢复读取来排错。'
                           '只发布进度、计划和记忆不会解除聚焦。')
            else:
                advice += '所有工具仍可用，不要求结束任务。'
            messages.append({'role': 'user', 'name': 'execution_guidance', 'content': advice})
        if self.supports_tools:
            response = self._chat(ChatRequest(
                messages=messages,
                task=ModelTask.CODE,
                tools=openai_tools_payload(visible_specs),
                tool_choice="auto",
            ))
            record = getattr(self.executor, "record_model", None)
            if record:
                record(response)
            calls = response.tool_calls or []
            if not calls:
                pad.assistant_text(response.content, continuation=response.private_continuation)
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
                continuation=response.private_continuation,
            )
            return [
                _Pending(call.id, call.name, call.arguments)
                for call in calls
            ]

        response = self._chat(ChatRequest(
            messages=messages + [{
                "role": "system",
                "content": json_tools_contract(visible_specs),
            }],
            task=ModelTask.CODE,
            json_mode=True,
        ))
        record = getattr(self.executor, "record_model", None)
        if record:
            record(response)
        pad.assistant_text(response.content, continuation=response.private_continuation)
        try:
            name, arguments = self.registry.parse_action(response.content)
        except ValueError as exc:
            return f"你的回复不是合法 JSON 动作（{exc}），请只重发一个 JSON 对象。"
        return [_Pending(None, name, arguments)]

    def _chat(self, request):
        observe = getattr(self.executor, 'model_request', None)
        if observe:
            observe('running')
        try:
            response = self.chat.chat(request)
        except Exception as exc:
            if observe:
                observe('failed', error=exc)
            raise
        if observe:
            observe('idle')
        return response

    def _execution_focus(self):
        return getattr(self.executor, 'general_mode', False) and self._exploration_reads >= 24

    def _count_exploration(self, name):
        if not getattr(self.executor, 'general_mode', False):
            return
        try:
            kind = self.registry.get(name).kind
        except ValueError:
            return
        if kind == ToolKind.READ_ONLY:
            self._exploration_reads += 1
        elif name not in {'report_progress', 'update_plan', 'remember'}:
            self._exploration_reads = 0
            self._last_exploration_reminder = 0

    def _restore_exploration(self, saved):
        if not getattr(self.executor, 'general_mode', False):
            return
        stored = getattr(self.executor, 'state', {}).get('exploration')
        if isinstance(stored, dict):
            self._exploration_reads = max(0, int(stored.get('reads', 0)))
            self._last_exploration_reminder = max(0, int(stored.get('lastReminder', 0)))
            return
        # Older tasks have a conversation but no counter. Recover completed tool
        # turns so restarting does not buy another unlimited exploration phase.
        for message in saved or []:
            if message.get('role') != 'assistant':
                continue
            for call in message.get('tool_calls', []):
                self._count_exploration(call.get('function', {}).get('name', ''))
            if not self.supports_tools:
                try:
                    name, _ = self.registry.parse_action(message.get('content', ''))
                    self._count_exploration(name)
                except ValueError:
                    pass

    def _execute_turn(
        self,
        pad: Scratchpad,
        pending: list[_Pending],
        *,
        allowed_names: set[str],
    ) -> tuple[str, str]:
        did_write = False
        stalled = False
        images = []
        terminal = None
        for call in pending:
            if terminal:
                self._feedback(pad, call, "未执行：同批次已有 finish/blocked 结束信号。")
                continue
            should_stop = getattr(self.executor, "should_stop", None)
            if should_stop and should_stop():
                self._feedback(pad, call, "未执行：任务已取消。")
                terminal = (LoopSignal.BLOCKED, "task cancelled")
                continue
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
            self._count_exploration(call.name)
            images.extend(result.images)
            if spec.kind == ToolKind.PATCH:
                did_write = True
            if spec.kind == ToolKind.READ_ONLY or result.probe_key:
                # Fingerprint the actual result before adding guidance text.
                repeated, new_evidence = self._repeated_probe(
                    call.name, step, result.probe_observation if result.probe_key else result.observation,
                    key=result.probe_key or None)
                stalled = False if new_evidence else stalled or repeated
                self._count_probe(result)
            else:
                self._force_decision = False
            if result.made_progress:
                self._probes = 0
                self._probe_evidence.clear()
                self._probe_repeats.clear()
                stalled = False

            self._feedback(pad, call, result.observation)
            self.budget.tick_iteration()

            if result.signal in (LoopSignal.FINISH, LoopSignal.BLOCKED, LoopSignal.PAUSED):
                terminal = (result.signal, result.reason)
        for item in images:
            pad.image_observation(item["data_url"], item["label"])
        if terminal:
            return terminal
        if stalled:
            return self._recover_repeated_probes(pad)
        return LoopSignal.CONTINUE, ""

    def _repeated_probe(self, name: str, step, observation: str, *, key: str | None = None) -> tuple[bool, bool]:
        key = key or name + ":" + json.dumps(
            step.model_dump(mode="json"), sort_keys=True, ensure_ascii=False)
        digest = sha256(observation.encode("utf-8")).hexdigest()
        new_evidence = self._probe_evidence.get(key) != digest
        if new_evidence:
            # Comparing known files while discovering new ones is productive.
            # Only accumulate repeats after the latest genuinely new result.
            self._probe_repeats.clear()
        self._probe_evidence[key] = digest
        count = self._probe_repeats.get(key, 0) + 1
        self._probe_repeats[key] = count
        return count >= 3, new_evidence

    def _recover_repeated_probes(self, pad: Scratchpad) -> tuple[str, str]:
        """Turn repeated unchanged evidence into checks, never a time/count cap.

        Checks run only after all model tool calls have matching results. A
        newly observed red opens patching; green checks report inability to
        reproduce, not successful completion of the user's acceptance criteria.
        """
        if getattr(self.executor, "general_mode", False):
            self._force_decision = True
            self._probe_repeats.clear()
            pad.observation("重复操作返回相同内容，没有新增证据。不要重跑同一读取或失败命令；改用不同复现路径、浏览器/日志定位，或根据证据修改并验证。")
            return LoopSignal.CONTINUE, ""
        pad.observation(
            "检测到重复读取相同内容，未得到新证据。程序现在运行配置的复现检查。")
        checks = list(dict.fromkeys(c.check.value for c in self.task.acceptance)) or ["unit"]
        had_red = self.gate.red_seen
        for check in checks:
            tripped, reason = self.budget.exhausted()
            if tripped:
                return LoopSignal.BLOCKED, reason
            step = self.registry.validate("run_check", {"check": check})
            result = self.executor.execute(step, self.gate)
            self.budget.tick_iteration()
            pad.observation(f"程序触发的 run_check {check}：\n{result.observation}")
            if result.signal != LoopSignal.CONTINUE:
                return result.signal, result.reason
            if not had_red and self.gate.red_seen:
                break

        self._probe_evidence.clear()
        self._probe_repeats.clear()
        self._probes = 0
        if not self.gate.red_seen:
            return LoopSignal.BLOCKED, (
                "配置的复现检查均通过，无法复现报告的问题，当前代码可能已修复。"
                "需要提供能失败的用例或补充复现步骤；未修改代码。"
                "检查通过不等于已证明所有验收条件满足。"
            )
        self._force_decision = True
        pad.observation(
            "已经取得失败证据。下一步只开放修复补丁、检查和说明受阻的工具，"
            "请基于已有证据提出修复或明确缺少的条件，不能继续重复读取。")
        return LoopSignal.CONTINUE, ""

    def _feedback(self, pad: Scratchpad, call: _Pending, text: str) -> None:
        if self.supports_tools and call.call_id is not None:
            pad.tool_result(call.call_id, call.name, text)
        else:
            pad.observation(text, action=call.name)

    def _count_probe(self, result: StepResult) -> None:
        self._probes += 1
        if self.max_probes is not None and self._probes > self.max_probes:
            result.signal = LoopSignal.BLOCKED
            result.reason = "too many read-only probes without progress"
        elif self._probes >= self.probe_warning:
            if getattr(self.executor, "general_mode", False):
                # General mode gets one bounded request-local advisory after
                # each 12 reads instead of repeating a suffix on every result.
                return
            result.observation += (
                "\n[PROBE BUDGET WARNING] 已做大量只读探查。请根据已有证据调整方法，"
                "优先 run_check 复现；只有确认真实阻碍时才用 blocked 说明缺少的服务/数据。"
            )

    def _closed_message(self, name: str) -> str:
        if getattr(self.executor, 'general_mode', False):
            if name == 'finish' and hasattr(self.executor, 'finish_guidance'):
                return self.executor.finish_guidance()
            return f'工具 {name} 当前不可用。请检查当前任务状态与能力；没有先用补丁工具的要求。'
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
