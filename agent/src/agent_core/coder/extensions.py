"""Optional capabilities composed into GeneralHarness without bypassing its journal."""
from __future__ import annotations

import json

from .extension_tools import (
    AgentCancel, AgentDiff, AgentList, AgentMerge, AgentPoll, AgentSpawn, Capabilities,
    InspectImage, InspectLocalApp, McpCall, McpTools, Remember, ReportProgress, SkillRead, SkillsList, UpdatePlan,
)
from .react_loop import LoopSignal, StepResult
from .session_control import SessionControl
from .extension_activity import extension_summary


class AgentExtensions:
    def __init__(self, harness, settings=None, integrations=None, worker_depth=0):
        self.h = harness
        self.settings = settings
        self.integrations = integrations
        self.depth = worker_depth
        self.control = SessionControl(harness.state_dir / 'control')
        self._workers = None
        self._recoveries = {}
        self._delivered_message_ids = set()

    def _integrations(self):
        if self.integrations is None:
            if self.settings is None:
                raise ValueError('Integrations require operator configuration')
            from .integrations import IntegrationManager
            self.integrations = IntegrationManager(self.settings, self.h.trusted_project_root,
                                                   forbidden_roots=[self.h.workspace])
        return self.integrations

    def capabilities(self):
        models = getattr(self.h.chat, 'coding_capabilities', lambda: {})()
        policy = getattr(self.h.runtime, 'network_policy', None)
        integrations = self._integrations().capabilities() if self.settings is not None else {}
        return {'sandbox': True, 'models': models, 'integrations': integrations,
                'network': policy.as_dict() if policy else {'mode': 'offline', 'allowed_hosts': []},
                'workers': {'maxConcurrency': getattr(self.settings, 'coder_max_workers', 3),
                            'maxDepth': getattr(self.settings, 'coder_max_worker_depth', 1),
                            'depth': self.depth, 'isolation': 'independent_source_copy'},
                'mcp': {'configured': bool(getattr(self.settings, 'coder_mcp_config', None)),
                        'transport': 'streamable_http', 'externalWritesRequireApproval': True},
                'localInspection': {'available': self.depth == 0 and self.settings is not None,
                                    'scope': 'host_main', 'readOnly': True,
                                    'countsAsVerification': False},
                'contextBytes': self.h.context_bytes, 'tools': self.h.registry.names()}

    def undelivered_inputs(self):
        return self.control.messages([
            *self.h.state.get('acknowledged_messages', []), *self._delivered_message_ids])

    def external_inputs(self):
        rows = self.undelivered_inputs()
        if not rows:
            return []
        # Keep audit text once per immutable inbox record, including a replay
        # after delivery succeeded but conversation persistence did not.
        recorded = self.h.state.setdefault('feedback_message_ids', [])
        new_rows = [row for row in rows if row['id'] not in recorded]
        recorded.extend(row['id'] for row in new_rows)
        self.h.state.setdefault('user_feedback', []).extend(row['text'] for row in new_rows)
        self.h._invalidate()
        self.h._sync_gate()
        self.h._save()
        for row in new_rows:
            self.h.evidence.event('user_message', row['text'][:240], row)
        # Delivery is only local until save_context writes the conversation.
        self._delivered_message_ids.update(row['id'] for row in rows)
        return [row['text'] for row in rows]

    def acknowledge_inputs(self):
        """Called only after the conversation containing delivered input is durable."""
        if not self._delivered_message_ids:
            return
        previous = self.h.state.get('acknowledged_messages')
        self.h.state['acknowledged_messages'] = list(dict.fromkeys([
            *(previous or []), *sorted(self._delivered_message_ids)]))
        try:
            self.h._save()
        except Exception:
            if previous is None:
                self.h.state.pop('acknowledged_messages', None)
            else:
                self.h.state['acknowledged_messages'] = previous
            raise
        self._delivered_message_ids.clear()

    def context_brief(self):
        state = self.h.state
        current = {key: state.get(key) for key in ('revision', 'plan', 'memory', 'waiting_for')}
        current['completion_requirements'] = self.h.verification_gaps()
        current['verification'] = [{key: item.get(key) for key in
            ('scope', 'criterion_ids', 'revision', 'passed', 'invalidated')}
            for item in state.get('verification', [])[-12:]]
        current['workers'] = self._workers.list() if self._workers else state.get('workers', [])
        return '当前控制面状态（计划与记忆是工作记录，验收仍以实际命令为准）：\n' + json.dumps(current, ensure_ascii=False)[:22000]

    def workers(self):
        if self._workers is None:
            from .workers import WorkerManager
            self._workers = WorkerManager(
                self.h.journal, self.h.state_dir / 'workers', self._run_worker,
                max_workers=getattr(self.settings, 'coder_max_workers', 3), depth=self.depth,
                max_depth=getattr(self.settings, 'coder_max_worker_depth', 1),
                recover_runtime=self._recover_worker)
        return self._workers

    def recover_workers(self):
        if (self.h.state_dir / 'workers' / 'workers.json').exists():
            self.workers()

    def _recover_worker(self, context):
        runtime = self.h.make_runtime(context.task_id, context.workspace, context.state_dir / 'engine')
        runtime.stop_all()
        if (context.state_dir / 'workers' / 'workers.json').exists():
            from .workers import WorkerManager
            from .checkpoints import CheckpointStore
            from .general_state import MANAGED_EXCLUSIONS
            journal = CheckpointStore(context.workspace, context.state_dir / 'checkpoints',
                                      excluded_roots=MANAGED_EXCLUSIONS)
            try:
                nested = self._recoveries.get(context.task_id)
                if nested is None:
                    nested = WorkerManager(journal, context.state_dir / 'workers', self._run_worker,
                                           recover_runtime=self._recover_worker)
                    self._recoveries[context.task_id] = nested
                nested.close(wait_ms=30000)
                self._recoveries.pop(context.task_id, None)
            finally:
                journal.close()

    def _run_worker(self, context):
        from .general_harness import GeneralHarness
        from .models import AcceptanceCriterion, CheckKind, DevTask, TaskStatus
        from .task_store import TaskStore
        problem = context.prompt
        if context.owned_paths:
            problem += '\n仅允许修改这些文件/目录：' + ', '.join(context.owned_paths)
        task = DevTask(id=context.task_id, title=context.prompt[:80], problem=problem,
            workdir=str(context.workspace), runtime_version=2,
            acceptance=[AcceptanceCriterion(id='worker_goal', description=context.prompt, check=CheckKind.UNIT)])
        store = TaskStore(context.task_store_root)
        store.create(task)
        # Workers get a fresh provider/router to avoid sharing mutable clients.
        chat = self.h.chat
        if self.settings is not None:
            from ..models import ChatService
            chat = ChatService(self.settings)
        child = GeneralHarness(task, chat, store, runtime_factory=self.h.runtime_factory,
            runtime_image=self.h.runtime_image, docker_prefix=self.h.docker_prefix,
            supports_tools=self.h.supports_tools, settings=self.settings,
            network_policy=self.h.network_policy, worker_depth=context.depth,
            cancel_event=context.cancel_event, trusted_project_root=self.h.trusted_project_root)
        revision = child.journal.snapshot()
        child.state = {'version': 2, 'baseline': revision, 'revision': revision,
                       'verification': [], 'pending': None, 'services': []}
        child._save()
        def cleanup():
            try:
                child.extensions.close()
            finally:
                child.runtime.stop_all()
        context.register_cancel(cleanup)
        result = child.run()
        return {'status': 'completed' if result.status == TaskStatus.AWAITING_APPROVAL else 'blocked',
                'summary': child.state.get('summary', 'Worker stopped; inspect its saved evidence')}

    def execute(self, step):
        h = self.h
        if isinstance(step, ReportProgress):
            h.evidence.event('model', step.message[:240],
                             {'content': step.message, 'source': 'report_progress', 'inputs': step.model_dump()})
            return StepResult('公开进度已发送；继续实际执行下一步工具。', action='ReportProgress')
        if isinstance(step, Capabilities):
            result = self.capabilities()
            h.state['capabilities'] = result
        elif isinstance(step, UpdatePlan):
            if sum(item.status == 'in_progress' for item in step.steps) > 1:
                raise ValueError('Only one plan step may be in_progress')
            result = {'plan': [item.model_dump() for item in step.steps]}
            h.state.update(result)
        elif isinstance(step, Remember):
            result = {'memory': step.model_dump()}
            h.state.update(result)
        elif isinstance(step, McpTools):
            result = self._integrations().list_tools(step.server)
        elif isinstance(step, McpCall):
            return self._mcp_call(step)
        elif isinstance(step, SkillsList):
            result = self._integrations().list_skills()
        elif isinstance(step, SkillRead):
            result = self._integrations().read_skill(step.skill_id)
        elif isinstance(step, InspectImage):
            path = h.state_dir / 'artifacts' / (step.artifact_id + '.png')
            if h.chat is None or not hasattr(h.chat, 'inspect_image'):
                raise ValueError('No vision model is configured')
            response = h.chat.inspect_image(path, step.question)
            h.record_model(response)
            result = {'artifact_id': step.artifact_id, 'analysis': response.content, 'model': response.model}
        elif isinstance(step, InspectLocalApp):
            if self.depth:
                raise ValueError('Host inspection is restricted to the parent agent; workers must use shared evidence')
            from .host_diagnostics import inspect_local_app
            result = inspect_local_app(self.settings, h.trusted_project_root, h.state_dir / 'artifacts',
                                       capture_browser=step.capture_browser)
            h.state['host_observation'] = result
        else:
            result = self._worker_action(step)
        h._save()
        h.evidence.event(type(step).__name__, extension_summary(step, result),
                         {**result, 'inputs': step.model_dump()})
        return StepResult(json.dumps(result, ensure_ascii=False), action=type(step).__name__,
                          made_progress=bool(result.get('files')))

    def _mcp_call(self, step):
        arguments = step.model_dump()
        manager = self._integrations()
        binding = getattr(manager, 'approval_binding', None)
        if binding:
            arguments['binding'] = binding(step.server, step.tool)
        authorization = self.control.authorize(arguments)
        if authorization in ('denied', 'consumed'):
            self.h.state.pop('waiting_for', None)
            self.h._save()
            return StepResult(f'External operation {authorization}; do not replay. Ask the user or inspect remote state.')
        result = manager.call_tool(step.server, step.tool, step.arguments, approved=authorization == 'approved')
        if result.get('approvalRequired'):
            if self.depth:
                return StepResult(json.dumps(result, ensure_ascii=False), signal=LoopSignal.BLOCKED,
                                  reason='子任务需要外部写操作，请父Agent使用mcp_call提交审批：' + json.dumps(arguments, ensure_ascii=False))
            request = self.control.request_approval(arguments, f'{step.server} / {step.tool}')
            self.h.state['waiting_for'] = request['id']
            self.h._save()
            self.h.evidence.event('approval_requested', '外部操作等待用户批准', request)
            return StepResult(json.dumps(request, ensure_ascii=False), signal=LoopSignal.PAUSED,
                              reason='外部工具操作等待用户批准；批准后重新调用相同参数')
        self.h.state.pop('waiting_for', None)
        self.h._save()
        self.h.evidence.event('mcp_call', extension_summary(step, result),
                              {'inputs': arguments, 'result': result, 'authorized': authorization == 'approved'})
        return StepResult(json.dumps(result, ensure_ascii=False), action='mcp_call')

    def _worker_action(self, step):
        h = self.h
        manager = self.workers()
        if isinstance(step, AgentSpawn):
            if h.state.get('pending'):
                raise ValueError('Poll the active terminal before spawning a source copy')
            result = manager.spawn(step.prompt, step.owned_paths)
        elif isinstance(step, AgentList):
            result = {'workers': manager.list()}
        elif isinstance(step, AgentPoll):
            result = manager.poll(step.worker_id, step.wait_ms)
        elif isinstance(step, AgentCancel):
            result = manager.cancel(step.worker_id)
        elif isinstance(step, AgentDiff):
            result = manager.diff(step.worker_id)
        elif isinstance(step, AgentMerge):
            if h.state.get('pending') or h.runtime.active_writers():
                raise ValueError('Poll the active terminal before merging')
            result = manager.merge(step.worker_id, step.expected_revision)
            h.state['revision'] = result['after']
            if result['files']:
                h._invalidate()
            h._sync_gate()
        else:
            raise ValueError('Unsupported extension tool')
        h.state['workers'] = manager.list()
        return result

    def active_workers(self):
        return self._workers.active() if self._workers else []

    def cancel_workers(self):
        if self._workers:
            self._workers.cancel_all()

    def close(self):
        # A later run creates a new scratchpad, so only durable acknowledgments
        # may suppress delivery there. Uncommitted input is safe to replay.
        self._delivered_message_ids.clear()
        for identity, manager in list(self._recoveries.items()):
            manager.close(wait_ms=30000)
            self._recoveries.pop(identity, None)
        if self._workers:
            self._workers.close(wait_ms=30000)
            self.h.state['workers'] = self._workers.list()
            self._workers = None
            self.h._save()
