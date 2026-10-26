/** Steering and external approvals remain visible; working details stay folded. */
import { useRef, useState } from 'react';
import { ArrowUp, ChevronRight, Loader2 } from 'lucide-react';
import { decideDevExternal, sendDevMessage } from '@/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getErrorMessage } from './dev-ui';
import { useDevRuntime } from './useDevRuntime';
import type { DevTaskDetail } from './types';

const workerLabels: Record<string, string> = {
  starting: '准备中', running: '执行中', completed: '完成，等待合并', merged: '已合并',
  blocked: '需要处理', failed: '执行失败', cancelling: '停止中', cancelled: '已停止',
  interrupted: '已中断', cleanup_failed: '清理失败，需要处理',
};
const planLabels = { pending: '待处理', in_progress: '进行中', completed: '已完成' };

export function DevSessionPanel({ task, ready, onChanged, runtime }: {
  task: DevTaskDetail; ready: boolean; onChanged: () => void;
  runtime: ReturnType<typeof useDevRuntime>;
}) {
  const running = task.execution?.state === 'running';
  const landing = running && task.execution?.command === 'approve';
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const locked = useRef(false);
  const snapshot = runtime.snapshot;
  const pending = (snapshot?.approvals ?? []).filter((approval) => approval.status === 'pending');
  const mutate = async (action: () => Promise<void>, success: string) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      await action(); setNotice(success); runtime.refresh(); onChanged();
    } catch (cause: unknown) { setError(getErrorMessage(cause)); }
    finally { locked.current = false; setBusy(false); }
  };
  const send = () => {
    if (!text.trim() || !ready || landing || task.status === 'verified') return;
    const message = text.trim();
    void mutate(async () => { await sendDevMessage(task.id, message); setText(''); },
      running ? '已收到，Agent 会在下一步处理你的指示。' : '已收到，任务将继续执行。');
  };
  return <div className="min-w-0 space-y-4" aria-label="任务协作">
    {pending.map((approval) => <div key={approval.id} className="space-y-3 rounded-xl border border-border p-4">
      <p className="text-sm font-medium">外部操作需要你批准</p>
      <p className="break-words text-sm">{approval.summary}</p>
      <p className="text-xs leading-6 text-muted-foreground">批准仅适用于下面这次调用。外部系统的修改不能通过源码检查点撤销。</p>
      <details><summary className="cursor-pointer text-xs text-muted-foreground">查看操作参数</summary>
        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs leading-6">
          {JSON.stringify(approval.arguments, null, 2)}
        </pre>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!ready || running || busy} onClick={() => void mutate(
          () => decideDevExternal(task.id, approval.id, true), '已批准这次操作，任务将继续。')}>批准这次操作</Button>
        <Button size="sm" variant="outline" disabled={!ready || running || busy} onClick={() => void mutate(
          () => decideDevExternal(task.id, approval.id, false), '已拒绝这次操作，Agent 会处理你的决定。')}>拒绝</Button>
      </div>
    </div>)}
    {!!(snapshot?.plan?.length || snapshot?.workers?.length) && <details className="group/session">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-2 text-sm text-muted-foreground">
        <ChevronRight className="h-4 w-4 transition-transform group-open/session:rotate-90" />计划与并行任务
      </summary>
      <div className="space-y-4 py-3 text-sm">
        {!!snapshot?.plan?.length && <ol className="space-y-2">{snapshot.plan.map((item, index) => <li key={index}
          className="flex items-start gap-3"><span className="shrink-0 text-xs leading-6 text-muted-foreground">{planLabels[item.status]}</span>
          <span className="break-words leading-6">{item.step}</span></li>)}</ol>}
        {(snapshot?.workers ?? []).map((worker) => <div key={worker.worker_id} className="space-y-1 border-t border-border pt-3">
          <p className="break-words leading-6">{worker.prompt}</p>
          <p className="text-xs text-muted-foreground">{workerLabels[worker.status] ?? worker.status}</p>
          {worker.summary && <p className="whitespace-pre-wrap break-words text-xs leading-6">{worker.summary}</p>}
          {worker.error && <p className="break-words text-xs text-destructive">{worker.error}</p>}
        </div>)}
      </div>
    </details>}
    {task.status !== 'verified' && <div className="rounded-2xl border border-border p-3">
      <Textarea aria-label="补充指示" value={text} maxLength={20000} rows={2} disabled={busy || !ready || landing}
        placeholder={landing ? '正在复验并应用已审阅的修改…' : running ? '补充要求或纠正方向，Agent 会在下一步处理…' : '补充要求，继续这项任务…'}
        className="resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); send(); } }} />
      <div className="flex items-center justify-between gap-3 pt-2">
        <span className="text-xs text-muted-foreground">{landing ? '应用修改期间暂停接收新要求' : running ? '运行中也可以追加指示' : '保留当前工作继续执行'}</span>
        <Button size="icon" aria-label="发送补充指示" disabled={!ready || busy || landing || !text.trim()} onClick={send}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </Button>
      </div>
    </div>}
    {(error || runtime.error) && <div role="alert" className="space-y-2 text-sm text-destructive">
      <p>{error || runtime.error}</p>
      {runtime.error && <Button size="sm" variant="outline" onClick={runtime.refresh}>重新加载协作状态</Button>}
    </div>}
    {notice && <p role="status" className="text-xs leading-6 text-muted-foreground">{notice}</p>}
  </div>;
}
