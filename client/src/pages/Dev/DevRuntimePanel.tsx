/** Conversation details: source history and tool evidence are opened on demand. */
import { useRef, useState, type FC, type SyntheticEvent } from 'react';
import { ChevronRight, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { restoreDevCheckpoint, undoDevChange } from '@/api';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { DevAgentChange, DevAgentToolEvent } from '@shared/api.interface';
import { getErrorMessage } from './dev-ui';
import { runtimeActionBlock, sourceChanges } from './dev-runtime';
import { useDevRuntime } from './useDevRuntime';
import { DevRuntimeEvent } from './DevRuntimeEvent';

interface DevRuntimePanelProps {
  taskId: string;
  running: boolean;
  ready: boolean;
  onChanged: () => void;
  runtime?: ReturnType<typeof useDevRuntime>;
  showEvents?: boolean;
}
interface HistoryChoice {
  kind: 'undo' | 'restore';
  change: DevAgentChange;
  expectedRevision: string;
}

const summaryClass = 'flex cursor-pointer list-none items-center gap-2 py-3 text-sm text-muted-foreground hover:text-foreground';
const chevronClass = 'h-4 w-4 shrink-0 transition-transform group-open/runtime:rotate-90';
const CHANGE_STATUS: Record<string, string> = {
  completed: '已记录', failed: '失败后的部分修改', recovered: '中断后保留的修改',
  failed_rolled_back: '操作失败，已回滚',
};

/** The keyed child discards cursor, pending dialogs, and tool detail state on task changes. */
export const DevRuntimePanel: FC<DevRuntimePanelProps> = (props) => (
  <RuntimePanel key={props.taskId} {...props} />
);

const RuntimePanel: FC<DevRuntimePanelProps> = ({ taskId, running, ready, onChanged, runtime: sharedRuntime, showEvents = true }) => {
  const [open, setOpen] = useState<boolean>(false);
  const [choice, setChoice] = useState<HistoryChoice | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestInFlight = useRef<boolean>(false);
  const localRuntime = useDevRuntime(taskId, !sharedRuntime && open && !busy, running);
  const runtime = sharedRuntime ?? localRuntime;
  const changes: DevAgentChange[] = sourceChanges(runtime.snapshot?.changes ?? []);
  const block: string | null = runtimeActionBlock({
    ready, running, busy, loading: runtime.loading, error: runtime.error, snapshot: runtime.snapshot,
  });
  const choiceBlock: string | null = runtimeActionBlock({
    ready, running, busy, loading: runtime.loading, error: runtime.error,
    snapshot: runtime.snapshot, expectedRevision: choice?.expectedRevision,
  });

  const choose = (kind: HistoryChoice['kind'], change: DevAgentChange): void => {
    if (block || !runtime.snapshot?.revision) return;
    setActionError(null);
    setNotice(null);
    setChoice({ kind, change, expectedRevision: runtime.snapshot.revision });
  };
  const applyChoice = async (): Promise<void> => {
    if (!choice || choiceBlock || requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true);
    setActionError(null);
    try {
      if (choice.kind === 'undo') {
        await undoDevChange(taskId, { changeId: choice.change.id, expectedRevision: choice.expectedRevision });
      } else {
        await restoreDevCheckpoint(taskId, {
          revision: choice.change.before, expectedRevision: choice.expectedRevision,
        });
      }
      setChoice(null);
      setNotice(choice.kind === 'undo' ? '已撤销这次修改，历史记录已保留。' : '已恢复到修改前的版本，历史记录已保留。');
      runtime.refresh();
      onChanged();
    } catch (cause: unknown) {
      setActionError(getErrorMessage(cause));
      runtime.refresh();
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  };

  return <>
    <details className="group/runtime min-w-0" onToggle={(event: SyntheticEvent<HTMLDetailsElement>) => {
      setOpen(event.currentTarget.open);
    }}>
      <summary className={summaryClass}>
        <ChevronRight className={chevronClass} />{showEvents ? '运行与修改记录' : '修改历史与回滚'}
        {runtime.snapshot && <span>（{changes.length} 次修改）</span>}
      </summary>
      {open && <div className="min-w-0 space-y-5 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{showEvents ? '展开记录可查看终端输出与浏览器证据。' : '每次源码修改都保留检查点，可独立撤销。'}</p>
          <Button size="sm" variant="ghost" disabled={runtime.loading || busy} onClick={runtime.refresh}>
            <RefreshCw className="h-3.5 w-3.5" />刷新运行记录
          </Button>
        </div>
        {runtime.loading && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />更新运行记录中…
        </p>}
        {runtime.error && <p role="alert" className="break-words text-sm text-destructive">
          {runtime.error}。当前记录可能已过期，请刷新后再操作。
        </p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {runtime.snapshot && <>
          <section aria-label="源码修改" className="space-y-3">
            <h3 className="text-sm font-medium">源码修改</h3>
            <p className="text-xs text-muted-foreground">以下撤销和恢复只作用于任务副本；已经批准写入主项目的改动需单独撤销落地。</p>
            {changes.length === 0 && <p className="text-xs text-muted-foreground">暂无源码修改记录。</p>}
            {changes.map((change: DevAgentChange, index: number) => <article key={change.id} className="space-y-2 rounded-md border border-border p-3">
              <p className="break-words text-sm leading-6">{index + 1}. {change.reason || '源码修改'}</p>
              <p className="text-xs text-muted-foreground">{CHANGE_STATUS[change.status] ?? change.status} · {change.files.length} 个文件</p>
              <ul className="space-y-1 font-mono text-xs text-muted-foreground">
                {change.files.map((file: string) => <li key={file} className="break-all">{file}</li>)}
              </ul>
              <div className="flex flex-wrap gap-2" data-ai-section-type="button">
                <Button size="sm" variant="outline" disabled={Boolean(block)} onClick={() => choose('undo', change)}>
                  <RotateCcw className="h-3.5 w-3.5" />撤销这次修改
                </Button>
                <Button size="sm" variant="ghost" disabled={Boolean(block)} onClick={() => choose('restore', change)}>
                  恢复到这次修改前
                </Button>
              </div>
            </article>)}
            {changes.length > 0 && block && <p role="status" className="text-xs text-muted-foreground">{block}</p>}
          </section>
          {showEvents && <section aria-label="工具运行记录" className="space-y-2">
            <h3 className="text-sm font-medium">工具运行记录</h3>
            {runtime.snapshot.events.length === 0 && <p className="text-xs text-muted-foreground">暂无工具运行记录。</p>}
            {runtime.snapshot.cursor > runtime.snapshot.events.length && <p className="text-xs text-muted-foreground">
              当前显示最近 {runtime.snapshot.events.length} 条记录，较早的记录仍保存在任务中。
            </p>}
            <div className="max-h-[28rem] overflow-y-auto">
              {runtime.snapshot.events.map((event: DevAgentToolEvent) => <DevRuntimeEvent key={event.index} taskId={taskId} event={event} />)}
            </div>
          </section>}
        </>}
      </div>}
    </details>
    <Dialog open={choice !== null} onOpenChange={(value: boolean) => { if (!value && !busy) setChoice(null); }}>
      <DialogContent showCloseButton={!busy} className="max-h-[85dvh] overflow-y-auto border-border bg-card text-foreground">
        <DialogHeader>
          <DialogTitle>{choice?.kind === 'restore' ? '恢复到这次修改前？' : '撤销这次修改？'}</DialogTitle>
          <DialogDescription className="break-words leading-6">
            {choice?.kind === 'restore'
              ? '将恢复整个任务工作区到本次修改前的版本。本次以及之后的源码修改都会被移除；修改历史仍会保留。'
              : '仅撤销所选修改，保留之后对其他文件的修改。若同一文件后来又被编辑，操作会报告冲突，请先查看记录。'}
            操作后需要重新验证结果。
          </DialogDescription>
        </DialogHeader>
        <p className="break-words text-sm leading-6">{choice?.change.reason}</p>
        {choiceBlock && !busy && <p role="status" className="text-sm text-muted-foreground">{choiceBlock}</p>}
        {actionError && <p role="alert" className="break-words text-sm text-destructive">{actionError}</p>}
        <DialogFooter>
          <Button variant={choice?.kind === 'restore' ? 'destructive' : 'default'}
            disabled={Boolean(choiceBlock)} onClick={() => void applyChoice()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {choice?.kind === 'restore' ? '确认恢复整个版本' : '确认撤销这次修改'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
};
