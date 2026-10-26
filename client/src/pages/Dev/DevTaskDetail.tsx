/** Brief conversation with evidence available on demand. */
import { useCallback, useState } from 'react';
import { ArrowLeft, ChevronRight, Loader2, RefreshCw, TerminalSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getDevTask } from '@/api';
import { DevIterationTimeline } from './DevIterationTimeline';
import { GateStatusSummary } from './GateStatusSummary';
import { DevTaskActions } from './DevTaskActions';
import { DevPatchPanel } from './DevPatchPanel';
import { DevRuntimePanel } from './DevRuntimePanel';
import { DevSessionPanel } from './DevSessionPanel';
import { DevConversationTimeline } from './DevConversationTimeline';
import { useDevRuntime } from './useDevRuntime';
import { CHECK_LABEL, DETAIL_POLL_MS, executionLabel, formatTime } from './dev-ui';
import { taskProgress, toolSummary } from './dev-conversation';
import { TERMINAL_STATUSES } from './types';
import type { DevTaskDetail as DevTask } from './types';
import { useDevResource } from './useDevResource';

interface Props {
  taskId: string;
  onBack: () => void;
  ready: boolean;
  onChanged: () => void;
  kickoffError?: string;
}
function shouldPoll(task: DevTask): boolean {
  return task.execution?.state === 'running' || !TERMINAL_STATUSES.includes(task.status);
}
const summaryClass = 'flex cursor-pointer list-none items-center gap-2 rounded-md py-3 text-sm text-muted-foreground hover:text-foreground';
const chevronClass = 'h-4 w-4 shrink-0 transition-transform group-open/fold:rotate-90';

export function DevTaskDetail({ taskId, onBack, ready, onChanged, kickoffError }: Props) {
  const request = useCallback(() => getDevTask(taskId), [taskId]);
  const resource = useDevResource(request, DETAIL_POLL_MS, true, shouldPoll);
  const [patchOpen, setPatchOpen] = useState(false);
  const task = resource.data;
  const runtime = useDevRuntime(taskId, ready && task?.runtime_version === 2, task?.execution?.state === 'running');
  const refresh = () => { resource.refresh(); onChanged(); };
  const latestIteration = task?.iterations.at(-1);

  return (
    <section aria-label="任务详情" className="mx-auto w-full min-w-0 max-w-3xl space-y-6 pb-8">
      <Button className="xl:hidden" variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" />返回任务列表</Button>
      {resource.error && <div role="alert" className="space-y-3 rounded-xl border border-destructive/30 p-4 text-sm">
        <p className="break-words text-destructive">{resource.error}</p>
        {task && <p className="text-muted-foreground">当前显示上次成功读取的记录，请刷新后再操作。</p>}
        <Button variant="outline" size="sm" onClick={resource.refresh}>重试加载任务</Button>
      </div>}
      {kickoffError && <p role="alert" className="text-sm text-destructive">任务已创建，但启动失败：{kickoffError}。可以点击“开始运行”重试。</p>}
      {!task && !resource.error && <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载任务中…</p>}
      {task && <>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="truncate text-sm text-muted-foreground" title={task.title}>{task.title}</h2>
          <Button size="icon" variant="ghost" aria-label="刷新记录" onClick={refresh} className="h-8 w-8 shrink-0"><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
        <div className="ml-auto w-fit max-w-[92%] rounded-2xl rounded-tr-sm bg-muted px-4 py-3 sm:px-5">
          <p className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{task.problem}</p>
        </div>
        <div className="space-y-4 pt-3">
          <div className="flex items-center gap-2.5 text-sm font-medium"><TerminalSquare className="h-5 w-5" />Coding Agent</div>
          <p role="status" className="text-sm leading-7">{taskProgress(task, runtime.snapshot?.modelActivity)}</p>
          {task.runtime_version !== 2 && task.execution?.state === 'running' && <p className="flex items-start gap-2 text-xs leading-6 text-muted-foreground">
            <Loader2 className="mt-1 h-3.5 w-3.5 shrink-0 animate-spin" />{latestIteration ? `最近进展：${toolSummary(latestIteration)}` : '正在准备工作区…'}
          </p>}
          {task.execution?.error && <div role="alert" className="text-sm text-destructive">
            <details><summary className="cursor-pointer py-1">执行错误详情</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 [overflow-wrap:anywhere]">{task.execution.error}</pre></details>
          </div>}
          <DevTaskActions task={task} ready={ready && !resource.error && !resource.loading} onChanged={refresh} />
        </div>
        {task.runtime_version === 2 && <DevConversationTimeline taskId={taskId} snapshot={runtime.snapshot} />}
        <div className="min-w-0 divide-y divide-border border-y border-border">
          <DevRuntimePanel
            taskId={task.id}
            running={task.execution?.state === 'running'}
            ready={ready && !resource.error && !resource.loading}
            onChanged={refresh}
            runtime={task.runtime_version === 2 ? runtime : undefined}
            showEvents={task.runtime_version !== 2}
          />
          {task.runtime_version !== 2 && <details className="group/fold min-w-0">
            <summary className={summaryClass}><ChevronRight className={chevronClass} />执行记录（{task.iterations.length}）</summary>
            <div className="min-w-0 pb-4"><DevIterationTimeline iterations={task.iterations} /></div>
          </details>}
          <details className="group/fold min-w-0" onToggle={(event) => setPatchOpen(event.currentTarget.open)}>
            <summary className={summaryClass}><ChevronRight className={chevronClass} />查看改动（{task.patchCount}）</summary>
            {patchOpen && <div className="min-w-0 pb-5"><DevPatchPanel taskId={task.id} patchCount={task.patchCount} latestPatchId={task.latestPatch?.patchId} /></div>}
          </details>
          <details className="group/fold min-w-0">
            <summary className={summaryClass}><ChevronRight className={chevronClass} />任务详情与验收</summary>
            <div className="space-y-6 pb-5">
              <GateStatusSummary task={task} />
              <section className="space-y-3 text-sm">
                <h3 className="font-medium">验收标准</h3>
                <ul className="space-y-3">{task.acceptance.map((criterion) => <li key={criterion.id} className="space-y-1">
                  <p className="break-words leading-6 [overflow-wrap:anywhere]">{criterion.description}</p>
                  <p className="text-xs text-muted-foreground">{CHECK_LABEL[criterion.check]}{criterion.target && ` · ${criterion.target}`}</p>
                </li>)}</ul>
              </section>
              <div className="space-y-1 break-all text-xs leading-6 text-muted-foreground">
                <p>任务 ID：{task.id}</p><p>{executionLabel(task.status, task.execution)}</p>
                <p>工作目录：{task.workdir}</p><p>记录分支：{task.branch || '未记录'}</p>
                <p>创建于 {formatTime(task.created_at)} · 更新于 {formatTime(task.updated_at)}</p>
              </div>
            </div>
          </details>
        </div>
        {task.runtime_version === 2 && <DevSessionPanel task={task} ready={ready && !resource.error}
          onChanged={refresh} runtime={runtime} />}
      </>}
    </section>
  );
}
